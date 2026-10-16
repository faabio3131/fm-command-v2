import { describe, expect, it } from "vitest";
import transport from "@/domain/sectors/packs/transport.json";
import industry from "@/domain/sectors/packs/industry.json";
import { SECTOR_PACKS, packMetricName } from "@/domain/sectors/catalog";
import { packMetricToDefinition, SectorPackError, validateSectorPack } from "@/domain/sectors/sector-pack";
import { BASE_METRIC_REGISTRY, METRIC_REGISTRY } from "@/domain/metrics/registry";

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = () => JSON.parse(JSON.stringify(transport)) as Loose;
const bad = (mutate: (p: Loose) => void) => {
  const p = clone(); mutate(p);
  expect(() => validateSectorPack(p)).toThrow(SectorPackError);
};

describe("pacotes por setor: validação", () => {
  it("os pacotes entregues são válidos e os ids de métrica não colidem com a plataforma", () => {
    expect(SECTOR_PACKS.map((p) => p.id).sort()).toEqual(["industry", "transport"]);
    validateSectorPack(transport); validateSectorPack(industry);
    const ids = METRIC_REGISTRY.map((m) => m.metricId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BASE_METRIC_REGISTRY.length).toBeLessThan(METRIC_REGISTRY.length);
  });
  it("soma de pacote vira centavos com moeda; contagem não carrega valor", () => {
    const pack = SECTOR_PACKS.find((p) => p.id === "transport")!;
    const sum = packMetricToDefinition(pack, pack.metrics.find((m) => m.kind === "sum")!);
    expect(sum).toMatchObject({ valueField: "amountMinor", valueScale: "minor", currencyField: "currency", unit: "currency" });
    const count = packMetricToDefinition(pack, pack.metrics.find((m) => m.kind === "count")!);
    expect(count.valueField).toBeUndefined();
    expect(count.unit).toBe("count");
  });
  it("nome da métrica sai nos dois idiomas", () => {
    expect(packMetricName("transport.freight.revenue", "pt-BR")).toBeTruthy();
    expect(packMetricName("transport.freight.revenue", "en-US")).not.toBe(packMetricName("transport.freight.revenue", "pt-BR"));
    expect(packMetricName("finance.receivable.open_amount", "pt-BR")).toBeNull();
  });
  it("recusa pacote malformado", () => {
    bad((p) => { p.id = "Transporte!"; });
    bad((p) => { p.facts[0].factType = "delivery"; });
    bad((p) => { p.facts[0].factType = "finance.delivery"; });
    bad((p) => { p.facts[0].statusMeaning.paid = p.facts[0].statusMeaning.open; });
    bad((p) => { p.metrics[1].id = p.metrics[0].id; });
    bad((p) => { p.metrics[0].id = "outro.metrica"; });
    bad((p) => { p.metrics[0].factType = "transport.inexistente"; });
    bad((p) => { p.metrics[0].statuses = ["paid"]; });
    bad((p) => { const f = p.facts.find((x: Loose) => x.factType === "transport.delivery"); f.money = false; });
    bad((p) => { delete p.label["en-US"]; });
    bad((p) => { p.sections[0].metricIds = ["transport.nao.existe"]; });
    bad((p) => { p.suggestedReport.metricIds = ["transport.nao.existe"]; });
    bad((p) => { p.suggestedReport.hour = 25; });
    bad((p) => { p.facts = []; });
  });
});
