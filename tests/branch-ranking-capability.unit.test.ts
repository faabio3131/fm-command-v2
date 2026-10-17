import { describe, expect, it } from "vitest";
import { BranchRankingCapability, DEFAULT_RANKING_METRIC } from "@/application/core/branch-ranking-capability";
import { summarizeSource, type UnitComparisonView } from "@/application/metrics/unit-comparison-service";
import type { MetricView } from "@/application/metrics/metric-service";
import { compareBranches } from "@/domain/metrics/unit-comparison";
import type { OrgUnit } from "@/domain/organization/unit-hierarchy";
import type { TenantContext } from "@/domain/security/tenant-context";

const ctx: TenantContext = { tenantId: "t", userId: "u", role: "owner", correlationId: "c" };
const unit = (id: string): OrgUnit => ({ id, tenantId: "t", kind: "branch", parentId: null, name: `Filial ${id}`, status: "active" } as OrgUnit);
const view = (metricId: string, rows: [string, string | null][], over: Partial<MetricView> = {}): UnitComparisonView => {
  const mv = rows.map(([unitId, value]): MetricView => ({
    unitId, metricId, metricVersion: 1, value, unit: "currency", currency: "BRL", computedAt: new Date(), freshnessStatus: "fresh",
    qualityStatus: "verified", sourceAuthority: "fmcc_metric_engine", provenanceRefs: [`fact:${unitId}`], ...over,
  }));
  return {
    metricId, regions: [], source: summarizeSource(mv),
    comparison: compareBranches(rows.map(([id]) => unit(id)), mv.map((v) => ({ unitId: v.unitId!, value: v.value, currency: v.currency })), null),
  };
};
const calls: string[] = [];
const fake = (views: Record<string, UnitComparisonView>) => ({ async compare(_c: TenantContext, i: { metricId: string }) { calls.push(i.metricId); return views[i.metricId]; } });

describe("capacidade: ranking de filiais para o Core", () => {
  it("ranqueia a métrica que o plano escolheu e entrega evidência com proveniência real", async () => {
    calls.length = 0;
    const cap = new BranchRankingCapability(fake({ "revenue.cash_collected": view("revenue.cash_collected", [["A", "300"], ["B", "200"], ["C", "100"]]) }));
    const r = await cap.read(ctx, { productSlugs: [], metricIds: ["revenue.cash_collected"] });
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    const [ranking] = (r.fact.rankings as { metricId: string; positions: { position: number }[]; higherIsWorse: boolean }[]);
    expect(ranking).toMatchObject({ metricId: "revenue.cash_collected", higherIsWorse: false });
    expect(ranking.positions.map((p) => p.position)).toEqual([1, 2, 3]);
    expect(r.evidence).toMatchObject({ kind: "source", ref: "branch-ranking", sourceAuthority: "fmcc_metric_engine", freshnessStatus: "fresh", qualityStatus: "verified" });
    expect([...(r.evidence.provenanceRefs ?? [])].sort()).toEqual(["fact:A", "fact:B", "fact:C"]);
  });
  it("sem métrica útil no plano usa o faturamento; métricas que não são de soma/contagem do período são ignoradas", async () => {
    calls.length = 0;
    const cap = new BranchRankingCapability(fake({ [DEFAULT_RANKING_METRIC]: view(DEFAULT_RANKING_METRIC, [["A", "2"], ["B", "1"]]) }));
    await cap.read(ctx, { productSlugs: [], metricIds: [] });
    await cap.read(ctx, { productSlugs: [], metricIds: ["finance.receivable.balance", "metrica.inexistente"] });
    expect(calls).toEqual([DEFAULT_RANKING_METRIC, DEFAULT_RANKING_METRIC]);
  });
  it("respeita o pacote do setor, limita a 3 métricas e marca custo/falha como 'maior preocupa'", async () => {
    calls.length = 0;
    const ids = ["billing.gross_billed", "revenue.cash_collected", "cost.operating.total", "lead.created.count"];
    const views = Object.fromEntries(ids.map((id) => [id, view(id, [["A", "2"], ["B", "1"]])]));
    const cap = new BranchRankingCapability(fake(views), async () => new Set(ids.filter((i) => i !== "revenue.cash_collected")));
    const r = await cap.read(ctx, { productSlugs: [], metricIds: ids });
    expect(calls).toEqual(["billing.gross_billed", "cost.operating.total", "lead.created.count"]);
    if (r.status !== "available") throw new Error("esperava disponível");
    const rankings = r.fact.rankings as { metricId: string; higherIsWorse: boolean }[];
    expect(rankings.find((x) => x.metricId === "cost.operating.total")?.higherIsWorse).toBe(true);
    expect(rankings.find((x) => x.metricId === "billing.gross_billed")?.higherIsWorse).toBe(false);
  });
  it("não responde por produto (não há leitura por filial e produto) nem sem dado, nem com moedas misturadas", async () => {
    const cap = new BranchRankingCapability(fake({ [DEFAULT_RANKING_METRIC]: view(DEFAULT_RANKING_METRIC, [["A", null], ["B", null]]) }));
    expect((await cap.read(ctx, { productSlugs: ["kordena"], metricIds: [] })).status).toBe("unavailable");
    expect((await cap.read(ctx, { productSlugs: [], metricIds: [] })).status).toBe("unavailable");
    const base = view(DEFAULT_RANKING_METRIC, [["A", "10"], ["B", "20"]]);
    const mixed = { ...base, comparison: compareBranches([unit("A"), unit("B")], [{ unitId: "A", value: "10", currency: "BRL" }, { unitId: "B", value: "20", currency: "USD" }], null) };
    expect((await new BranchRankingCapability(fake({ [DEFAULT_RANKING_METRIC]: mixed })).read(ctx, { productSlugs: [], metricIds: [] })).status).toBe("unavailable");
  });
  it("a evidência assume o pior estado entre as filiais (nunca parece mais fresca que o dado)", () => {
    const base = { metricId: "m", metricVersion: 1, value: "1", unit: "currency", computedAt: new Date(), sourceAuthority: "x", provenanceRefs: ["r"] } as const;
    const s = summarizeSource([
      { ...base, unitId: "A", freshnessStatus: "fresh", qualityStatus: "verified", periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") },
      { ...base, unitId: "B", freshnessStatus: "stale", qualityStatus: "estimated", periodStart: new Date("2026-09-30"), periodEnd: new Date("2026-10-17") },
      { ...base, unitId: "C", value: null, freshnessStatus: "unavailable", qualityStatus: "missing" },
    ]);
    expect(s).toMatchObject({ freshnessStatus: "stale", qualityStatus: "estimated" });
    expect(s?.periodStart).toEqual(new Date("2026-09-30"));
    expect(summarizeSource([{ ...base, value: null, freshnessStatus: "unavailable", qualityStatus: "missing" }])).toBeNull();
  });
});
