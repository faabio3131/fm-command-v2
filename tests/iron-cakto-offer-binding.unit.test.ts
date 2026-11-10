import { describe, expect, it } from "vitest";
import source from "../config/commercial/iron-cakto-eight-products-2026.candidate.json";
import {
  inspectIronCommercialOffers, buildIronCaktoCheckoutBindings,
  type IronCaktoCommercialCatalog,
} from "@/application/billing/iron-cakto-offer-binding";

const copy = () => JSON.parse(JSON.stringify(source)) as IronCaktoCommercialCatalog;
const fakeVerified = () => {
  const catalog = copy();
  catalog.status = "OPERATOR_APPROVED_NOT_ACTIVE";
  for (let i=0;i<catalog.products.length;i++) {
    const product=catalog.products[i];
    product.provider = {
      id: "caktoproduct_"+i, offerId: "caktooffer_"+i,
      checkoutUrl: "https://pay.cakto.com.br/test_offer_"+i,
      affiliatePolicyVerified: true,
    };
  }
  return catalog;
};
describe("IRON Cakto commercial readiness gate", () => {
  it("never treats the eight candidate covers/products as integrated live offers", () => {
    const actual = copy();
    const report = inspectIronCommercialOffers(actual);
    expect(report.ready).toBe(false);
    expect(report.problems).toContain("CATALOG_AWAITING_OPERATOR_APPROVAL");
    expect(report.problems.some(x => x.includes("FIRST_PAYMENT_AFFILIATE_UNVERIFIED"))).toBe(true);
    expect(() => buildIronCaktoCheckoutBindings(actual)).toThrow("iron.commercial_offer_bindings_not_certified");
  });
  it("compiles the exact eight real-offer contracts when independent evidence is supplied", () => {
    const catalog=fakeVerified();
    expect(inspectIronCommercialOffers(catalog)).toEqual({ready:true,problems:[]});
    const bindings=buildIronCaktoCheckoutBindings(catalog);
    expect(bindings).toHaveLength(8);
    expect(bindings.filter(x=>x.interval==="month")).toHaveLength(4);
    expect(bindings.filter(x=>x.interval==="year")).toHaveLength(4);
    expect(bindings.find(x=>x.amountMinor===14700)).toMatchObject({
      interval:"month", productId:"caktoproduct_0",offerId:"caktooffer_0",
    });
    expect(bindings.find(x=>x.amountMinor===896400)?.interval).toBe("year");
  });
  it("rejects any affiliate policy that would pay renewals, even if product is configured", () => {
    const catalog=fakeVerified();
    catalog.products[0].affiliate.renewalCommissionPercent=50;
    expect(inspectIronCommercialOffers(catalog).ready).toBe(false);
    expect(() => buildIronCaktoCheckoutBindings(catalog)).toThrow("FIRST_PAYMENT_AFFILIATE_UNVERIFIED");
  });
  it("rejects duplicated checkout ids, product ids and unsafe URLs", () => {
    const catalog=fakeVerified();
    catalog.products[1].provider.offerId=catalog.products[0].provider.offerId;
    expect(inspectIronCommercialOffers(catalog).problems).toContain(catalog.products[1].sku+":REUSED_EXTERNAL_BINDING");
    const unsafe=fakeVerified();
    unsafe.products[0].provider.checkoutUrl="https://attacker.example/pay";
    expect(inspectIronCommercialOffers(unsafe).problems).toContain(unsafe.products[0].sku+":INVALID_CAKTO_URL");
  });
  it("rejects mismatching interval, plan prices, missing tiers and forged approval flags", () => {
    const catalog=fakeVerified();
    catalog.products[0].priceBRLMinor=1;
    catalog.products[1].frequency="month";
    catalog.products[2].provider.affiliatePolicyVerified=false;
    const report=inspectIronCommercialOffers(catalog);
    expect(report.ready).toBe(false);
    expect(report.problems).toContain(catalog.products[0].sku+":PRICE_OR_INTERVAL_MISMATCH");
    expect(report.problems).toContain(catalog.products[1].sku+":PRICE_OR_INTERVAL_MISMATCH");
    expect(report.problems).toContain(catalog.products[2].sku+":FIRST_PAYMENT_AFFILIATE_UNVERIFIED");
  });
});
