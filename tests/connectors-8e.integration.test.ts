import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { CredentialNotFoundError } from "@/domain/integration/credentials";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { sourceCredentials } from "@/infrastructure/db/credential-schema";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { canonicalFacts, sourceDefinitions, syncExecutions } from "@/infrastructure/db/platform-schema";
import { orgUnits } from "@/infrastructure/db/unit-schema";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { OmieSimulator, receivable } from "./support/omie-simulator";

const A = "conector-8e-a";
const B = "conector-8e-b";
const KEY = randomBytes(32);
const store = new PostgresCredentialStore(() => KEY);
const sources = new PostgresSourceRepository();
const facts = new PostgresCanonicalFactRepository();
const units = new PostgresUnitRepository();
const ctx = (tenantId: string): TenantContext => ({ tenantId, userId: `u-${tenantId}`, role: "owner", correlationId: `c-${tenantId}` });
let unitA: string;

async function cleanup() {
  const t = [A, B];
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, t));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, t));
  await db.delete(syncExecutions).where(inArray(syncExecutions.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
  await db.delete(sourceCredentials).where(inArray(sourceCredentials.tenantId, t));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, t));
}

beforeAll(async () => {
  await cleanup();
  unitA = (await units.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz A" })).id;
});
afterAll(cleanup);

describe("8E cofre de credenciais", () => {
  it("guarda cifrado, devolve igual e não deixa o segredo legível no banco", async () => {
    await store.save(A, "vault:t1", { kind: "api_key_pair", appKey: "K1", appSecret: "SEGREDO-LEGIVEL-XYZ" });
    expect(await store.resolve(A, "vault:t1")).toEqual({ kind: "api_key_pair", appKey: "K1", appSecret: "SEGREDO-LEGIVEL-XYZ" });
    const [row] = await db.select().from(sourceCredentials).where(and(eq(sourceCredentials.tenantId, A), eq(sourceCredentials.secretRef, "vault:t1")));
    expect(JSON.stringify(row)).not.toContain("SEGREDO-LEGIVEL-XYZ");
    expect(JSON.stringify(row)).not.toContain("K1\"");
  });

  it("outra empresa não resolve a mesma referência", async () => {
    await expect(store.resolve(B, "vault:t1")).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("linha copiada para outra empresa não decifra (empresa entra na autenticação)", async () => {
    const [row] = await db.select().from(sourceCredentials).where(and(eq(sourceCredentials.tenantId, A), eq(sourceCredentials.secretRef, "vault:t1")));
    await db.insert(sourceCredentials).values({ tenantId: B, secretRef: "vault:t1", ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    await expect(store.resolve(B, "vault:t1")).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("etiqueta de autenticação truncada é recusada", async () => {
    const [row] = await db.select().from(sourceCredentials).where(and(eq(sourceCredentials.tenantId, A), eq(sourceCredentials.secretRef, "vault:t1")));
    const short = Buffer.from(row.authTag, "base64").subarray(0, 4).toString("base64");
    await db.update(sourceCredentials).set({ authTag: short }).where(eq(sourceCredentials.id, row.id));
    await expect(store.resolve(A, "vault:t1")).rejects.toBeInstanceOf(CredentialNotFoundError);
    await db.update(sourceCredentials).set({ authTag: row.authTag }).where(eq(sourceCredentials.id, row.id));
  });

  it("chave de cifra ausente é erro de configuração, não 'não encontrada'", async () => {
    const broken = new PostgresCredentialStore(() => { throw new Error("config.FMCC_CREDENTIAL_KEY_missing"); });
    await expect(broken.resolve(A, "vault:t1")).rejects.toThrow("config.FMCC_CREDENTIAL_KEY_missing");
  });

  it("chave de cifra errada não decifra", async () => {
    const other = new PostgresCredentialStore(() => randomBytes(32));
    await expect(other.resolve(A, "vault:t1")).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("trocar a credencial atualiza a mesma linha", async () => {
    await store.save(A, "vault:t1", { kind: "api_key_pair", appKey: "K2", appSecret: "novo" });
    expect(await store.resolve(A, "vault:t1")).toMatchObject({ appKey: "K2" });
    const rows = await db.select().from(sourceCredentials).where(and(eq(sourceCredentials.tenantId, A), eq(sourceCredentials.secretRef, "vault:t1")));
    expect(rows).toHaveLength(1);
  });
});

describe("8E fatos vindos do ERP", () => {
  it("a versão mais nova da origem vence; a mais velha e a repetição não alteram", async () => {
    const source = await sources.create(A, { name: "Omie", sourceType: "omie", authoritativeDomain: "finance", syncMode: "pull" });
    const base = { tenantId: A, sourceId: source.id, mappingVersion: "omie.v1", correlationId: "c" };
    const fact = (status: string, at: string) => ({ externalId: "L1", factType: "finance.receivable", payload: { status }, sourceTimestamp: new Date(at) });
    await facts.ingest({ ...base, fact: fact("open", "2026-10-01T10:00:00Z") });
    await facts.ingest({ ...base, fact: fact("settled", "2026-10-05T10:00:00Z") });
    await facts.ingest({ ...base, fact: fact("open", "2026-10-02T10:00:00Z") }); // velha: ignorada
    await facts.ingest({ ...base, fact: fact("settled", "2026-10-05T10:00:00Z") }); // repetição
    const [afterRepeat] = await db.select().from(canonicalFacts).where(and(eq(canonicalFacts.tenantId, A), eq(canonicalFacts.sourceId, source.id)));
    await new Promise((r) => setTimeout(r, 20));
    await facts.ingest({ ...base, fact: fact("settled", "2026-10-06T10:00:00Z") }); // mesmo conteúdo, data nova: não toca a linha
    const [afterSame] = await db.select().from(canonicalFacts).where(and(eq(canonicalFacts.tenantId, A), eq(canonicalFacts.sourceId, source.id)));
    expect(afterSame.ingestedAt).toEqual(afterRepeat.ingestedAt);
    const rows = await db.select().from(canonicalFacts).where(and(eq(canonicalFacts.tenantId, A), eq(canonicalFacts.sourceId, source.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ status: "settled" });
  });

  it("unidade de outra empresa é recusada pelo banco", async () => {
    const source = await sources.create(B, { name: "Omie B", sourceType: "omie", authoritativeDomain: "finance", syncMode: "pull" });
    await expect(facts.ingest({
      tenantId: B, sourceId: source.id, mappingVersion: "omie.v1", correlationId: "c", unitId: unitA,
      fact: { externalId: "X", factType: "finance.receivable", payload: {}, sourceTimestamp: new Date() },
    })).rejects.toThrow();
  });

  it("ponta a ponta: sincroniza do simulador para o banco, com unidade e sem vazar entre empresas", async () => {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", { appSecret: "sec-a", receivables: [receivable(1, { codigo_departamento: "D1" }), receivable(2, { valor_documento: undefined })], payables: [] });
    sim.accounts.set("KEY-B", { appSecret: "sec-b", receivables: [receivable(77)], payables: [] });
    const source = await sources.create(A, {
      name: "Omie A2", sourceType: "omie", authoritativeDomain: "finance", syncMode: "pull",
      secretRef: "vault:e2e-a", config: { unitRefField: "codigo_departamento", unitMap: { D1: unitA } },
    });
    await store.save(A, "vault:e2e-a", { kind: "api_key_pair", appKey: "KEY-A", appSecret: "sec-a" });
    await store.save(B, "vault:e2e-b", { kind: "api_key_pair", appKey: "KEY-B", appSecret: "sec-b" });
    const runtime = new ConnectorRuntime(
      sources, new PostgresSyncRepository(), facts,
      [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)],
    );
    const result = await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "e2e-1" });
    expect(result).toMatchObject({ status: "completed", ingested: 2 });
    const rows = await db.select().from(canonicalFacts).where(and(eq(canonicalFacts.tenantId, A), eq(canonicalFacts.sourceId, source.id)));
    const byId = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(byId["receivable:1"].unitId).toBe(unitA);
    expect(byId["receivable:2"].unitId).toBeNull();
    expect(byId["receivable:2"].payload).not.toHaveProperty("amountMinor");
    expect(byId["receivable:2"].payload.unavailable).toContain("amountMinor");
    expect(await db.select().from(canonicalFacts).where(and(eq(canonicalFacts.tenantId, B), eq(canonicalFacts.externalId, "receivable:77")))).toHaveLength(0);
    // repetir a mesma chave de idempotência não relê o Omie
    const before = sim.calls.length;
    expect(await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "e2e-1" })).toMatchObject({ status: "duplicate" });
    expect(sim.calls.length).toBe(before);
  });
});
