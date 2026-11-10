/**
 * Strict FM Command readiness contract for IRON FIT CORE's eight real Cakto offers.
 * Catalog rows are never treated as proof that a producer checkout is active or
 * that affiliate commissions apply only to the first paid invoice.
 */
export type IronCaktoCommercialProduct = {
  sku: string; tier: string; priceBRLMinor: number; frequency: "month" | "year";
  affiliate: {
    commissionPercent: number; commissionOnPaymentNumber: number;
    renewalCommissionPercent: number; enableOnlyAfterFirstPaymentCommissionVerification: boolean;
  };
  provider: { id: string | null; offerId: string | null; checkoutUrl: string | null; affiliatePolicyVerified: boolean };
};
export type IronCaktoCommercialCatalog = {
  status: string; products: IronCaktoCommercialProduct[];
};
export type CaktoCheckoutBinding = {
  offerId: string; productId: string; checkoutUrl: string;
  amountMinor: number; interval: "month" | "year";
};

const PRICES: Record<string, readonly [number,number]> = Object.freeze({
  IRON_START: [14700,142800],
  IRON_GROWTH: [29700,296400],
  IRON_SCALE: [49700,500400],
  IRON_ENTERPRISE: [89700,896400],
});
const ID = /^[A-Za-z0-9_-]{3,90}$/;

export function inspectIronCommercialOffers(catalog: IronCaktoCommercialCatalog) {
  const problems: string[] = [];
  if (!catalog || !Array.isArray(catalog.products) || catalog.products.length !== 8)
    return { ready: false, problems: ["CATALOG_NOT_EIGHT_OFFERS"] };
  if (catalog.status !== "OPERATOR_APPROVED_NOT_ACTIVE")
    problems.push("CATALOG_AWAITING_OPERATOR_APPROVAL");
  const known = new Set<string>();
  const ids = new Set<string>();
  const offerIds = new Set<string>();
  const urls = new Set<string>();
  for (const product of catalog.products) {
    if (!product || typeof product.sku !== "string" || known.has(product.sku)) {
      problems.push("DUPLICATE_OR_INVALID_SKU"); continue;
    }
    known.add(product.sku);
    const interval = product.frequency;
    const expected = PRICES[product.tier];
    if (!expected || !["month","year"].includes(interval) ||
      product.sku !== product.tier + (interval === "month" ? "_M_2026" : "_Y_2026") ||
      product.priceBRLMinor !== expected[interval === "month" ? 0 : 1])
      problems.push(product.sku + ":PRICE_OR_INTERVAL_MISMATCH");
    const affiliate = product.affiliate;
    if (!affiliate || affiliate.commissionPercent !== (interval === "month" ? 50 : 10) ||
      affiliate.commissionOnPaymentNumber !== 1 || affiliate.renewalCommissionPercent !== 0 ||
      affiliate.enableOnlyAfterFirstPaymentCommissionVerification !== true ||
      product.provider?.affiliatePolicyVerified !== true)
      problems.push(product.sku + ":FIRST_PAYMENT_AFFILIATE_UNVERIFIED");
    const p = product.provider;
    if (!p || !p.id || !ID.test(p.id) || !p.offerId || !ID.test(p.offerId) ||
      !p.checkoutUrl) {
      problems.push(product.sku + ":PROVIDER_ID_OR_URL_MISSING");
      continue;
    }
    let url: URL;
    try { url = new URL(p.checkoutUrl); }
    catch { problems.push(product.sku + ":INVALID_CAKTO_URL"); continue; }
    if (url.protocol !== "https:" || url.hostname !== "pay.cakto.com.br" ||
      url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9_-]{3,120}$/.test(url.pathname))
      problems.push(product.sku + ":INVALID_CAKTO_URL");
    if (ids.has(p.id) || offerIds.has(p.offerId) || urls.has(url.toString()))
      problems.push(product.sku + ":REUSED_EXTERNAL_BINDING");
    ids.add(p.id); offerIds.add(p.offerId); urls.add(url.toString());
  }
  if (known.size !== 8 || Object.keys(PRICES).some(code =>
    !known.has(code + "_M_2026") || !known.has(code + "_Y_2026")))
    problems.push("INCOMPLETE_TIER_MATRIX");
  return { ready: problems.length === 0, problems };
}

export function buildIronCaktoCheckoutBindings(catalog: IronCaktoCommercialCatalog): CaktoCheckoutBinding[] {
  const report = inspectIronCommercialOffers(catalog);
  if (!report.ready)
    throw new Error("iron.commercial_offer_bindings_not_certified:" + report.problems.join(","));
  return catalog.products.map(p => ({
    offerId: p.provider.offerId!,
    productId: p.provider.id!,
    checkoutUrl: p.provider.checkoutUrl!,
    amountMinor: p.priceBRLMinor,
    interval: p.frequency,
  }));
}
