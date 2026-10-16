import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXECUTIVE_METRIC_TARGETS } from "@/domain/metrics/registry";

const PENDING = [
  "finance.operating_margin.rate",
  "finance.operating_result",
  "revenue.arr",
  "revenue.mrr",
  "service.error.rate",
  "subscription.logo_churn.rate",
  "trial.active.count",
  "trial.conversion.rate",
] as const;

function governanceDocument(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "docs/governance/CME-08-executive-metric-semantics-register.md",
    ),
    "utf8",
  );
}

describe("CME-08 executive semantic governance", () => {
  it("mantém exatamente as oito semânticas executivas pendentes até aprovação canônica", () => {
    const pending = EXECUTIVE_METRIC_TARGETS
      .filter((target) => target.definitionStatus === "pending_semantics")
      .map((target) => target.metricId)
      .sort();

    expect(pending).toEqual([...PENDING].sort());
  });

  it("registra blocker explícito e todos os campos de governança sem promover métricas", () => {
    const document = governanceDocument();

    for (const metricId of PENDING) {
      expect(document).toContain(`\`${metricId}\``);
    }

    expect(document).toContain(
      "EXTERNAL_BLOCKED / BUSINESS_SEMANTICS_REQUIRED",
    );
    expect(document).toContain("SEMANTIC_PROMOTION = EXTERNAL_BLOCKED");
    expect(document).toContain("nenhuma das oito possui aprovação corporativa");
    expect(document).toContain("ADR-012");
    expect(document).toContain("missing != zero");
  });

  it("distingue evidência candidata do Kordena de autoridade corporativa", () => {
    const document = governanceDocument();

    expect(document).toContain(
      "Uma fórmula válida para o produto Kordena não se torna automaticamente",
    );
    expect(document).toContain("semântica candidata específica do Kordena");
    expect(document).toContain("rolling 30 dias");
    expect(document).toContain("moedas permanecem separadas");
  });
});
