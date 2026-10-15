import { afterEach, describe, expect, it } from "vitest";
import { startSimulatedProvider, type SimulatedProvider } from "../scripts/load/simulated-provider";
import { OpenAiCompatibleCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { CognitiveModelUnavailableError } from "@/domain/core/cognitive-model";

let p: SimulatedProvider | undefined;
afterEach(async () => { await p?.close(); p = undefined; });

describe("provedor simulado para medicao (etapa 1)", () => {
  it("o nosso adaptador real planeja e sintetiza contra o simulado", async () => {
    p = await startSimulatedProvider({ planMs: 1, synthMs: 1 });
    const core = new FmccVerticalCognitiveCore(new OpenAiCompatibleCognitiveModel(p.baseUrl, "chave-de-teste", "modelo-simulado", 2000));
    const plan = await core.plan({ question: "como vai o faturamento?", operationalContext: [] });
    expect(plan.metricIds.length).toBe(1);
    const out = await core.synthesize({ question: "q", facts: [], evidence: [], operationalContext: [] });
    expect(out.answer).toContain("simulada");
  });
  it("acima da cota responde 429 e o adaptador devolve indisponivel, sem reserva", async () => {
    p = await startSimulatedProvider({ planMs: 200, synthMs: 200, maxConcurrent: 1 });
    const model = new OpenAiCompatibleCognitiveModel(p.baseUrl, "chave-de-teste", "modelo-simulado", 2000);
    const core = new FmccVerticalCognitiveCore(model);
    const results = await Promise.allSettled([
      core.synthesize({ question: "a", facts: [], evidence: [], operationalContext: [] }),
      core.synthesize({ question: "b", facts: [], evidence: [], operationalContext: [] }),
    ]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CognitiveModelUnavailableError);
    expect(p.stats.rejected429).toBe(1);
  });
});
