import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { budgetDecision, buildPrompt, unverifiedNumbers, weekKey, type BudgetState } from "@/domain/agents/weekly-summary";

describe("agente piloto: regras puras", () => {
  it("semana ISO, inclusive virada de ano", () => {
    expect(weekKey(2026, 10, 16)).toBe("2026-W42");
    expect(weekKey(2026, 10, 12)).toBe("2026-W42"); // segunda
    expect(weekKey(2026, 10, 18)).toBe("2026-W42"); // domingo
    expect(weekKey(2026, 10, 19)).toBe("2026-W43");
    expect(weekKey(2026, 1, 1)).toBe("2026-W01");
    expect(weekKey(2024, 12, 30)).toBe("2025-W01");
    expect(weekKey(2021, 1, 3)).toBe("2020-W53");
  });

  it("o texto só pode citar números que o agente recebeu", () => {
    const lines = ["Receita: R$ 1.750,50", "Entregas atrasadas: 3", "Frete: indisponível"];
    expect(unverifiedNumbers("A receita foi R$ 1.750,50 e há 3 entregas atrasadas.", lines)).toEqual([]);
    expect(unverifiedNumbers("A receita foi 1750,50.", lines)).toEqual([]); // mesmos dígitos
    expect(unverifiedNumbers("Receita de R$ 2.000,00 e 7 atrasos.", lines).sort()).toEqual(["2.000,00", "7"]);
    expect(unverifiedNumbers("Sem números aqui.", lines)).toEqual([]);
  });

  it("o prompt proíbe inventar número, tratar indisponível como zero e agir", () => {
    const p = buildPrompt({ locale: "pt-BR", dateText: "16 de outubro de 2026", lines: ["Receita: R$ 10,00", "Frete: indisponível"], unavailableWord: "indisponível" });
    expect(p.system).toMatch(/ONLY the numbers/);
    expect(p.system).toMatch(/Never treat it as zero/);
    expect(p.system).toMatch(/no 'send', 'charge', 'cancel'/);
    expect(p.system).toMatch(/Brazilian Portuguese/);
    expect(p.user).toContain("- Receita: R$ 10,00");
    expect(p.user).toContain("- Frete: indisponível");
    expect(buildPrompt({ locale: "en-US", dateText: "x", lines: [], unavailableWord: "unavailable" }).system).toMatch(/English/);
  });

  const base: BudgetState = { enabled: true, capMicroMinor: 1000, reserveMicroMinor: 100, currency: "USD", spentMicroMinor: 0, inFlight: 0, currencyMismatch: false };
  it("orçamento: sem linha ou desligado nega; cabe no teto com gasto e reservas; no limite exato passa, acima nega", () => {
    expect(budgetDecision(null)).toEqual({ allowed: false, reason: "agent.disabled" });
    expect(budgetDecision({ ...base, enabled: false })).toEqual({ allowed: false, reason: "agent.disabled" });
    expect(budgetDecision(base)).toEqual({ allowed: true });
    expect(budgetDecision({ ...base, spentMicroMinor: 900 })).toEqual({ allowed: true }); // 900 + 100 = 1000
    expect(budgetDecision({ ...base, spentMicroMinor: 901 })).toEqual({ allowed: false, reason: "agent.budget_exhausted" });
    expect(budgetDecision({ ...base, inFlight: 9 })).toEqual({ allowed: true }); // 9*100 + 100 = 1000
    expect(budgetDecision({ ...base, inFlight: 10 })).toEqual({ allowed: false, reason: "agent.budget_exhausted" });
    expect(budgetDecision({ ...base, capMicroMinor: 0 })).toEqual({ allowed: false, reason: "agent.budget_exhausted" });
    expect(budgetDecision({ ...base, currencyMismatch: true })).toEqual({ allowed: false, reason: "agent.budget_currency_mismatch" });
  });
});

describe("agente piloto: nenhuma ação sem confirmação (trava estrutural)", () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(resolve(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [resolve(dir, e.name)] : []);
  it("o único chamador de notifyAgentDraft é a aprovação do serviço do agente", () => {
    const callers = files(resolve(process.cwd(), "src")).filter((f) => /\.notifyAgentDraft\(/.test(readFileSync(f, "utf8")));
    expect(callers.map((f) => f.replace(process.cwd() + "/", ""))).toEqual(["src/application/agents/agent-service.ts"]);
    const service = readFileSync(resolve(process.cwd(), "src/application/agents/agent-service.ts"), "utf8");
    expect(service.match(/\.notifyAgentDraft\(/g)).toHaveLength(1);
    const approve = service.slice(service.indexOf("async approve("), service.indexOf("async reject("));
    expect(approve).toContain("agent:approve");
    expect(approve).toContain("notifyAgentDraft");
  });
  it("o agente não tem caminho para enviar por outro canal, nem para agir em dados", () => {
    const code = ["src/application/agents/agent-service.ts", "src/application/agents/agent-composition.ts", "src/domain/agents/weekly-summary.ts"].map((f) => readFileSync(resolve(process.cwd(), f), "utf8")).join("\n");
    expect(code).not.toMatch(/notifyAlert|notifyReport|sendTest|sendNow|\.dispatch\(/);
    expect(code).not.toMatch(/\.(insert|update|delete)\(.*(metric|canonical|fact|alert)/i);
  });
});
