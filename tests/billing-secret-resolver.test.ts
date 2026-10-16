import { describe, expect, it } from "vitest";
import { ASAAS_SANDBOX_SECRET_REF, resolveGatewaySecret } from "../src/infrastructure/billing/secret-resolver";
const config = { provider: "asaas", environment: "sandbox" as const, secretRef: ASAAS_SANDBOX_SECRET_REF };
describe("sandbox credential boundary", () => {
  it("resolves explicitly scoped server secret", () => {
    expect(resolveGatewaySecret(config, { FMCC_ASAAS_SANDBOX_API_KEY: "test-secret" })).toBe("test-secret");
  });
  it("fails closed when missing", () => {
    expect(() => resolveGatewaySecret(config, {})).toThrow("billing.secret_not_configured");
  });
  it("prevents cross-environment secret reuse", () => {
    expect(() => resolveGatewaySecret({ ...config, environment: "production" }, { FMCC_ASAAS_SANDBOX_API_KEY: "test-secret" })).toThrow("billing.secret_scope_denied");
  });
  it("prevents arbitrary env reading", () => {
    expect(() => resolveGatewaySecret({ ...config, secretRef: "env://DATABASE_URL" }, { DATABASE_URL: "private" })).toThrow("billing.secret_scope_denied");
  });
});
