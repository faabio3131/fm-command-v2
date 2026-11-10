import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("IRON outbox delivery in governed FM Command automation", () => {
  it("includes durable licensing and credit drains in the existing authenticated runner", () => {
    const workflow = readFileSync(".github/workflows/fmcc-alert-automation.yml", "utf8");
    expect(workflow).toContain("FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET");
    expect(workflow).toContain("Authorization: Bearer $FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET");
    expect(workflow).toContain("for path in metrics/recompute alerts/evaluate reports/run iron/entitlements/drain iron/ai-credits/drain; do");
    expect(workflow).toContain("# schedule:");
    expect(workflow).not.toMatch(/^\s+schedule:\s*$/m);
  });
});
