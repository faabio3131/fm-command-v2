import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/infrastructure/db/client";
import { PostgresSubscriptionRepository } from "@/infrastructure/subscription/postgres-subscription-repository";
import { PaymentProviderRegistry } from "@/infrastructure/subscription/provider-registry";
import { SimulatedPaymentProvider } from "@/infrastructure/subscription/simulated-payment-provider";
import { SubscriptionService } from "@/application/subscription/subscription-service";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";

const TP = "saas-it-";
const ctx = (t: string, role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId: `${TP}${t}`, userId: `${TP}u-${t}`, role, correlationId: "c" });
const customer = { name: "Maria Souza", email: "maria@example.com", taxId: null };
let now = new Date("2026-03-10T12:00:00Z");
let simA: SimulatedPaymentProvider; let simB: SimulatedPaymentProvider;
let service: SubscriptionService; let repo: PostgresSubscriptionRepository;

async function clean() {
  await pool.query("DELETE FROM fmcc_saas_event WHERE provider_id IN ('sim_a','sim_b','sim_c')");
  await pool.query("DELETE FROM fmcc_saas_subscription WHERE tenant_id LIKE $1", [`${TP}%`]);
  await pool.query("DELETE FROM fmcc_saas_payment_route WHERE provider_id IN ('sim_a','sim_b','sim_c','nao_configurado')");
  await pool.query("DELETE FROM fmcc_saas_plan_price WHERE plan_id LIKE 'saas-it-%'");
  await pool.query("DELETE FROM fmcc_saas_plan WHERE id LIKE 'saas-it-%'");
  await pool.query("DELETE FROM fmcc_org_profile WHERE tenant_id LIKE $1", [`${TP}%`]);
}
async function profile(t: string, currency: string, country: string) {
  await pool.query(`INSERT INTO fmcc_org_profile(tenant_id, default_locale, country_code, currency, timezone, updated_by) VALUES($1,'pt-BR',$2,$3,'UTC','t')`, [`${TP}${t}`, country, currency]);
}
beforeEach(async () => {
  await clean();
  now = new Date("2026-03-10T12:00:00Z");
  simA = new SimulatedPaymentProvider("sim_a", "segredo-a-teste"); simB = new SimulatedPaymentProvider("sim_b", "segredo-b-teste");
  repo = new PostgresSubscriptionRepository(pool);
  service = new SubscriptionService(repo, new PaymentProviderRegistry({ sim_a: () => simA, sim_b: () => simB, sim_c: () => new SimulatedPaymentProvider("sim_c", "x", ["BRL"]) }), () => now);
  await pool.query(`INSERT INTO fmcc_saas_plan(id, name) VALUES('saas-it-pro','Pro')`);
  await pool.query(`INSERT INTO fmcc_saas_plan_price(plan_id, currency, country, amount_minor, "interval") VALUES('saas-it-pro','BRL',NULL,4900,'month'),('saas-it-pro','USD',NULL,1900,'month')`);
  await pool.query(`INSERT INTO fmcc_saas_payment_route(currency, country, provider_id) VALUES('BRL',NULL,'sim_a'),('USD',NULL,'sim_b')`);
  await profile("br", "BRL", "BR"); await profile("us", "USD", "US"); await profile("eu", "EUR", "DE");
});
afterAll(clean);

const subscribe = (t: string, key?: string) => service.subscribe(ctx(t), { planId: "saas-it-pro", customer, idempotencyKey: key });
/** Faz a linha parecer parada ha 1 minuto (relogio do banco), como uma criacao interrompida de verdade. */
const age = (t: string) => pool.query(`UPDATE fmcc_saas_subscription SET updated_at = now() - interval '60 seconds' WHERE tenant_id=$1`, [`${TP}${t}`]);
const refOf = async (t: string) => (await repo.current(`${TP}${t}`))!.providerSubscriptionRef!;
const hook = (sim: SimulatedPaymentProvider, ref: string, type: Parameters<SimulatedPaymentProvider["makeWebhook"]>[0]["type"], eventId: string, amountMinor?: number, currency = "BRL") =>
  sim.makeWebhook({ eventId, type, subscriptionRef: ref, amountMinor, currency, occurredAt: now });

