import type { NewSourceDefinition, SourceDefinition, SourceRepository } from "@/domain/integration/contracts";
import type { ProductRepository } from "@/domain/products/contracts";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export class InvalidProductSourceBindingError extends Error {
  constructor() { super("integration.product_source_binding_invalid"); }
}
export class InvalidSecretReferenceError extends Error { constructor() { super("integration.secret_reference_invalid"); } }
export class ConfigSecretForbiddenError extends Error { constructor(path: string) { super(`integration.config_secret_forbidden:${path}`); } }
export class InvalidProductScopeError extends Error { constructor() { super("integration.product_scope_invalid"); } }

const SENSITIVE_CONFIG_KEY = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)/i;

function validateSecretRef(secretRef?: string): void {
  if (!secretRef) return;
  if (!/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(secretRef)) throw new InvalidSecretReferenceError();
}

function assertConfigContainsNoSecrets(value: unknown, path = "config"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertConfigContainsNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_CONFIG_KEY.test(key)) throw new ConfigSecretForbiddenError(`${path}.${key}`);
    assertConfigContainsNoSecrets(nested, `${path}.${key}`);
  }
}

export class SourceRegistryService {
  constructor(private readonly sources: SourceRepository, private readonly products?: ProductRepository) {}

  async list(context: TenantContext): Promise<readonly SourceDefinition[]> {
    requirePermission(context, "source:read");
    return this.sources.list(context.tenantId);
  }

  async register(context: TenantContext, input: NewSourceDefinition): Promise<SourceDefinition> {
    requirePermission(context, "source:write");
    validateSecretRef(input.secretRef);
    assertConfigContainsNoSecrets(input.config);
    if (!input.name.trim() || !input.sourceType.trim() || !input.authoritativeDomain.trim()) throw new Error("integration.source_definition_invalid");
    if (input.freshnessSeconds !== undefined && (!Number.isInteger(input.freshnessSeconds) || input.freshnessSeconds < 1)) throw new Error("integration.freshness_invalid");
    if (input.productId) {
      const product = await this.products?.findById(context.tenantId, input.productId);
      if (!product || product.status !== "active") throw new InvalidProductScopeError();
    }
    return this.sources.create(context.tenantId, {
      ...input,
      name: input.name.trim(),
      sourceType: input.sourceType.trim(),
      authoritativeDomain: input.authoritativeDomain.trim(),
      mappingVersion: input.mappingVersion?.trim() || "v1",
    });
  }
}
