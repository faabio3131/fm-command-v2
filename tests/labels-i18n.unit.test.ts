import { describe, expect, it } from "vitest";
import * as pt from "../src/presentation/pt-br";
import { createLabels } from "../src/presentation/labels";

describe("rótulos por idioma", () => {
  const ptL = createLabels("pt-BR");
  const enL = createLabels("en-US");

  it("em pt-BR devolvem exatamente o que o módulo antigo devolvia (inclusive códigos desconhecidos)", () => {
    const codes = ["active", "inactive", "fresh", "stale", "verified", "missing", "implemented", "comparable", "incompatible_currency", "increased", "count", "currency", "gt", "lte", "info", "critical", "acknowledged", "low", "high", "owner", "viewer", "revenue.mrr", "incident.count", "billing-authority", "product.slug_conflict", "product.compare_metric_required", "codigo_inexistente", ""];
    for (const c of codes) {
      expect(ptL.productStatus(c)).toBe(pt.rotuloStatusProduto(c));
      expect(ptL.productCategory(c)).toBe(pt.rotuloCategoriaProduto(c));
      expect(ptL.freshness(c)).toBe(pt.rotuloAtualidade(c));
      expect(ptL.quality(c)).toBe(pt.rotuloQualidade(c));
      expect(ptL.definitionStatus(c)).toBe(pt.rotuloStatusDefinicao(c));
      expect(ptL.comparisonState(c)).toBe(pt.rotuloEstadoComparacao(c));
      expect(ptL.comparisonMessage(c)).toBe(pt.mensagemEstadoComparacao(c));
      expect(ptL.growthDirection(c)).toBe(pt.rotuloDirecaoCrescimento(c));
      expect(ptL.unit(c)).toBe(pt.rotuloUnidade(c));
      expect(ptL.productCreateError(c)).toBe(pt.mensagemErroCadastroProduto(c));
      expect(ptL.compareError(c)).toBe(pt.mensagemErroComparacao(c));
      expect(ptL.metric(c)).toBe(pt.rotuloMetrica(c));
      expect(ptL.sourceAuthority(c)).toBe(pt.rotuloAutoridadeFonte(c));
      expect(ptL.alertOperator(c)).toBe(pt.rotuloOperadorAlerta(c));
      expect(ptL.alertSeverity(c)).toBe(pt.rotuloSeveridadeAlerta(c));
      expect(ptL.occurrenceState(c)).toBe(pt.rotuloEstadoOcorrencia(c));
      expect(ptL.riskLevel(c)).toBe(pt.rotuloNivelRiscoAcao(c));
      expect(ptL.role(c)).toBe(pt.rotuloPapelFmcc(c));
    }
    for (const [e, a] of [[true, false], [false, false], [true, true], [false, true]] as const) {
      expect(ptL.ruleState(e, a)).toBe(pt.rotuloEstadoRegraAlerta(e, a));
    }
  });

  it("em en-US os rótulos estão em inglês e código desconhecido cai no padrão do grupo", () => {
    expect(enL.metric("revenue.mrr")).toBe("Monthly recurring revenue");
    expect(enL.alertSeverity("critical")).toBe("Critical");
    expect(enL.freshness("stale")).toBe("Outdated");
    expect(enL.metric("nao.existe")).toBe("Governed metric");
    expect(enL.role("owner")).toBe("Owner");
  });
});
