/**
 * Agente piloto: resumo semanal para a diretoria (etapa 11). Regras puras, sem banco nem IA.
 * O agente só redige; os números vêm do serviço de métricas, e nada é enviado sem aprovação de uma pessoa.
 */
export const WEEKLY_SUMMARY_AGENT = "weekly_summary";

/** Tamanho máximo da resposta (e, portanto, do custo de uma chamada). */
export const WEEKLY_SUMMARY_MAX_TOKENS = 700;

/** Semana (segunda a domingo) da data local: "2026-W42". */
export function weekKey(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7; // segunda = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // quinta da semana: define o ano ISO
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export interface PromptInput {
  readonly locale: string;
  readonly dateText: string;
  /** Linhas "Métrica: valor" já formatadas; sem dado vem como indisponível. */
  readonly lines: readonly string[];
  readonly unavailableWord: string;
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const language = input.locale.startsWith("en") ? "English" : "Brazilian Portuguese";
  const system = [
    `You write the weekly executive summary of a company's numbers, in ${language}, for its director.`,
    "Rules, all mandatory:",
    "1. Use ONLY the numbers in the list. Never invent, estimate, round, convert, sum or compare numbers that are not literally listed.",
    `2. A metric marked "${input.unavailableWord}" has no data: say it is unavailable. Never treat it as zero.`,
    "3. Write 90 to 180 words in 2 short paragraphs: what the numbers show, then what needs attention. No headings, no lists, no greeting.",
    "4. Do not give instructions that act on anything (no 'send', 'charge', 'cancel'); you only describe.",
  ].join("\n");
  const user = [`Date: ${input.dateText}`, "Numbers:", ...input.lines.map((l) => `- ${l}`)].join("\n");
  return { system, user };
}

const NUMBER = /\d[\d.,]*/g;
const digitsOnly = (s: string) => s.replace(/\D/g, "");

/**
 * Números que aparecem no texto mas não estavam nos dados entregues (comparação pelos dígitos, sem separadores).
 * O texto é de um modelo: este aviso é para a pessoa ver antes de aprovar; não substitui a aprovação.
 */
export function unverifiedNumbers(text: string, sources: readonly string[]): string[] {
  const allowed = new Set(sources.flatMap((s) => s.match(NUMBER) ?? []).map(digitsOnly).filter(Boolean));
  const found = new Set<string>();
  for (const token of text.match(NUMBER) ?? []) {
    const clean = token.replace(/[.,]+$/, "");
    const digits = digitsOnly(clean);
    if (digits && !allowed.has(digits)) found.add(clean);
  }
  return [...found];
}

export interface BudgetState {
  readonly enabled: boolean;
  readonly capMicroMinor: number;
  readonly reserveMicroMinor: number;
  readonly currency: string;
  /** Custo real dos rascunhos do mês, na moeda do orçamento. */
  readonly spentMicroMinor: number;
  readonly inFlight: number;
  /** Algum custo do mês veio em outra moeda: não dá para comparar com o teto. */
  readonly currencyMismatch: boolean;
}

export type BudgetDecision = { allowed: true } | { allowed: false; reason: "agent.disabled" | "agent.budget_exhausted" | "agent.budget_currency_mismatch" };

/** Pedir um rascunho só é permitido se o gasto do mês, as reservas em andamento e a reserva deste pedido cabem no teto. */
export function budgetDecision(b: BudgetState | null): BudgetDecision {
  if (!b || !b.enabled) return { allowed: false, reason: "agent.disabled" };
  if (b.currencyMismatch) return { allowed: false, reason: "agent.budget_currency_mismatch" };
  const committed = b.spentMicroMinor + b.inFlight * b.reserveMicroMinor + b.reserveMicroMinor;
  return committed <= b.capMicroMinor ? { allowed: true } : { allowed: false, reason: "agent.budget_exhausted" };
}
