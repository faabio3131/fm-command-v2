/**
 * Avaliação da etapa 7: decisão rápida x planejador atual, em dados SINTÉTICOS e com modelos SIMULADOS (sem rede, sem chave, sem gasto).
 * O que é real aqui: o conjunto de casos, o tamanho dos prompts (tokens estimados a partir do texto que o sistema realmente envia), a conta
 * de custo exata e o método de medir. O que é simulado: a resposta, a confiança e o tempo dos modelos, por parâmetros declarados abaixo.
 * Portanto os números de acerto/tempo NÃO medem qualidade de modelo real; isso só acontece quando a chave real entrar.
 * Uso: npx tsx scripts/eval/decision-eval.ts [saida.json]
 */
import { writeFileSync } from "node:fs";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { LlmCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";
import { buildDecisionPrompt, DEFAULT_DECISION_THRESHOLD } from "@/domain/core/decision-task";
import { evaluate, type EvalCall, type EvalCase, type EvalModel } from "@/application/core/decision-eval";

// ---- conjunto sintético: escrito à mão, resposta esperada = a métrica certa ----
const PHRASES: Record<string, { easy: string[]; hard: string[] }> = {
  "trial.starts.count": { easy: ["Quantos testes gratuitos começaram esta semana?", "How many free trials were started last month?"], hard: ["Quantas pessoas experimentaram o produto sem pagar este mês?"] },
  "subscription.active.count": { easy: ["Quantas assinaturas ativas temos hoje?", "How many active subscriptions do we have?"], hard: ["Quantos clientes pagantes seguem conosco agora?"] },
  "subscription.cancelled.count": { easy: ["Quantos cancelamentos tivemos no mês?", "How many subscriptions were cancelled last week?"], hard: ["Quantos clientes deixaram de assinar neste trimestre?"] },
  "billing.gross_billed": { easy: ["Qual foi o faturamento bruto emitido no mês?", "What was the gross amount billed this quarter?"], hard: ["Quanto cobramos dos clientes em faturas neste período?"] },
  "revenue.cash_collected": { easy: ["Quanto caixa recebemos esta semana?", "How much cash did we collect last month?"], hard: ["Quanto dinheiro realmente entrou na conta no mês?"] },
  "receivable.delinquent_amount": { easy: ["Qual é o valor da inadimplência hoje?", "What is the total delinquent amount?"], hard: ["Quanto os clientes estão devendo e já passou do vencimento?"] },
  "cost.infrastructure.total": { easy: ["Quanto gastamos com infraestrutura no mês?", "What is our infrastructure cost this month?"], hard: ["Quanto custam servidores e nuvem neste período?"] },
  "cost.operating.total": { easy: ["Quais foram os custos operacionais rastreáveis do mês?", "What were the traceable operating costs last quarter?"], hard: ["Quanto custou tocar a operação no período, fora a nuvem?"] },
  "lead.created.count": { easy: ["Quantos leads novos entraram esta semana?", "How many new leads were created today?"], hard: ["Quantas pessoas demonstraram interesse em comprar neste mês?"] },
  "incident.count": { easy: ["Quantos incidentes tivemos no mês?", "How many incidents happened last week?"], hard: ["Quantas vezes algo grave saiu do ar neste período?"] },
  "job.failure.count": { easy: ["Quantas rotinas automáticas falharam hoje?", "How many background jobs failed this week?"], hard: ["Quantos processamentos agendados deram erro ontem?"] },
  "integration.failure.count": { easy: ["Quantas integrações falharam no mês?", "How many integration failures did we have today?"], hard: ["Quantas conexões com sistemas externos quebraram esta semana?"] },
  "service.error.count": { easy: ["Quantos erros de serviço houve hoje?", "How many service errors occurred last hour?"], hard: ["Quantas respostas com erro nossos serviços deram agora há pouco?"] },
  "usage.active_users.dau": { easy: ["Quantos usuários ativos diários temos?", "What is our daily active users count?"], hard: ["Quantas pessoas usaram o sistema hoje?"] },
  "usage.engagement.events": { easy: ["Quantos eventos de engajamento registramos esta semana?", "How many engagement events were logged today?"], hard: ["Quanta atividade houve dentro do produto neste período?"] },
  "support.ticket.open.count": { easy: ["Quantos chamados de suporte estão abertos?", "How many support tickets are open right now?"], hard: ["Quantos pedidos de ajuda ainda não foram resolvidos?"] },
};
const options = METRIC_REGISTRY.map((m) => ({ id: m.metricId, label: m.displayName }));
const cases: EvalCase[] = [];
for (const m of METRIC_REGISTRY) {
  const p = PHRASES[m.metricId]; if (!p) throw new Error(`faltam frases para ${m.metricId}`);
  p.easy.forEach((q, i) => cases.push({ id: `${m.metricId}#e${i}`, locale: q.startsWith("How") || q.startsWith("What") ? "en-US" : "pt-BR", difficulty: "easy", question: q, options, gold: m.metricId }));
  p.hard.forEach((q, i) => cases.push({ id: `${m.metricId}#h${i}`, locale: "pt-BR", difficulty: "hard", question: q, options, gold: m.metricId }));
}

// ---- tamanho REAL dos prompts: captura o que o planejador atual enviaria ----
class Capture extends LlmCognitiveModel {
  captured = "";
  protected async complete(messages: readonly { role: "system" | "user"; content: string }[]): Promise<string> {
    this.captured = messages.map((m) => m.content).join("\n");
    return JSON.stringify({ metricIds: [METRIC_REGISTRY[0]!.metricId] });
  }
}
const capture = new Capture();
const tokens = (text: string) => Math.ceil(text.length / 4); // estimativa; o provedor real informa o número exato
async function plannerPromptTokens(q: string): Promise<number> {
  await new FmccVerticalCognitiveCore(capture).plan({ question: q, operationalContext: [] });
  return tokens(capture.captured);
}

// ---- modelos simulados (parâmetros declarados; semente fixa = resultado repetível) ----
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
interface Sim { acc: { easy: number; hard: number }; overconfidentWrong: number; latencyMs: number; tokensOut: number }
function simulated(name: string, pricing: EvalModel["pricing"], sim: Sim, seed: number, promptTokens: (c: EvalCase) => Promise<number>): EvalModel {
  const r = rng(seed);
  return {
    name, pricing,
    async call(c): Promise<EvalCall> {
      const right = r() < sim.acc[c.difficulty];
      const wrongPick = c.options.filter((o) => o.id !== c.gold)[Math.floor(r() * (c.options.length - 1))]!.id;
      const prob = right ? 0.82 + r() * 0.17 : r() < sim.overconfidentWrong ? 0.8 + r() * 0.12 : 0.35 + r() * 0.4;
      return { chosen: right ? c.gold : wrongPick, probability: Number(prob.toFixed(3)), tokensIn: await promptTokens(c), tokensOut: sim.tokensOut, latencyMs: Math.round(sim.latencyMs * (0.7 + r() * 0.8)) };
    },
  };
}
// Preços ILUSTRATIVOS (centavos de dólar por milhão de tokens), não são a tabela vigente de nenhum provedor.
const PRICING = { planner: { currency: "USD", inputMinorPerMillion: 300, outputMinorPerMillion: 1500 }, fast: { currency: "USD", inputMinorPerMillion: 25, outputMinorPerMillion: 125 } };
const SIM = {
  planner: { acc: { easy: 0.98, hard: 0.9 }, overconfidentWrong: 0.15, latencyMs: 1500, tokensOut: 60 },
  fast: { acc: { easy: 0.95, hard: 0.7 }, overconfidentWrong: 0.3, latencyMs: 350, tokensOut: 25 },
};

async function main() {
  const planner = simulated("planejador (grande, simulado)", PRICING.planner, SIM.planner, 7, (c) => plannerPromptTokens(c.question));
  const fast = simulated("decisão rápida (pequeno, simulado)", PRICING.fast, SIM.fast, 11, async (c) => { const p = buildDecisionPrompt({ kind: "choice", question: c.question, options: c.options }); return tokens(p.system + p.user); });
  const out: Record<string, unknown> = { nota: "Modelos SIMULADOS e preços ILUSTRATIVOS. Tokens estimados a partir dos prompts reais. Não mede qualidade de modelo real.", simulacao: SIM, precos: PRICING, casos: cases.length, porLimite: {} };
  for (const th of [0.7, DEFAULT_DECISION_THRESHOLD, 0.9]) {
    // modelos novos a cada limite, para a mesma sequência de sorteios (comparação justa)
    const p = simulated(planner.name, PRICING.planner, SIM.planner, 7, (c) => plannerPromptTokens(c.question));
    const f = simulated(fast.name, PRICING.fast, SIM.fast, 11, async (c) => { const pr = buildDecisionPrompt({ kind: "choice", question: c.question, options: c.options }); return tokens(pr.system + pr.user); });
    (out.porLimite as Record<string, unknown>)[String(th)] = await evaluate(cases, p, f, th);
  }
  const text = JSON.stringify(out, null, 2);
  if (process.argv[2]) writeFileSync(process.argv[2], text);
  console.log(text);
}
main().catch((e) => { console.error(e); process.exit(1); });
