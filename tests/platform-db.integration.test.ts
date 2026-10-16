import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts, metricValues, sourceDefinitions, syncExecutions } from "@/infrastructure/db/platform-schema";
import { PostgresCanonicalFactRepository, PostgresSourceRepository, PostgresSyncRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { MetricService } from "@/application/metrics/metric-service";
import { CoreGateway } from "@/application/core/core-gateway";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import type { CognitiveModel } from "@/domain/core/cognitive-model";
import type { TenantContext } from "@/domain/security/tenant-context";

const TENANTS = ["it-tenant-a", "it-tenant-b"];

afterEach(async () => {
  for (const tenantId of TENANTS) {
    await db.delete(metricValues).where(eq(metricValues.tenantId, tenantId));
    await db.delete(canonicalFacts).where(eq(canonicalFacts.tenantId, tenantId));
    await db.delete(syncExecutions).where(eq(syncExecutions.tenantId, tenantId));
    await db.delete(sourceDefinitions).where(eq(sourceDefinitions.tenantId, tenantId));
  }
});

describe("F07/F08 PostgreSQL tenant isolation", () => {
  it("Source Registry lista somente registros do tenant solicitado", async () => {
    const repository = new PostgresSourceRepository();
    await repository.create(TENANTS[0], { name: "A", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull" });
    await repository.create(TENANTS[1], { name: "B", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull" });

    const rows = await repository.list(TENANTS[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(TENANTS[0]);
    expect(rows[0].name).toBe("A");
  });

  it("coordena idempotência concorrente e permite retry após falha", async () => {
    const sources = new PostgresSourceRepository();
    const syncs = new PostgresSyncRepository();
    const source = await sources.create(TENANTS[0], {
      name: "Idempotency", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull",
    });
    const input = {
      tenantId: TENANTS[0], sourceId: source.id, idempotencyKey: "idem-db-1", correlationId: "corr-db-1",
    };

    const first = await syncs.begin(input);
    expect(first.state).toBe("started");

    const concurrent = await syncs.begin(input);
    expect(concurrent).toMatchObject({ id: first.id, state: "running" });

    await syncs.fail({ id: first.id, tenantId: TENANTS[0], errorCode: "transient", errorMessage: "retry" });
    const restarted = await syncs.begin({ ...input, correlationId: "corr-db-2" });
    expect(restarted).toMatchObject({ id: first.id, state: "restarted" });

    await syncs.complete({ id: first.id, tenantId: TENANTS[0], cursorAfter: "done" });
    const completed = await syncs.begin(input);
    expect(completed).toMatchObject({ id: first.id, state: "completed" });
  });


  it("persiste health e expõe último sync bem-sucedido sem cruzar tenants", async () => {
    const sources = new PostgresSourceRepository();
    const syncs = new PostgresSyncRepository();
    const source = await sources.create(TENANTS[0], {
      name: "Operational state",
      sourceType: "fixture",
      authoritativeDomain: "billing",
      syncMode: "pull",
    });

    await sources.updateStatus(TENANTS[0], source.id, "healthy");
    const healthy = await sources.findById(TENANTS[0], source.id);
    expect(healthy?.status).toBe("healthy");

    const first = await syncs.begin({
      tenantId: TENANTS[0],
      sourceId: source.id,
      idempotencyKey: "operational-success",
      correlationId: "corr-success",
    });
    await syncs.complete({
      id: first.id,
      tenantId: TENANTS[0],
      cursorAfter: "cursor-success",
    });

    const second = await syncs.begin({
      tenantId: TENANTS[0],
      sourceId: source.id,
      idempotencyKey: "operational-failure",
      correlationId: "corr-failure",
    });
    await syncs.fail({
      id: second.id,
      tenantId: TENANTS[0],
      errorCode: "provider_unavailable",
      errorMessage: "integration.connector_failure",
    });

    const state = await syncs.operationalState(
      TENANTS[0],
      source.id,
    );
    expect(state.lastAttemptStatus).toBe("failed");
    expect(state.lastAttemptAt).toBeInstanceOf(Date);
    expect(state.lastSuccessfulAt).toBeInstanceOf(Date);
    expect(state.lastSuccessfulCursor).toBe("cursor-success");

    const foreign = await syncs.operationalState(
      TENANTS[1],
      source.id,
    );
    expect(foreign).toEqual({});
  });

  it("isola a mesma chave de idempotência entre fontes do mesmo tenant", async () => {
    const sources = new PostgresSourceRepository();
    const syncs = new PostgresSyncRepository();
    const sourceA = await sources.create(TENANTS[0], {
      name: "Idempotency A", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull",
    });
    const sourceB = await sources.create(TENANTS[0], {
      name: "Idempotency B", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull",
    });

    const first = await syncs.begin({
      tenantId: TENANTS[0],
      sourceId: sourceA.id,
      idempotencyKey: "same-client-key",
      correlationId: "corr-source-a",
    });
    const second = await syncs.begin({
      tenantId: TENANTS[0],
      sourceId: sourceB.id,
      idempotencyKey: "same-client-key",
      correlationId: "corr-source-b",
    });

    expect(first.state).toBe("started");
    expect(second.state).toBe("started");
    expect(second.id).not.toBe(first.id);

    const rows = await db
      .select({
        sourceId: syncExecutions.sourceId,
        idempotencyKey: syncExecutions.idempotencyKey,
      })
      .from(syncExecutions)
      .where(eq(syncExecutions.tenantId, TENANTS[0]));

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: sourceA.id,
        idempotencyKey: `${sourceA.id}:same-client-key`,
      }),
      expect.objectContaining({
        sourceId: sourceB.id,
        idempotencyKey: `${sourceB.id}:same-client-key`,
      }),
    ]));
  });

  it("prova F07 → F08 → F09 sobre o mesmo dado governado", async () => {
    const tenantId = TENANTS[0];
    const context: TenantContext = { tenantId, userId: "it-user", role: "owner", correlationId: "it-corr" };
    const sources = new PostgresSourceRepository();
    const source = await sources.create(tenantId, {
      name: "Billing governed", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull",
    });

    await new PostgresCanonicalFactRepository().ingest({
      tenantId, sourceId: source.id, mappingVersion: source.mappingVersion, correlationId: context.correlationId,
      fact: {
        externalId: "invoice-it-1", factType: "billing.invoice",
        payload: { amount: "12.34", currency: "BRL" },
        sourceTimestamp: new Date("2026-09-20T00:00:00Z"),
      },
    });

    const metrics = new MetricService(new PostgresMetricStore());
    const metric = await metrics.recompute(context, {
      metricId: "billing.gross_billed",
      periodStart: new Date("2026-09-20T00:00:00Z"),
      periodEnd: new Date("2026-09-20T23:59:59Z"),
    });
    expect(metric).toMatchObject({
      metricId: "billing.gross_billed", value: "12.34", currency: "BRL",
      freshnessStatus: "unknown", qualityStatus: "unknown",
    });
    expect(metric.provenanceRefs).toHaveLength(1);

    const cognitiveModel: CognitiveModel = {
      async plan(input) {
        expect(input.metricCatalog.some(({ metricId }) => metricId === "billing.gross_billed")).toBe(true);
        return { metricIds: ["billing.gross_billed"] };
      },
      async synthesize(input) {
        expect(input.evidence[0].provenanceRefs).toHaveLength(1);
        expect(input.facts[0]).toMatchObject({ metricId: "billing.gross_billed", value: "12.34", currency: "BRL" });
        return "Valor governado disponível.";
      },
    };
    const core = new FmccVerticalCognitiveCore(cognitiveModel);
    const answer = await new CoreGateway(core, metrics).ask(context, "Qual o faturamento bruto emitido?");
    expect(answer).toMatchObject({ factualStatus: "grounded", evidence: [{ ref: "billing.gross_billed" }] });
  });

  it("Metric Store não retorna MetricValue de outro tenant", async () => {
    const store = new PostgresMetricStore();
    const now = new Date();
    await store.saveValue({
      tenantId: TENANTS[0], metricId: "trial.starts.count", metricVersion: 1, value: "3", unit: "count",
      computedAt: now, freshnessStatus: "unknown", qualityStatus: "verified", sourceAuthority: "fixture-a", provenanceRefs: [],
    });
    await store.saveValue({
      tenantId: TENANTS[1], metricId: "trial.starts.count", metricVersion: 1, value: "99", unit: "count",
      computedAt: new Date(now.getTime() + 1), freshnessStatus: "unknown", qualityStatus: "verified", sourceAuthority: "fixture-b", provenanceRefs: [],
    });

    const value = await store.latestValue(TENANTS[0], "trial.starts.count");
    expect(value?.value).toBe("3");
    expect(value?.sourceAuthority).toBe("fixture-a");

    const leaked = await db.select().from(metricValues).where(and(eq(metricValues.tenantId, TENANTS[0]), eq(metricValues.value, "99")));
    expect(leaked).toHaveLength(0);
  });
});