describe("oferta por moeda e pais", () => {
  it("cada empresa ve o preco da propria moeda; sem preco na moeda = sem oferta; sem perfil = pede o perfil", async () => {
    expect((await service.offers(ctx("br"))).offers).toEqual([{ planId: "saas-it-pro", name: "Pro", price: { amountMinor: 4900, currency: "BRL" }, interval: "month" }]);
    expect((await service.offers(ctx("us"))).offers[0]!.price).toEqual({ amountMinor: 1900, currency: "USD" });
    expect((await service.offers(ctx("eu"))).offers).toEqual([]);
    await expect(service.offers(ctx("sem-perfil"))).rejects.toMatchObject({ code: "subscription.profile_required" });
  });
  it("so quem tem permissao de cobranca contrata ou cancela", async () => {
    await expect(service.subscribe(ctx("br", "viewer"), { planId: "saas-it-pro", customer })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.subscribe(ctx("br", "analyst"), { planId: "saas-it-pro", customer })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.cancel(ctx("br", "analyst"))).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.status(ctx("br", "viewer"))).rejects.toBeInstanceOf(PermissionDeniedError);
  });
  it("recusa entrada invalida, plano inexistente e empresa sem preco na moeda", async () => {
    for (const bad of [{ planId: 5, customer }, { planId: "saas-it-pro", customer: { name: "x", email: "a@b.co" } }, { planId: "saas-it-pro", customer: { name: "Maria", email: "ruim" } }, { planId: "saas-it-pro", customer, idempotencyKey: "tem espaco" }])
      await expect(service.subscribe(ctx("br"), bad)).rejects.toMatchObject({ code: "subscription.input_invalid" });
    await expect(service.subscribe(ctx("br"), { planId: "nao-existe", customer })).rejects.toMatchObject({ code: "subscription.plan_not_found" });
    await expect(subscribe("eu")).rejects.toMatchObject({ code: "subscription.no_price_for_currency" });
  });
});

