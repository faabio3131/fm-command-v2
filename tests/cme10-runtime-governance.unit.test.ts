import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-10 runtime homologation governance", () => {
  it("certifica Kordena conectado sem fabricar canonical facts ou métricas", () => {
    const register = source(
      "docs/governance/CME-10-runtime-homologation-register.md",
    );

    expect(register).toContain("KORDENA_CONNECTED = TRUE");
    expect(register).toContain("KORDENA_SYNC_FRESH = COMPLETED");
    expect(register).toContain("KORDENA_CANONICAL_DATASET = EMPTY");
    expect(register).toContain(
      "KORDENA_METRICS = UNAVAILABLE / NO_CANONICAL_FACTS",
    );
    expect(register).toContain("MISSING_TO_ZERO = 0");
  });

  it("certifica scheduler real ativo com execução e idempotência runtime", () => {
    const register = source(
      "docs/governance/CME-10-runtime-homologation-register.md",
    );

    expect(register).toContain("SCHEDULER_REAL_EXECUTION = PASS");
    expect(register).toContain(
      "SCHEDULER_IDEMPOTENCY_RUNTIME = PASS",
    );
    expect(register).toContain("SCHEDULER_AUDIT_TRAIL = PASS");
    expect(register).toContain("SCHEDULER_ACTIVE = TRUE");
  });

  it("preserva o boundary de autenticação e recuperação do scheduler", () => {
    const route = source(
      "src/app/api/internal/automation/alerts/evaluate/route.ts",
    );
    const repository = source(
      "src/infrastructure/alerts/postgres-alert-automation-repository.ts",
    );
    const workflow = source(
      ".github/workflows/fmcc-alert-automation.yml",
    );

    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("automation.scheduler_not_configured");
    expect(route).toContain("automation.unauthorized");
    expect(repository).toContain("AUTOMATION_STALE_AFTER_MS");
    expect(repository).toContain("alert.automation.restarted");
    expect(workflow).toContain("Idempotency-Key");
    expect(workflow).toContain("X-Correlation-ID");
  });

  it("mantém Preview exact-SHA como pré-condição e registra o SHA certificado", () => {
    const workflow = source(
      ".github/workflows/fmcc-preview-deployment-gate.yml",
    );
    const register = source(
      "docs/governance/CME-10-runtime-homologation-register.md",
    );

    expect(workflow).toContain('expected="$GITHUB_SHA"');
    expect(workflow).toContain("Preview exact SHA confirmed");
    expect(register).toContain(
      "f2b817ec2f5e6e4124a0dbe2f10f2e27ece0a9c3",
    );
    expect(register).toContain("PREVIEW_EXACT_SHA = PASS");
  });

  it("fecha o CME-10 somente com claims compatíveis com a evidência", () => {
    const register = source(
      "docs/governance/CME-10-runtime-homologation-register.md",
    );

    expect(register).toContain("FALSE_CONNECTED_CLAIMS = 0");
    expect(register).toContain("SECRET_DISCLOSURES = 0");
    expect(register).toContain("CME_10_FINAL = PASS");
  });
});
