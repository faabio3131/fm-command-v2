import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "@/application/audit/sanitize-audit-metadata";

describe("F20 Audit Ledger metadata sanitization", () => {
  it("redige chaves sensíveis, segredos inline e e-mails", () => {
    const sanitized = sanitizeAuditMetadata({
      password: "super-secret-password",
      nested: {
        authorization: "Bearer should-never-survive-123456789",
        note: `contato owner@example.com com ${"sk" + "-"}abcdefghijklmnopqrstuv`,
      },
    });

    expect(sanitized.password).toBe("[REDACTED]");
    expect(JSON.stringify(sanitized)).not.toContain("super-secret-password");
    expect(JSON.stringify(sanitized)).not.toContain("owner@example.com");
    expect(JSON.stringify(sanitized)).not.toContain(`${"sk" + "-"}abcdefghijklmnopqrstuv`);
    expect(JSON.stringify(sanitized)).toContain("[REDACTED");
  });

  it("limita strings e coleções para impedir payload arbitrário no ledger", () => {
    const sanitized = sanitizeAuditMetadata({
      answer: "x".repeat(3_000),
      items: Array.from({ length: 100 }, (_, index) => index),
    });

    expect(String(sanitized.answer).length).toBeLessThan(2_100);
    expect(String(sanitized.answer)).toContain("[TRUNCATED]");
    expect(sanitized.items).toHaveLength(64);
  });
});
