/**
 * Canonical FM Command → IRON plan mapping contract (v1).
 *
 * A commercial plan code is bound to exactly one IRON planCode+version for its
 * entire lifetime. Changing entitlements requires a NEW commercial plan code.
 * This protects previously issued invoices from retroactive entitlement drift.
 *
 * Stored in the existing, durable, tenant/product-scoped Integration Fabric
 * SourceDefinition.config JSONB. No SaaS-local pricing or duplicated ledger.
 */
export const IRON_PLAN_MAPPING_SCHEMA = "iron.commercial-plan-mappings.v1";

export interface IronVersionedPlanMapping {
  readonly revision: number;
  readonly commercialPlanCode: string;
  readonly ironPlanCode: string;
  readonly ironPlanVersion: number;
  readonly effectiveFrom: string;
}

const PLAN_CODE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const MAX_MAPPINGS = 256;

export class IronPlanMappingError extends Error {
  constructor(code: string) { super(code); }
}

function canonicalCode(value: unknown): string {
  if (typeof value !== "string") throw new IronPlanMappingError("billing.iron_plan_code_invalid");
  const normalized = value.trim().toUpperCase();
  if (!PLAN_CODE.test(normalized)) throw new IronPlanMappingError("billing.iron_plan_code_invalid");
  return normalized;
}

export function readIronPlanMappings(config: Record<string, unknown>): readonly IronVersionedPlanMapping[] {
  const raw = config.ironCommercialPlanMappings;
  if (raw === undefined) return [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new IronPlanMappingError("billing.iron_plan_mapping_invalid");
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== IRON_PLAN_MAPPING_SCHEMA ||
      !Array.isArray(record.mappings) || record.mappings.length > MAX_MAPPINGS) {
    throw new IronPlanMappingError("billing.iron_plan_mapping_invalid");
  }
  const seen = new Set<string>();
  return record.mappings.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new IronPlanMappingError("billing.iron_plan_mapping_invalid");
    }
    const mapping = entry as Record<string, unknown>;
    const commercialPlanCode = canonicalCode(mapping.commercialPlanCode);
    const ironPlanCode = canonicalCode(mapping.ironPlanCode);
    const revision = mapping.revision;
    const ironPlanVersion = mapping.ironPlanVersion;
    const effectiveFrom = mapping.effectiveFrom;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) ||
        revision !== index + 1 || typeof ironPlanVersion !== "number" ||
        !Number.isSafeInteger(ironPlanVersion) || ironPlanVersion < 1 ||
        mapping.commercialPlanCode !== commercialPlanCode ||
        mapping.ironPlanCode !== ironPlanCode ||
        typeof effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(effectiveFrom) ||
        Number.isNaN(new Date(effectiveFrom).getTime()) ||
        seen.has(commercialPlanCode)) {
      throw new IronPlanMappingError("billing.iron_plan_mapping_invalid");
    }
    seen.add(commercialPlanCode);
    return { revision, commercialPlanCode, ironPlanCode, ironPlanVersion, effectiveFrom };
  });
}

export function resolveIronPlanMapping(
  config: Record<string, unknown>, commercialPlanCode: string,
): IronVersionedPlanMapping {
  const code = canonicalCode(commercialPlanCode);
  const mapping = readIronPlanMappings(config).find((entry) => entry.commercialPlanCode === code);
  if (!mapping) throw new IronPlanMappingError("billing.iron_plan_mapping_unavailable");
  return mapping;
}

export function appendIronPlanMapping(
  config: Record<string, unknown>,
  input: { commercialPlanCode: string; ironPlanCode: string; ironPlanVersion: number },
): { config: Record<string, unknown>; mapping: IronVersionedPlanMapping; created: boolean } {
  const commercialPlanCode = canonicalCode(input.commercialPlanCode);
  const ironPlanCode = canonicalCode(input.ironPlanCode);
  if (!Number.isSafeInteger(input.ironPlanVersion) || input.ironPlanVersion < 1) {
    throw new IronPlanMappingError("billing.iron_plan_version_invalid");
  }
  const existing = readIronPlanMappings(config);
  const current = existing.find((entry) => entry.commercialPlanCode === commercialPlanCode);
  if (current) {
    if (current.ironPlanCode !== ironPlanCode || current.ironPlanVersion !== input.ironPlanVersion) {
      throw new IronPlanMappingError("billing.iron_plan_mapping_immutable");
    }
    return { config, mapping: current, created: false };
  }
  if (existing.length >= MAX_MAPPINGS) {
    throw new IronPlanMappingError("billing.iron_plan_mapping_capacity_exceeded");
  }
  const mapping = {
    revision: existing.length + 1,
    commercialPlanCode, ironPlanCode, ironPlanVersion: input.ironPlanVersion,
    effectiveFrom: new Date().toISOString(),
  };
  return {
    config: { ...config, ironCommercialPlanMappings: {
      schemaVersion: IRON_PLAN_MAPPING_SCHEMA, mappings: [...existing, mapping],
    } },
    mapping, created: true,
  };
}
