import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("governed IRON SaaS license and AI credit delivery schedule", () => {
  const workflow = readFileSync(".github/workflows/iron-outbox-scheduler.yml", "utf8");
  it("defaults to disabled and is independent of FMCC global alert/report scheduling", () => {
    expect(workflow).toContain("FMCC_IRON_OUTBOX_AUTOMATION_ENABLED == 'true'");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("cron: '*/5 * * * *'");
    expect(workflow).not.toContain("metrics/recompute");
    expect(workflow).not.toContain("alerts/evaluate");
    expect(workflow).not.toContain("reports/run");
  });
  it("uses only official fixed HTTPS FM Command host, masked bearer and durable drains", () => {
    expect(workflow).toContain("https://app.fmcommand.com.br/api/internal/automation/$path");
    expect(workflow).toContain("FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET");
    expect(workflow).toContain("::add-mask::");
    expect(workflow).toContain("iron/entitlements/drain iron/ai-credits/drain");
    expect(workflow).toContain("set -euo pipefail");
  });
});
