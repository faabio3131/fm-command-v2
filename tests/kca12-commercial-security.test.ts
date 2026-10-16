import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roleHasPermission } from "@/domain/security/permissions";

describe("KCA-12 commercial control security contract", () => {
  it("permite escrita comercial somente para owner/admin", () => {
    expect(roleHasPermission("owner", "commercial:write")).toBe(true);
    expect(roleHasPermission("admin", "commercial:write")).toBe(true);
    expect(roleHasPermission("analyst", "commercial:write")).toBe(false);
    expect(roleHasPermission("viewer", "commercial:write")).toBe(false);
    expect(roleHasPermission("member", "commercial:write")).toBe(false);
  });

  it("mantém leitura comercial disponível sem conceder mutação", () => {
    expect(roleHasPermission("analyst", "commercial:read")).toBe(true);
    expect(roleHasPermission("viewer", "commercial:read")).toBe(true);
  });

  it("exige reautenticação e gate server-side antes de publicação comercial", () => {
    const route = readFileSync(
      new URL(
        "../src/app/api/integrations/kordena-commercial/commands/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const stepUp = readFileSync(
      new URL(
        "../src/application/security/password-step-up.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain("commercial:write");
    expect(route).toContain("recordAuditEvent");
    expect(route).toContain("consumeCommercialApproval");
    expect(route).toContain("issueCommercialApproval");
    expect(route).toContain("isHighRiskCommercialPublish");
    expect(route).toContain("isKordenaCommercialAction");
    expect(route).not.toContain("approvalContext");
    expect(stepUp).toContain("auth.api.signInEmail");
    expect(stepUp).toContain("current.user.id");
  });
});
