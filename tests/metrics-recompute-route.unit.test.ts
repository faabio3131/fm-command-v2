import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);
const saved = { secret: process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET, db: process.env.DATABASE_URL, auth: process.env.BETTER_AUTH_SECRET };

async function loadRoute() {
  process.env.DATABASE_URL ||= "postgres://fmcc-test:fmcc-test@127.0.0.1:65432/fmcc-test";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  vi.resetModules();
  const composition = await import("@/application/metrics/metric-composition");
  const service = { recomputeAll: vi.fn().mockResolvedValue({ tenants: 0, computed: 0, failed: 0 }) };
  vi.spyOn(composition, "createMetricRecomputeService").mockReturnValue(service as never);
  const route = await import("@/app/api/internal/automation/metrics/recompute/route");
  return { POST: route.POST, service };
}

afterEach(() => {
  for (const [key, value] of [["FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET", saved.secret], ["DATABASE_URL", saved.db], ["BETTER_AUTH_SECRET", saved.auth]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

const call = (POST: (r: Request) => Promise<Response>, authorization?: string) =>
  POST(new Request("http://x/api/internal/automation/metrics/recompute", { method: "POST", headers: authorization ? { authorization } : {} }));

describe("rota do agendador de recálculo de métricas", () => {
  it("sem segredo configurado responde 503 e não roda nada", async () => {
    delete process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET;
    const { POST, service } = await loadRoute();
    expect((await call(POST, `Bearer ${SECRET}`)).status).toBe(503);
    expect(service.recomputeAll).not.toHaveBeenCalled();
  });
  it("sem credencial ou com credencial errada responde 401 e não roda nada", async () => {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET = SECRET;
    const { POST, service } = await loadRoute();
    expect((await call(POST)).status).toBe(401);
    expect((await call(POST, "Bearer errado")).status).toBe(401);
    expect(service.recomputeAll).not.toHaveBeenCalled();
  });
  it("com o segredo certo recalcula", async () => {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET = SECRET;
    const { POST, service } = await loadRoute();
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(service.recomputeAll).toHaveBeenCalledTimes(1);
  });
});
