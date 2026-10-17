/**
 * Sentido de leitura de uma métrica: nas listadas aqui, subir é RUIM (incidentes, falhas, erros, custos, dívida, cancelamentos).
 * Nas demais, subir é bom (receita, leads, uso). A variação mostrada no painel usa isso para a cor; a seta continua indicando só a direção.
 * Métrica que não estiver na lista é tratada como "subir é bom", então toda métrica nova de custo ou falha deve entrar aqui.
 */
const HIGHER_IS_WORSE: ReadonlySet<string> = new Set([
  "incident.count",
  "job.failure.count",
  "integration.failure.count",
  "service.error.count",
  "service.error.rate",
  "support.ticket.open.count",
  "receivable.delinquent_amount",
  "finance.receivable.overdue_amount",
  "finance.payable.overdue_amount",
  "finance.payable.open_amount",
  "cost.infrastructure.total",
  "cost.operating.total",
  "subscription.cancelled.count",
  "subscription.logo_churn.rate",
]);

export function higherIsWorse(metricId: string): boolean {
  return HIGHER_IS_WORSE.has(metricId);
}

export type DeltaTone = "good" | "bad" | "flat";

/** Cor da variação: "good" ou "bad" conforme o sentido da métrica; sem variação fica "flat". */
export function deltaTone(metricId: string, direction: "up" | "down" | "flat"): DeltaTone {
  if (direction === "flat") return "flat";
  const worseWhenUp = higherIsWorse(metricId);
  return (direction === "up") === worseWhenUp ? "bad" : "good";
}
