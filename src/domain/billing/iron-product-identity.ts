/**
 * FM Command product registry uses "iron" as the canonical commercial slug.
 * The upstream IRON control plane continues to advertise IRON_FIT_CORE.
 * These are separate identity domains; never rewrite the upstream contract.
 */
export const FMCC_IRON_PRODUCT_SLUG = "iron" as const;
export const IRON_EXTERNAL_PRODUCT_CODE = "IRON_FIT_CORE" as const;
