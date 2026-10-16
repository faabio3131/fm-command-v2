import { costMicroMinor, type ProviderPricing } from "@/domain/core/ai-provider";

/** Avaliacao de decisoes rapidas contra o planejador (etapa 7). Pura: quem chama fornece os modelos e os casos. */
export interface EvalCase {
  readonly id: string;
  readonly locale: "pt-BR" | "en-US";
  readonly difficulty: "easy" | "hard";
  readonly question: string;
  readonly options: readonly { id: string; label: string }[];
  /** Resposta esperada, definida por quem montou o conjunto (nunca por um modelo). */
  readonly gold: string;
}

export interface EvalCall { readonly chosen: string; readonly probability: number; readonly tokensIn: number; readonly tokensOut: number; readonly latencyMs: number }
export interface EvalModel { readonly name: string; readonly pricing: ProviderPricing; call(c: EvalCase): Promise<EvalCall> }

export interface ModelReport {
  readonly name: string;
  readonly accuracy: number;
  readonly accuracyEasy: number;
  readonly accuracyHard: number;
  readonly costMicroMinor: number;
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export interface EvalReport {
  readonly cases: number;
  readonly threshold: number;
  readonly planner: ModelReport;
  readonly fast: ModelReport;
  /** Fração em que o modelo rápido escolheu o mesmo que o planejador. */
  readonly agreement: number;
  /** Fração dos casos com confiança abaixo do limite (vão para o planejador). */
  readonly escalationRate: number;
  /** Acerto entre os casos que o modelo rápido aceitou (confiança >= limite). */
  readonly acceptedAccuracy: number;
  /** Aceitou com confiança e errou: o erro que mais importa. */
  readonly confidentWrong: number;
  /** Rápido primeiro, planejador só nos casos de baixa confiança. */
  readonly cascade: { readonly accuracy: number; readonly costMicroMinor: number; readonly avgLatencyMs: number; readonly p95LatencyMs: number };
}

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d);
function p95(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!; }
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function evaluate(cases: readonly EvalCase[], planner: EvalModel, fast: EvalModel, threshold: number): Promise<EvalReport> {
  if (!cases.length) throw new Error("eval.no_cases");
  const pCalls: EvalCall[] = []; const fCalls: EvalCall[] = [];
  for (const c of cases) { pCalls.push(await planner.call(c)); fCalls.push(await fast.call(c)); }

  const report = (m: EvalModel, calls: EvalCall[]): ModelReport => {
    const ok = calls.map((r, i) => r.chosen === cases[i]!.gold);
    const sub = (d: "easy" | "hard") => { const idx = cases.map((c, i) => (c.difficulty === d ? i : -1)).filter((i) => i >= 0); return pct(idx.filter((i) => ok[i]).length, idx.length); };
    const lat = calls.map((r) => r.latencyMs);
    return {
      name: m.name, accuracy: pct(ok.filter(Boolean).length, ok.length), accuracyEasy: sub("easy"), accuracyHard: sub("hard"),
      costMicroMinor: calls.reduce((s, r) => s + costMicroMinor(r.tokensIn, r.tokensOut, m.pricing), 0),
      avgLatencyMs: avg(lat), p95LatencyMs: p95(lat), tokensIn: calls.reduce((s, r) => s + r.tokensIn, 0), tokensOut: calls.reduce((s, r) => s + r.tokensOut, 0),
    };
  };

  const accepted = fCalls.map((r) => r.probability >= threshold);
  const acceptedIdx = accepted.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const confidentWrong = acceptedIdx.filter((i) => fCalls[i]!.chosen !== cases[i]!.gold).length;
  const cascadeChoice = cases.map((_, i) => (accepted[i] ? fCalls[i]! : pCalls[i]!));
  const cascadeLat = cases.map((_, i) => fCalls[i]!.latencyMs + (accepted[i] ? 0 : pCalls[i]!.latencyMs));
  const cascadeCost = cases.reduce((s, _, i) => s + costMicroMinor(fCalls[i]!.tokensIn, fCalls[i]!.tokensOut, fast.pricing)
    + (accepted[i] ? 0 : costMicroMinor(pCalls[i]!.tokensIn, pCalls[i]!.tokensOut, planner.pricing)), 0);

  return {
    cases: cases.length, threshold, planner: report(planner, pCalls), fast: report(fast, fCalls),
    agreement: pct(cases.filter((_, i) => fCalls[i]!.chosen === pCalls[i]!.chosen).length, cases.length),
    escalationRate: pct(accepted.filter((a) => !a).length, cases.length),
    acceptedAccuracy: pct(acceptedIdx.filter((i) => fCalls[i]!.chosen === cases[i]!.gold).length, acceptedIdx.length),
    confidentWrong,
    cascade: {
      accuracy: pct(cascadeChoice.filter((r, i) => r.chosen === cases[i]!.gold).length, cases.length),
      costMicroMinor: cascadeCost, avgLatencyMs: avg(cascadeLat), p95LatencyMs: p95(cascadeLat),
    },
  };
}
