import { describe, expect, it } from "vitest";
import { parsePlanPrice, selectPrice, type PlanPrice } from "@/domain/subscription/plan";
import { addInterval, applyPaymentEvent, isEntitled, type SubscriptionSnapshot } from "@/domain/subscription/subscription-state";
import type { PaymentEvent } from "@/domain/subscription/payment-provider";

const P = (currency: string, country: string | null, amountMinor = 1000): PlanPrice => ({ planId: "pro", currency, country, amountMinor, interval: "month" });

describe("preco por moeda e pais", () => {
  it("usa a moeda do perfil; sem preco na moeda = sem oferta (nunca converte)", () => {
    expect(selectPrice([P("BRL", null), P("USD", null)], { currency: "USD", country: "US" })?.currency).toBe("USD");
    expect(selectPrice([P("BRL", null)], { currency: "USD", country: "US" })).toBeNull();
  });
  it("preco do pais vence o generico da moeda", () => {
    const r = selectPrice([P("EUR", null, 1000), P("EUR", "DE", 1200)], { currency: "EUR", country: "DE" });
    expect(r?.amountMinor).toBe(1200);
    expect(selectPrice([P("EUR", null, 1000), P("EUR", "DE", 1200)], { currency: "EUR", country: "FR" })?.amountMinor).toBe(1000);
  });
  it("valida o preco", () => {
    expect(parsePlanPrice({ planId: "p", currency: "BRL", country: null, amountMinor: 4900, interval: "month" }).ok).toBe(true);
    for (const bad of [{ planId: "p", currency: "BRL", country: null, amountMinor: 0, interval: "month" }, { planId: "p", currency: "BRL", country: null, amountMinor: 49.9, interval: "month" },
      { planId: "p", currency: "XXQ", country: null, amountMinor: 100, interval: "month" }, { planId: "p", currency: "BRL", country: "br", amountMinor: 100, interval: "month" },
      { planId: "p", currency: "BRL", country: null, amountMinor: 100, interval: "week" }, { planId: "", currency: "BRL", country: null, amountMinor: 100, interval: "month" }])
      expect(parsePlanPrice(bad).ok).toBe(false);
  });
});

const d = (s: string) => new Date(s);
describe("periodos", () => {
  it("soma meses sem estourar o fim do mes", () => {
    expect(addInterval(d("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(d("2028-01-31T10:00:00Z"), "month").toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval(d("2026-12-15T00:00:00Z"), "month").toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(addInterval(d("2028-02-29T00:00:00Z"), "year").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

const snap = (o: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({ state: "pending", price: { amountMinor: 4900, currency: "BRL" }, interval: "month", currentPeriodEnd: null, lastEventAt: null, ...o });
const ev = (type: PaymentEvent["type"], at: string, amount: PaymentEvent["amount"] = null): PaymentEvent => ({ eventId: "e", type, subscriptionRef: "s", paymentRef: null, amount, occurredAt: d(at) });
const paid = (at: string, amountMinor = 4900, currency = "BRL") => ev("payment_confirmed", at, { amountMinor, currency });

describe("ciclo da assinatura", () => {
  it("pagamento confirmado ativa e abre o periodo", () => {
    const t = applyPaymentEvent(snap(), paid("2026-03-10T12:00:00Z"));
    expect(t.outcome).toBe("applied");
    expect(t.next.state).toBe("active");
    expect(t.next.currentPeriodEnd?.toISOString()).toBe("2026-04-10T12:00:00.000Z");
  });
  it("renovacao antecipada soma ao fim do periodo, nao a data do pagamento", () => {
    const t = applyPaymentEvent(snap({ state: "active", currentPeriodEnd: d("2026-04-10T12:00:00Z") }), paid("2026-04-05T00:00:00Z"));
    expect(t.next.currentPeriodEnd?.toISOString()).toBe("2026-05-10T12:00:00.000Z");
  });
  it("valor ou moeda diferentes do preco gravado NAO ativam", () => {
    for (const bad of [paid("2026-03-10T00:00:00Z", 100), paid("2026-03-10T00:00:00Z", 4900, "USD")]) {
      const t = applyPaymentEvent(snap(), bad);
      expect(t.outcome).toBe("amount_mismatch");
      expect(t.next.state).toBe("pending");
    }
  });
  it("atraso so afeta assinatura ativa; evento antigo de atraso e ignorado; pagamento nunca e descartado por idade", () => {
    const active = snap({ state: "active", currentPeriodEnd: d("2026-04-10T00:00:00Z"), lastEventAt: d("2026-03-10T00:00:00Z") });
    expect(applyPaymentEvent(active, ev("payment_overdue", "2026-03-20T00:00:00Z")).next.state).toBe("past_due");
    expect(applyPaymentEvent(active, ev("payment_overdue", "2026-03-01T00:00:00Z")).outcome).toBe("ignored_stale");
    expect(applyPaymentEvent(snap(), ev("payment_overdue", "2026-03-20T00:00:00Z")).outcome).toBe("ignored_state");
    expect(applyPaymentEvent(active, paid("2026-03-01T00:00:00Z")).outcome).toBe("applied");
    const pd = applyPaymentEvent(snap({ state: "past_due", currentPeriodEnd: d("2026-04-10T00:00:00Z") }), paid("2026-04-12T00:00:00Z"));
    expect(pd.next.state).toBe("active");
  });
  it("estorno encerra o periodo na data do estorno; pendente ignora estorno", () => {
    const t = applyPaymentEvent(snap({ state: "active", currentPeriodEnd: d("2026-04-10T00:00:00Z") }), ev("payment_refunded", "2026-03-20T00:00:00Z"));
    expect(t.next.state).toBe("past_due");
    expect(t.next.currentPeriodEnd?.toISOString()).toBe("2026-03-20T00:00:00.000Z");
    expect(applyPaymentEvent(snap(), ev("payment_refunded", "2026-03-20T00:00:00Z")).outcome).toBe("ignored_state");
  });
  it("cancelada ou com falha nao volta a vida por evento", () => {
    for (const state of ["cancelled", "failed", "creating"] as const) {
      const t = applyPaymentEvent(snap({ state }), paid("2026-03-10T00:00:00Z"));
      expect(t.outcome).toBe("ignored_state");
      expect(t.next.state).toBe(state);
    }
  });
});

describe("direito de uso", () => {
  const end = d("2026-04-10T00:00:00Z");
  it("ativa/em atraso: ate o fim do periodo + carencia; cancelada: so ate o fim; sem pagamento: nao", () => {
    expect(isEntitled({ state: "active", currentPeriodEnd: end }, d("2026-04-12T00:00:00Z"))).toBe(true);
    expect(isEntitled({ state: "active", currentPeriodEnd: end }, d("2026-04-14T00:00:00Z"))).toBe(false);
    expect(isEntitled({ state: "past_due", currentPeriodEnd: end }, d("2026-04-11T00:00:00Z"))).toBe(true);
    expect(isEntitled({ state: "cancelled", currentPeriodEnd: end }, d("2026-04-09T00:00:00Z"))).toBe(true);
    expect(isEntitled({ state: "cancelled", currentPeriodEnd: end }, d("2026-04-11T00:00:00Z"))).toBe(false);
    for (const state of ["pending", "creating", "failed"] as const) expect(isEntitled({ state, currentPeriodEnd: end }, d("2026-04-01T00:00:00Z"))).toBe(false);
    expect(isEntitled({ state: "active", currentPeriodEnd: null }, d("2026-04-01T00:00:00Z"))).toBe(false);
  });
});
