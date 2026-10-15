import { fail, isRecord, ok, type Validation } from "./result";

/**
 * Resposta tipada do tipo de tarefa "decisão" (ADR-017): escolha, nota ou sim/não,
 * sempre com probabilidade. Abaixo do limite, vai para uma pessoa.
 */
export type DecisionResponse =
  | { readonly kind: "choice"; readonly options: readonly string[]; readonly chosen: string; readonly probability: number }
  | { readonly kind: "score"; readonly min: number; readonly max: number; readonly value: number; readonly probability: number }
  | { readonly kind: "yes_no"; readonly answer: boolean; readonly probability: number };

const isProb = (p: unknown): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

export function parseDecisionResponse(v: unknown): Validation<DecisionResponse> {
  if (!isRecord(v)) return fail("decision.must_be_object");
  if (!isProb(v.probability)) return fail("decision.probability_0_to_1");
  switch (v.kind) {
    case "yes_no":
      return typeof v.answer === "boolean" ? ok(v as unknown as DecisionResponse) : fail("decision.answer_must_be_boolean");
    case "choice": {
      const opts = v.options;
      if (!Array.isArray(opts) || opts.length < 2 || !opts.every((o) => typeof o === "string" && o.length > 0))
        return fail("decision.options_need_two_or_more_strings");
      if (new Set(opts).size !== opts.length) return fail("decision.options_must_be_unique");
      if (typeof v.chosen !== "string" || !opts.includes(v.chosen)) return fail("decision.chosen_not_in_options");
      return ok(v as unknown as DecisionResponse);
    }
    case "score": {
      const { min, max, value } = v;
      if (![min, max, value].every((n) => typeof n === "number" && Number.isFinite(n))) return fail("decision.score_numbers_required");
      if ((min as number) >= (max as number)) return fail("decision.score_min_below_max");
      if ((value as number) < (min as number) || (value as number) > (max as number)) return fail("decision.score_out_of_range");
      return ok(v as unknown as DecisionResponse);
    }
    default:
      return fail("decision.kind_unknown");
  }
}

/** Abaixo do limite de confiança, a decisão vai para uma pessoa. */
export function needsHuman(d: DecisionResponse, threshold: number): boolean {
  return d.probability < threshold;
}
