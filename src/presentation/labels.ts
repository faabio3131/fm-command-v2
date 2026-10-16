import type { Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { ptBR } from "@/i18n/messages/pt-BR";

/**
 * Rótulos de códigos do domínio (status, métrica, severidade...) no idioma da tela.
 * Os textos ficam nos catálogos (chaves `label.<grupo>.<código>`); código desconhecido cai em `label.<grupo>.default`.
 * Em pt-BR devolve exatamente o que `presentation/pt-br.ts` devolvia.
 */
export function createLabels(locale: Locale) {
  const { t } = createTranslator(locale);
  const pick = (group: string, code?: string): string => {
    const specific = `label.${group}.${code ?? ""}`;
    if (code && specific in ptBR) return t(specific as MessageKey);
    return t(`label.${group}.default` as MessageKey);
  };
  return {
    productStatus: (status: string) => pick("productStatus", status),
    productCategory: (category: string) => pick("productCategory", category),
    freshness: (status: string) => pick("freshness", status),
    quality: (status: string) => pick("quality", status),
    definitionStatus: (status: string) => pick("definitionStatus", status),
    comparisonState: (status?: string) => pick("comparisonState", status),
    comparisonMessage: (status?: string) => pick("comparisonMessage", status),
    growthDirection: (direction?: string) => pick("growthDirection", direction),
    unit: (unit?: string) => pick("unit", unit),
    productCreateError: (code?: string) => pick("productCreateError", code),
    compareError: (code?: string) => pick("compareError", code),
    metric: (metricId: string) => pick("metric", metricId),
    sourceAuthority: (authority?: string) => pick("sourceAuthority", authority),
    alertOperator: (operator: string) => pick("alertOperator", operator),
    alertSeverity: (severity: string) => pick("alertSeverity", severity),
    ruleState: (enabled: boolean, archived: boolean) =>
      t(archived ? "rule.life.archived" : enabled ? "rule.state.active" : "rule.life.disabled"),
    occurrenceState: (status: string) => pick("occurrenceState", status),
    riskLevel: (level?: string) => pick("riskLevel", level),
    role: (role: string) => pick("role", role),
  };
}

export type Labels = ReturnType<typeof createLabels>;
