/**
 * Eight independently priced Cakto subscription SKUs (4 x monthly/yearly)
 * resolve to four published entitlement plan families in IRON.
 *
 * Billing remains authoritative for the commercial SKU/price/interval. This
 * mapping cannot create or publish an IRON ProductPlanVersion; only the IRON
 * canonical catalog may do so.
 */
const tierCodes = ["IRON_START", "IRON_GROWTH", "IRON_SCALE", "IRON_ENTERPRISE"] as const;
type IronTierCode = typeof tierCodes[number];
const SUFFIX = /^IRON_(START|GROWTH|SCALE|ENTERPRISE)_([MY])_2026$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export type IronCommercialPlanIdentity = {
  billingPlanCode: string;
  canonicalPlanCode: string;
  billingInterval: "monthly" | "yearly" | null;
  candidate: boolean;
};

export function resolveIronCommercialPlanIdentity(billingPlanCode: string): IronCommercialPlanIdentity {
  if (typeof billingPlanCode !== "string" || !CODE.test(billingPlanCode))
    throw new Error("iron.commercial_plan_code_invalid");
  const match = SUFFIX.exec(billingPlanCode);
  if (!match) {
    // Compatibility for existing canonical plan codes. These still require a
    // unique canonical Published PlanVersion in the IRON backend.
    if (/^IRON_(START|GROWTH|SCALE|ENTERPRISE)_[MY]_/.test(billingPlanCode))
      throw new Error("iron.commercial_sku_version_unrecognized");
    return { billingPlanCode, canonicalPlanCode: billingPlanCode, billingInterval: null, candidate: false };
  }
  const canonicalPlanCode = "IRON_" + match[1] as IronTierCode;
  if (!tierCodes.includes(canonicalPlanCode))
    throw new Error("iron.commercial_plan_code_invalid");
  return {
    billingPlanCode,
    canonicalPlanCode,
    billingInterval: match[2] === "M" ? "monthly" : "yearly",
    candidate: true,
  };
}

export function assertIronCommercialPlanInterval(billingPlanCode: string, invoiceInterval: string): string {
  const identity = resolveIronCommercialPlanIdentity(billingPlanCode);
  if (identity.billingInterval !== null && identity.billingInterval !== invoiceInterval)
    throw new Error("iron.commercial_sku_interval_mismatch");
  if (!["monthly", "yearly"].includes(invoiceInterval))
    throw new Error("iron.commercial_sku_interval_invalid");
  return identity.canonicalPlanCode;
}
