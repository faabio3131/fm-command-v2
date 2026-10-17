import { describe, expect, it } from "vitest";
import { PRODUCT_RANKING_METRIC, ProductRankingCapability } from "@/application/core/product-ranking-capability";
import type { DimensionRankingView } from "@/application/metrics/dimension-ranking-service";
import type { DimensionRankRow } from "@/domain/metrics/dimension-ranking";
import type { TenantContext } from "@/domain/security/tenant-context";

const ctx: TenantContext = { tenantId: "t", userId: "u", role: "owner", correlationId: "c" };
const row = (key: string, value: string | null, rank: number | null, share: string | null = null, label = `Produto ${key}`): DimensionRankRow =>
  ({ key, label, value, currency: "BRL", rank, sharePercent: share, facts: 1 });
const view = (rows: DimensionRankRow[], over: Partial<DimensionRankingView> = {}, rankingOver: Record<string, unknown> = {}): DimensionRankingView => {
  const ranked = rows.filter((r) => r.rank !== null);
  const last = ranked.length ? Math.max(...ranked.map((r) => r.rank as number)) : 0;
  return {
    metricId: PRODUCT_RANKING_METRIC, dimension: "productRef", periodKind: "current", periodStart: new Date("2026-10-01T03:00:00Z"), periodEnd: new Date("2026-10-17T21:00:00Z"),
    branchCount: 2, fullCompany: true, rankedCount: ranked.length, lowest: ranked.length >= 2 && last > 1 ? ranked.filter((r) => r.rank === last) : null,
    ranking: { dimension: "productRef", rows, total: { value: "100", currency: "BRL" }, rankingSuspended: false, withoutDimension: 0, provenanceRefs: ["f1", "f2"], latestSourceTimestamp: new Date(), ...rankingOver },
    ...over,
  };
};
const fake = (v: DimensionRankingView | Error, seen: unknown[] = []) => ({ async rank(_c: TenantContext, input: unknown) { seen.push(input); if (v instanceof Error) throw v; return v; } });
const cap = (v: DimensionRankingView | Error, visible?: ReadonlySet<string>, seen: unknown[] = []) =>
  new ProductRankingCapability(fake(v, seen), async () => "America/Sao_Paulo", visible ? async () => visible : undefined);

describe("capacidade: ranking de produtos para o Core", () => {
  it("entrega 1ª, 2ª e 3ª posição, o menos vendido, o total e a evidência do motor", async () => {
    const seen: unknown[] = [];
    const r = await cap(view([row("A", "60", 1, "60.0"), row("B", "30", 2, "30.0"), row("C", "10", 3, "10.0")]), undefined, seen).read(ctx, { productSlugs: [] });
    expect(seen[0]).toMatchObject({ metricId: PRODUCT_RANKING_METRIC, dimension: "productRef", timeZone: "America/Sao_Paulo" });
    if (r.status !== "available") throw new Error("esperava disponível");
    expect(r.fact).toMatchObject({ capabilityId: "sales.product_ranking", scope: "branches_visible_to_user", period: "current", total: { value: "100", currency: "BRL" }, productsRanked: 3, linesWithoutProduct: 0, coversWholeCompany: true });
    expect((r.fact.positions as { position: number; products: { productRef: string }[] }[]).map((p) => [p.position, p.products.map((x) => x.productRef)])).toEqual([[1, ["A"]], [2, ["B"]], [3, ["C"]]]);
    expect((r.fact.lowest as { productRef: string }[]).map((x) => x.productRef)).toEqual(["C"]);
    expect(r.evidence).toMatchObject({ kind: "source", ref: "product-ranking", sourceAuthority: "fmcc_metric_engine", provenanceRefs: ["f1", "f2"] });
    expect(r.evidence.periodStart).toBe("2026-10-01T03:00:00.000Z");
  });

  it("empate divide a posição; com um só produto não há 'menos vendido'", async () => {
    const tied = await cap(view([row("A", "50", 1), row("B", "50", 1), row("C", "10", 3)])).read(ctx, { productSlugs: [] });
    if (tied.status !== "available") throw new Error("esperava disponível");
    expect((tied.fact.positions as { position: number }[]).map((p) => p.position)).toEqual([1, 3]);
    const single = await cap(view([row("A", "50", 1)])).read(ctx, { productSlugs: [] });
    if (single.status !== "available") throw new Error("esperava disponível");
    expect(single.fact.lowest).toBeNull();
  });

  it("produto sem valor aparece à parte (nunca zero) e linhas sem código são avisadas; escopo parcial é dito", async () => {
    const r = await cap(view([row("A", "50", 1), row("Z", null, null, null, "Produto Z")], { fullCompany: false }, { withoutDimension: 3 })).read(ctx, { productSlugs: [] });
    if (r.status !== "available") throw new Error("esperava disponível");
    expect(r.fact).toMatchObject({ productsWithoutValue: ["Produto Z"], linesWithoutProduct: 3, coversWholeCompany: false, productsRanked: 1 });
    expect((r.fact.top as { productRef: string }[]).map((x) => x.productRef)).toEqual(["A"]);
  });

  it("não responde sem dado, com moedas misturadas, por produto da plataforma, fora do pacote do setor ou se o motor falhar", async () => {
    expect((await cap(view([])).read(ctx, { productSlugs: [] })).status).toBe("unavailable");
    expect((await cap(view([row("A", "1", null)], {}, { rankingSuspended: true, total: null })).read(ctx, { productSlugs: [] })).status).toBe("unavailable");
    expect((await cap(view([row("A", "1", 1)])).read(ctx, { productSlugs: ["kordena"] })).status).toBe("unavailable");
    expect((await cap(view([row("A", "1", 1)]), new Set(["billing.gross_billed"])).read(ctx, { productSlugs: [] })).status).toBe("unavailable");
    expect((await cap(new Error("metrics.region_not_available")).read(ctx, { productSlugs: [] })).status).toBe("unavailable");
  });
});
