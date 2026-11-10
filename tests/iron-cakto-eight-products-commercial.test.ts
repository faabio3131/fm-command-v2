import { describe, expect, it } from "vitest";
import catalog from "../config/commercial/iron-cakto-eight-products-2026.candidate.json";

const amounts={
  IRON_START:{month:14700,year:142800},
  IRON_GROWTH:{month:29700,year:296400},
  IRON_SCALE:{month:49700,year:500400},
  IRON_ENTERPRISE:{month:89700,year:896400},
} as const;

describe("IRON commercial Cakto eight-offer catalog",()=>{
  it("prepares exactly eight separate checked listings, not 8 published provider offers",()=>{
    expect(catalog.status).toBe("CANDIDATE_NOT_LIVE");
    expect(catalog.products).toHaveLength(8);
    expect(new Set(catalog.products.map(p=>p.sku)).size).toBe(8);
    expect(new Set(catalog.products.map(p=>p.coverFile)).size).toBe(8);
    for (const product of catalog.products){
      expect(product.description.length).toBeGreaterThanOrEqual(100);
      expect(product.description).toContain("IRON FIT CORE");
      expect(product.description).toContain("revisão e aprovação");
      expect(product.description).not.toMatch(/ilimitad[oa]s?|homologad[oa]s? todas/i);
      expect(product.currency).toBe("BRL");
      expect(product.delivery).toBe("EXTERNAL_MEMBERSHIP_WEBHOOK");
      expect(product.billingType).toBe("recurring_subscription");
      // Provider onboarding is partial: IDs/links may be known, but without a
      // verified official offer ID and commission policy no SKU is sellable.
      expect(product.provider.offerId).toBeNull();
      expect(product.provider.affiliatePolicyVerified).toBe(false);
    }
  });
  it("retains approved prices and monthly/yearly billing period",()=>{
    for(const [tier,prices] of Object.entries(amounts)){
      const monthly=catalog.products.find(p=>p.tier===tier&&p.frequency==="month");
      const annual=catalog.products.find(p=>p.tier===tier&&p.frequency==="year");
      expect(monthly?.priceBRLMinor).toBe(prices.month);
      expect(annual?.priceBRLMinor).toBe(prices.year);
      expect(monthly?.sku).toBe(tier+"_M_2026");
      expect(annual?.sku).toBe(tier+"_Y_2026");
    }
  });
  it("affiliate commission is 50% only on first monthly payment, 10% only on first annual payment",()=>{
    for(const product of catalog.products){
      expect(product.affiliate.commissionPercent)
        .toBe(product.frequency==="month"?50:10);
      expect(product.affiliate.commissionOnPaymentNumber).toBe(1);
      expect(product.affiliate.renewalCommissionPercent).toBe(0);
      expect(product.affiliate.approval).toBe("MANUAL");
      expect(product.affiliate.enableOnlyAfterFirstPaymentCommissionVerification).toBe(true);
    }
  });
});
