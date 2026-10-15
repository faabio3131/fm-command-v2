import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_SCHEDULER_SECRET =
  process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

async function loadRoute() {
  process.env.DATABASE_URL ||=
    "postgres://fmcc-test:fmcc-test@127.0.0.1:65432/fmcc-test";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  vi.resetModules();

  const automation = await import(
    "@/application/alerts/alert-automation-service"
  );
  const run = vi
    .spyOn(automation.AlertAutomationService.prototype, "run")
    .mockResolvedValue({
      status: "completed",
      runId: "route-auth-run-0001",
      tenants: 0,
      rulesEvaluated: 0,
      occurrencesCreated: 0,
      unavailable: 0,
      clear: 0,
      incompatible: 0,
      failures: 0,
    });

  const route = await import(
    "@/app/api/internal/automation/alerts/evaluate/route"
  );
  return { POST: route.POST, run };
}

afterEach(() => {
  if (ORIGINAL_SCHEDULER_SECRET === undefined) {
    delete process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET;
  } else {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET =
      ORIGINAL_SCHEDULER_SECRET;
  }
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
  if (ORIGINAL_AUTH_SECRET === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CME-10 scheduler route authentication", () => {
  it("falha fechado com 503 quando o secret do scheduler não está configurado", async () => {
    delete process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET;
    const { POST, run } = await loadRoute();

    const response = await POST(
      new Request(
        "https://fmcc.example.test/api/internal/automation/alerts/evaluate",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "automation.scheduler_not_configured",
    });
    expect(run).not.toHaveBeenCalled();
  }, 15_000);

  it("recusa secret incorreto com 401 sem executar automação", async () => {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET =
      "s".repeat(40);
    const { POST, run } = await loadRoute();

    const response = await POST(
      new Request(
        "https://fmcc.example.test/api/internal/automation/alerts/evaluate",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${"z".repeat(40)}`,
            "idempotency-key": "route-auth-run-0001",
          },
        },
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "automation.unauthorized",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("aceita secret correto e preserva idempotency/correlation IDs", async () => {
    const secret = "s".repeat(40);
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET = secret;
    const { POST, run } = await loadRoute();

    const response = await POST(
      new Request(
        "https://fmcc.example.test/api/internal/automation/alerts/evaluate",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "idempotency-key": "route-auth-run-0001",
            "x-correlation-id": "route-auth-corr-0001",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({
      runId: "route-auth-run-0001",
      correlationId: "route-auth-corr-0001",
    });
  });
});
