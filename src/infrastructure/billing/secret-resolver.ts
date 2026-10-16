/**
 * Server-side secret reference boundary. Never persist API key material in Postgres.
 * The initial Render adapter reads an explicitly allowlisted environment key.
 * Production-grade rotation/audit requires a dedicated secrets manager integration.
 */
export type GatewayEnvironment = "sandbox" | "production";
export class GatewaySecretError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GatewaySecretError"; }
}
export const ASAAS_SANDBOX_SECRET_REF = "env://FMCC_ASAAS_SANDBOX_API_KEY";
export const ASAAS_PRODUCTION_SECRET_REF = "env://FMCC_ASAAS_PRODUCTION_API_KEY";
const permitted = new Map<string, { provider: string; environment: GatewayEnvironment }>([
  [ASAAS_SANDBOX_SECRET_REF, { provider: "asaas", environment: "sandbox" }],
  [ASAAS_PRODUCTION_SECRET_REF, { provider: "asaas", environment: "production" }],
]);
export function resolveGatewaySecret(input: {
  provider: string; environment: GatewayEnvironment; secretRef: string;
}, env: Record<string, string | undefined> = process.env): string {
  const scope = permitted.get(input.secretRef);
  if (!scope || scope.provider !== input.provider || scope.environment !== input.environment)
    throw new GatewaySecretError("billing.secret_scope_denied");
  const key = input.secretRef.slice("env://".length);
  const secret = env[key];
  if (!secret || !secret.trim()) throw new GatewaySecretError("billing.secret_not_configured");
  return secret;
}
