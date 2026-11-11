import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("FM Command IRON trial customers UI boundary", () => {
  const page = readFileSync("src/app/dashboard/trials/page.tsx", "utf8");

  it("resolves FM identity server-side and keeps company-level protection", () => {
    expect(page).toContain("resolveTenantContext(await headers())");
    expect(page).toContain("companyLevelDenied(context)");
    expect(page).toContain("new IronTrialPortfolioService().read(context, selectedProduct?.id, requestedPage)");
    expect(page).not.toContain("X-Tenant-ID");
    expect(page).not.toContain("NEXT_PUBLIC_FMCC_IRON_CONTROL_PLANE_TOKEN");
  });

  it("shows a source-backed trial roster while preserving governed Metric Registry metrics", () => {
    expect(page).toContain("createMetricService().overview(");
    expect(page).toContain("ironTrials.status === \"unavailable\"");
    expect(page).toContain("ironTrials.customers.map");
    expect(page).toContain("gym.trialStartedAt");
    expect(page).toContain("gym.trialEndsAt");
    expect(page).toContain("gym.subscriptionStatus");
    expect(page).toContain("t(\"trials.iron.source\")");
    expect(page).not.toContain("trial.starts.count\", value:");
    expect(page).not.toContain("gym.cnpj");
    expect(page).not.toContain("gym.email");
  });
});
