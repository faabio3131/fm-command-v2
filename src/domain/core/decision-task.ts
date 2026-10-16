import { fail, isRecord, ok, type Validation } from "./result";
import { parseDecisionResponse, type DecisionResponse } from "./decision-response";

/** Confianca minima para aceitar uma decisao rapida sem escalar (ADR-017). Abaixo disso, vai para o planejador completo ou para uma pessoa. */
export const DEFAULT_DECISION_THRESHOLD = 0.8;

export interface DecisionOption { readonly id: string; readonly label: string }

/** Pedido do tipo de tarefa "decisao": uma pergunta curta com resposta fechada (escolha, sim/nao ou nota). */
export type DecisionRequest =
  | { readonly kind: "choice"; readonly question: string; readonly options: readonly DecisionOption[] }
  | { readonly kind: "yes_no"; readonly question: string }
  | { readonly kind: "score"; readonly question: string; readonly min: number; readonly max: number };

export const DECISION_LIMITS = { question: 2000, options: 32, id: 128, label: 200 } as const;

const nonEmpty = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function parseDecisionRequest(v: unknown): Validation<DecisionRequest> {
  if (!isRecord(v)) return fail("decision.request_must_be_object");
  if (!nonEmpty(v.question, DECISION_LIMITS.question)) return fail("decision.question_invalid");
  switch (v.kind) {
    case "yes_no": return ok({ kind: "yes_no", question: v.question });
    case "score": {
      const { min, max } = v;
      if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) return fail("decision.score_range_invalid");
      return ok({ kind: "score", question: v.question, min, max });
    }
    case "choice": {
      const raw = v.options;
      if (!Array.isArray(raw) || raw.length < 2 || raw.length > DECISION_LIMITS.options) return fail("decision.options_count_invalid");
      const options: DecisionOption[] = [];
      for (const o of raw) {
        if (!isRecord(o) || !nonEmpty(o.id, DECISION_LIMITS.id) || !nonEmpty(o.label, DECISION_LIMITS.label)) return fail("decision.option_invalid");
        options.push({ id: o.id, label: o.label });
      }
      if (new Set(options.map((o) => o.id)).size !== options.length) return fail("decision.options_must_be_unique");
      return ok({ kind: "choice", question: v.question, options });
    }
    default: return fail("decision.kind_unknown");
  }
}

/** Prompt enxuto de proposito: so a pergunta e as opcoes, sem catalogo inteiro. E isso que torna a decisao rapida barata. */
export function buildDecisionPrompt(req: DecisionRequest): { system: string; user: string; maxTokens: number } {
  const shape = req.kind === "choice" ? '{"chosen":"<id de uma das opções>","probability":0.0}'
    : req.kind === "yes_no" ? '{"answer":true,"probability":0.0}'
    : `{"value":<número entre ${req.min} e ${req.max}>,"probability":0.0}`;
  const system = [
    "Você decide rápido uma pergunta fechada para o FM Command.",
    "Responda somente JSON, sem texto fora dele, no formato " + shape + ".",
    "probability é sua confiança real de 0 a 1: use valor baixo quando houver ambiguidade; nunca invente certeza.",
    "Escolha somente entre as opções dadas. Não invente opções, números ou fatos.",
  ].join(" ");
  const user = req.kind === "choice"
    ? JSON.stringify({ question: req.question, options: req.options })
    : JSON.stringify(req);
  return { system, user, maxTokens: 80 };
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{"); const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(text.slice(a, b + 1)) as unknown; return isRecord(o) ? o : null; } catch { return null; }
}

/**
 * Transforma o texto do modelo em DecisionResponse. As opcoes e o intervalo vem do PEDIDO, nunca do eco do modelo:
 * o modelo so escolhe. Opcao fora da lista, nota fora do intervalo ou probabilidade invalida = saida invalida.
 */
export function interpretDecision(req: DecisionRequest, text: string): Validation<DecisionResponse> {
  const o = parseJsonLoose(text);
  if (!o) return fail("decision.model_output_not_json");
  if (req.kind === "choice")
    return parseDecisionResponse({ kind: "choice", options: req.options.map((x) => x.id), chosen: o.chosen, probability: o.probability });
  if (req.kind === "yes_no") return parseDecisionResponse({ kind: "yes_no", answer: o.answer, probability: o.probability });
  return parseDecisionResponse({ kind: "score", min: req.min, max: req.max, value: o.value, probability: o.probability });
}