describe("contratar e pagar", () => {
  it("contrata (pendente, sem direito de uso), recebe o pagamento e passa a ativa com periodo", async () => {
    const r = await subscribe("br", "k1");
    expect(r.subscription).toMatchObject({ state: "pending", entitled: false, price: { amountMinor: 4900, currency: "BRL" } });
    const ref = await refOf("br");
    const w = hook(simA, ref, "payment_confirmed", "ev1", 4900);
    expect(await service.handleWebhook("sim_a", w.headers, w.body)).toBe("applied");
    const s = await service.status(ctx("br"));
    expect(s.entitled).toBe(true);
    expect(s.subscription).toMatchObject({ state: "active", currentPeriodEnd: "2026-04-10T12:00:00.000Z" });
    expect(await service.isEntitled(`${TP}br`)).toBe(true);
  });

  it("o mesmo aviso repetido (inclusive em paralelo) estende o periodo uma unica vez", async () => {
    await subscribe("br"); const ref = await refOf("br");
    const w = hook(simA, ref, "payment_confirmed", "evdup", 4900);
    const results = await Promise.all(Array.from({ length: 6 }, () => service.handleWebhook("sim_a", w.headers, w.body)));
    expect(results.filter((x) => x === "applied")).toHaveLength(1);
    expect(results.filter((x) => x === "duplicate")).toHaveLength(5);
    expect((await service.status(ctx("br"))).subscription!.currentPeriodEnd).toBe("2026-04-10T12:00:00.000Z");
  });

  it("aviso com assinatura invalida e recusado; valor errado nao ativa; aviso de outro provedor nao vale", async () => {
    await subscribe("br"); const ref = await refOf("br");
    const forged = hook(simA, ref, "payment_confirmed", "evx", 4900);
    await expect(service.handleWebhook("sim_a", new Headers({ "x-sim-signature": "00".repeat(32) }), forged.body)).rejects.toMatchObject({ code: "webhook.signature_invalid", httpStatus: 401 });
    const other = hook(simB, ref, "payment_confirmed", "evy", 4900); // assinado com o segredo do B
    await expect(service.handleWebhook("sim_a", other.headers, other.body)).rejects.toMatchObject({ httpStatus: 401 });
    const low = hook(simA, ref, "payment_confirmed", "evlow", 100);
    expect(await service.handleWebhook("sim_a", low.headers, low.body)).toBe("applied");
    expect((await service.status(ctx("br"))).subscription!.state).toBe("pending");
    expect((await pool.query(`SELECT outcome FROM fmcc_saas_event WHERE event_id='evlow'`)).rows[0].outcome).toBe("amount_mismatch");
    await expect(service.handleWebhook("nao_existe", forged.headers, forged.body)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("a empresa vem da assinatura gravada: aviso de uma empresa nunca mexe em outra", async () => {
    await subscribe("br"); await subscribe("us");
    const brRef = await refOf("br");
    const w = hook(simA, brRef, "payment_confirmed", "evbr", 4900);
    await service.handleWebhook("sim_a", w.headers, w.body);
    expect((await service.status(ctx("us"))).subscription!.state).toBe("pending");
    expect((await service.status(ctx("br"))).subscription!.state).toBe("active");
    expect((await service.status(ctx("eu"))).subscription).toBeNull();
  });

  it("atraso tira da dia a carencia; pagamento depois volta a ativa", async () => {
    await subscribe("br"); const ref = await refOf("br");
    let w = hook(simA, ref, "payment_confirmed", "e1", 4900); await service.handleWebhook("sim_a", w.headers, w.body);
    now = new Date("2026-04-11T12:00:00Z");
    w = hook(simA, ref, "payment_overdue", "e2"); await service.handleWebhook("sim_a", w.headers, w.body);
    let s = await service.status(ctx("br"));
    expect(s.subscription!.state).toBe("past_due"); expect(s.entitled).toBe(true); // carencia
    now = new Date("2026-04-20T12:00:00Z");
    expect((await service.status(ctx("br"))).entitled).toBe(false);
    w = hook(simA, ref, "payment_confirmed", "e3", 4900); await service.handleWebhook("sim_a", w.headers, w.body);
    s = await service.status(ctx("br"));
    expect(s.subscription!.state).toBe("active"); expect(s.entitled).toBe(true);
  });
});

describe("falhas do provedor e idempotencia", () => {
  it("mesma chave devolve a mesma assinatura sem nova chamada ao provedor; outra assinatura viva e recusada", async () => {
    const a = await subscribe("br", "k1"); const b = await subscribe("br", "k1");
    expect(b.deduplicated).toBe(true); expect(b.subscription.id).toBe(a.subscription.id);
    expect(simA.calls.createSubscription).toBe(1); expect(simA.calls.createCustomer).toBe(1);
    await expect(subscribe("br", "k2")).rejects.toMatchObject({ code: "subscription.already_exists", httpStatus: 409 });
  });

  it("resposta perdida depois de criar: nao cria de novo; recupera pela nossa referencia", async () => {
    simA.fault = "uncertain_after_create";
    await expect(subscribe("br", "k1")).rejects.toMatchObject({ code: "subscription.provider_unavailable", httpStatus: 503 });
    expect((await repo.current(`${TP}br`))!.state).toBe("creating");
    simA.fault = "none";
    await expect(subscribe("br", "k1")).rejects.toMatchObject({ code: "subscription.in_progress" }); // recente: nao disputa
    await age("br");
    const r = await subscribe("br", "k1");
    expect(r.subscription.state).toBe("pending");
    expect(simA.calls.createSubscription).toBe(1); // nunca um segundo POST
    expect(simA.subscriptions.size).toBe(1);
  });

  it("falha transitoria deixa a criacao retomavel com a mesma chave", async () => {
    simA.fault = "transient";
    await expect(subscribe("br", "k1")).rejects.toMatchObject({ httpStatus: 503 });
    simA.fault = "none"; await age("br");
    expect((await subscribe("br", "k1")).subscription.state).toBe("pending");
  });

  it("recusa definitiva: assinatura vira falha e outra chave funciona", async () => {
    simA.fault = "rejected";
    await expect(subscribe("br", "k1")).rejects.toMatchObject({ code: "subscription.provider_rejected", httpStatus: 422 });
    expect((await pool.query(`SELECT state FROM fmcc_saas_subscription WHERE tenant_id=$1`, [`${TP}br`])).rows[0].state).toBe("failed");
    await expect(subscribe("br", "k1")).rejects.toMatchObject({ code: "subscription.failed" });
    simA.fault = "none";
    expect((await subscribe("br", "k2")).subscription.state).toBe("pending");
  });

  it("aviso que chega ANTES de a referencia estar gravada nao se perde: e reaplicado", async () => {
    const t = `${TP}br`;
    const price = { planId: "saas-it-pro", currency: "BRL", country: null, amountMinor: 4900, interval: "month" as const };
    const early = simA.makeWebhook({ eventId: "early1", type: "payment_confirmed", subscriptionRef: "sim_a_sub_corrida", amountMinor: 4900, currency: "BRL", occurredAt: now });
    expect(await service.handleWebhook("sim_a", early.headers, early.body)).toBe("unmatched");
    const { row } = await repo.reserve({ tenantId: t, planId: "saas-it-pro", price, providerId: "sim_a", idempotencyKey: "kc", createdBy: "u" });
    await repo.markPending(row.id, "sim_a_sub_corrida", null);
    expect(await repo.replayUnmatched("sim_a", "sim_a_sub_corrida")).toBe(1);
    expect((await repo.current(t))).toMatchObject({ state: "active" });
    expect(await repo.replayUnmatched("sim_a", "sim_a_sub_corrida")).toBe(0); // nao reaplica duas vezes
  });
});

describe("cancelamento e preco gravado", () => {
  it("cancelar paga ate o fim do periodo; pendente cancelada nao tem direito; cancelar de novo e recusado", async () => {
    await subscribe("br"); const ref = await refOf("br");
    const w = hook(simA, ref, "payment_confirmed", "e1", 4900); await service.handleWebhook("sim_a", w.headers, w.body);
    const c = await service.cancel(ctx("br"));
    expect(c).toMatchObject({ state: "cancelled", cancelAtPeriodEnd: true, entitled: true });
    expect(simA.subscriptions.get(ref)!.cancelled).toBe(true);
    now = new Date("2026-04-11T00:00:00Z");
    expect((await service.status(ctx("br"))).entitled).toBe(false);
    await expect(service.cancel(ctx("br"))).rejects.toMatchObject({ code: "subscription.nothing_to_cancel" });

    await subscribe("us"); // pendente
    expect((await service.cancel(ctx("us"))).entitled).toBe(false);
    // depois de cancelada, a empresa pode contratar de novo
    expect((await subscribe("us", "novo")).subscription.state).toBe("pending");
  });

  it("mudar a tabela de precos nao altera assinatura existente; pagamento no valor novo nao ativa", async () => {
    await subscribe("br"); const ref = await refOf("br");
    await pool.query(`UPDATE fmcc_saas_plan_price SET amount_minor=9900 WHERE plan_id='saas-it-pro' AND currency='BRL'`);
    expect((await service.status(ctx("br"))).subscription!.price.amountMinor).toBe(4900);
    const w = hook(simA, ref, "payment_confirmed", "e9", 9900); await service.handleWebhook("sim_a", w.headers, w.body);
    expect((await service.status(ctx("br"))).subscription!.state).toBe("pending");
  });
});

describe("troca de meio de cobranca por configuracao", () => {
  it("mudar a rota no banco manda a proxima assinatura para outro provedor, sem mudar codigo", async () => {
    await subscribe("br");
    expect(simA.calls.createSubscription).toBe(1); expect(simB.calls.createSubscription).toBe(0);
    await pool.query(`UPDATE fmcc_saas_payment_route SET provider_id='sim_b' WHERE currency='BRL'`);
    await profile("br2", "BRL", "BR");
    await subscribe("br2");
    expect(simB.calls.createSubscription).toBe(1);
    expect((await repo.current(`${TP}br2`))!.providerId).toBe("sim_b");
    expect((await repo.current(`${TP}br`))!.providerId).toBe("sim_a"); // a existente segue no provedor em que nasceu
  });
  it("rota do pais vence a da moeda; rota desligada ou provedor ausente = sem meio de cobranca; moeda nao suportada e recusada", async () => {
    await pool.query(`INSERT INTO fmcc_saas_payment_route(currency, country, provider_id) VALUES('BRL','PT','sim_b')`);
    await profile("pt", "BRL", "PT");
    await subscribe("pt");
    expect((await repo.current(`${TP}pt`))!.providerId).toBe("sim_b");
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=false WHERE currency='BRL'`);
    await expect(subscribe("br")).rejects.toMatchObject({ code: "subscription.no_payment_method" });
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=true, provider_id='sim_c' WHERE currency='USD'`); // sim_c so cobra BRL
    await expect(subscribe("us")).rejects.toMatchObject({ code: "subscription.provider_currency_unsupported" });
    await pool.query(`UPDATE fmcc_saas_payment_route SET provider_id='nao_configurado' WHERE currency='USD'`);
    await expect(subscribe("us")).rejects.toMatchObject({ code: "subscription.no_payment_method" });
  });
});
