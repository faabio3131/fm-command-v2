import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);
const saved = { secret: process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET, db: process.env.DATABASE_URL, auth: process.env.BETTER_AUTH_SECRET };

async function loadRoute() {
  process.env.DATABASE_URL ||= "postgres://fmcc-test:fmcc-test@127.0.0.1:65432/fmcc-test";
  process.env.BETTER_AUTH_SECRET ||= "x".repeat(40);
  vi.resetModules();
  const composition = await import("@/application/reports/report-composition");
  const channels = await import("@/application/channels/channel-composition");
  const service = { runDue: vi.fn().mockResolvedValue({ checked: 0, sent: 0, failed: 0 }) };
  vi.spyOn(composition, "buildReportService").mockReturnValue(service as never);
  vi.spyOn(channels, "dispatchDueChannelDeliveries").mockResolvedValue({ sent: 0, failed: 0, uncertain: 0, retry: 0 });
  const route = await import("@/app/api/internal/automation/reports/run/route");
  return { POST: route.POST, service };
}

afterEach(() => {
  for (const [key, value] of [["FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET", saved.secret], ["DATABASE_URL", saved.db], ["BETTER_AUTH_SECRET", saved.auth]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

const call = (POST: (r: Request) => Promise<Response>, authorization?: string) =>
  POST(new Request("http://x/api/internal/automation/reports/run", { method: "POST", headers: authorization ? { authorization } : {} }));

describe("rota do agendador de relatórios", () => {
  it("sem segredo configurado responde 503 e não roda nada", async () => {
    delete process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET;
    const { POST, service } = await loadRoute();
    expect((await call(POST, `Bearer ${SECRET}`)).status).toBe(503);
    expect(service.runDue).not.toHaveBeenCalled();
  });
  it("sem credencial ou com credencial errada responde 401 e não roda nada", async () => {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET = SECRET;
    const { POST, service } = await loadRoute();
    expect((await call(POST)).status).toBe(401);
    expect((await call(POST, "Bearer errado")).status).toBe(401);
    expect(service.runDue).not.toHaveBeenCalled();
  });
  it("com o segredo certo roda a rodada", async () => {
    process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET = SECRET;
    const { POST, service } = await loadRoute();
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(service.runDue).toHaveBeenCalledTimes(1);
  });
});
