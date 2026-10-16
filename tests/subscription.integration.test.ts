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
  await pool.query("DELETE FROM fmcc_saas_fee_schedule WHERE provider_id IN ('sim_a','sim_b')");
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

let autoKey = 0;
const subscribe = (t: string, key?: string) => service.subscribe(ctx(t), { planId: "saas-it-pro", customer, idempotencyKey: key ?? `auto-${++autoKey}` });
/** Faz a linha parecer parada ha 1 minuto (relogio do banco), como uma criacao interrompida de verdade. */
const age = (t: string) => pool.query(`UPDATE fmcc_saas_subscription SET updated_at = now() - interval '120 seconds' WHERE tenant_id=$1`, [`${TP}${t}`]);
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
    await expect(service.subscribe(ctx("br"), { planId: "nao-existe", customer, idempotencyKey: "kx" })).rejects.toMatchObject({ code: "subscription.plan_not_found" });
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
    // markPending grava a referencia e reaplica os avisos guardados, na mesma transacao
    expect((await repo.markPending(row.id, "sim_a", "sim_a_sub_corrida", null))).toMatchObject({ state: "active" });
    expect(await outcomeOf("early1")).toBe("applied");
    // reenvio do mesmo aviso: ja aplicado, nao estende o periodo de novo
    const end = (await repo.current(t))!.currentPeriodEnd;
    expect(await service.handleWebhook("sim_a", early.headers, early.body)).toBe("duplicate");
    expect((await repo.current(t))!.currentPeriodEnd).toEqual(end);
  });
});

async function outcomeOf(eventId: string) {
  return (await pool.query(`SELECT outcome FROM fmcc_saas_event WHERE event_id=$1`, [eventId])).rows[0]?.outcome;
}

describe("retomada, posse e avisos (revisao independente)", () => {
  it("a chave de idempotencia e obrigatoria", async () => {
    await expect(service.subscribe(ctx("br"), { planId: "saas-it-pro", customer })).rejects.toMatchObject({ code: "subscription.idempotency_key_required", httpStatus: 400 });
  });

  it("duas retomadas ao mesmo tempo: so uma fala com o provedor (sem assinatura em dobro)", async () => {
    simA.fault = "transient";
    await expect(subscribe("br", "kr")).rejects.toMatchObject({ httpStatus: 503 });
    simA.fault = "none"; await age("br");
    const results = await Promise.allSettled([subscribe("br", "kr"), subscribe("br", "kr"), subscribe("br", "kr")]);
    // uma retomou e terminou; as outras ou veem "em andamento" ou recebem o resultado ja pronto
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "fulfilled") expect(r.value.subscription.state).toBe("pending");
      else expect((r.reason as { code?: string }).code).toBe("subscription.in_progress");
    }
    expect(simA.subscriptions.size).toBe(1);
  });

  it("criacao ainda dentro da posse nao e retomada por outra requisicao", async () => {
    simA.fault = "transient";
    await expect(subscribe("br", "kp")).rejects.toMatchObject({ httpStatus: 503 });
    simA.fault = "none";
    await expect(subscribe("br", "kp")).rejects.toMatchObject({ code: "subscription.in_progress" });
  });

  it("a retomada usa o provedor gravado, mesmo que a rota tenha mudado", async () => {
    simA.fault = "transient";
    await expect(subscribe("br", "km")).rejects.toMatchObject({ httpStatus: 503 });
    simA.fault = "none"; await age("br");
    await pool.query(`UPDATE fmcc_saas_subscription SET provider_id='nao_existe' WHERE tenant_id=$1`, [`${TP}br`]);
    await expect(subscribe("br", "km")).rejects.toMatchObject({ code: "subscription.provider_unavailable", httpStatus: 503 });
    expect(simA.subscriptions.size).toBe(0);
  });

  it("pagamento confirmado SEM valor nao ativa", async () => {
    await subscribe("br"); const ref = await refOf("br");
    const w = simA.makeWebhook({ eventId: "novalue", type: "payment_confirmed", subscriptionRef: ref, occurredAt: now });
    expect(await service.handleWebhook("sim_a", w.headers, w.body)).toBe("applied");
    expect(await outcomeOf("novalue")).toBe("amount_missing");
    expect((await service.status(ctx("br"))).subscription).toMatchObject({ state: "pending", entitled: false });
  });

  it("reenvio do provedor de um aviso guardado sem assinatura e aplicado quando a assinatura ja existe", async () => {
    const t = `${TP}br`;
    const price = { planId: "saas-it-pro", currency: "BRL", country: null, amountMinor: 4900, interval: "month" as const };
    const early = simA.makeWebhook({ eventId: "early2", type: "payment_confirmed", subscriptionRef: "sim_a_sub_reenvio", amountMinor: 4900, currency: "BRL", occurredAt: now });
    expect(await service.handleWebhook("sim_a", early.headers, early.body)).toBe("unmatched");
    const { row } = await repo.reserve({ tenantId: t, planId: "saas-it-pro", price, providerId: "sim_a", idempotencyKey: "kre", createdBy: "u" });
    // referencia gravada SEM passar pelo replay (simula a perda do replay): o reenvio precisa recuperar
    await pool.query(`UPDATE fmcc_saas_subscription SET state='pending', provider_subscription_ref='sim_a_sub_reenvio' WHERE id=$1`, [row.id]);
    expect(await service.handleWebhook("sim_a", early.headers, early.body)).toBe("applied");
    expect(await repo.current(t)).toMatchObject({ state: "active" });
  });
});

describe("taxas configuraveis por meio de cobranca", () => {
  const fee = (providerId: string, method: string, fixed: number, bps: number, from: string) =>
    pool.query(`INSERT INTO fmcc_saas_fee_schedule(provider_id, method, currency, fixed_minor, percent_bps, effective_from) VALUES($1,$2,'BRL',$3,$4,$5)`, [providerId, method, fixed, bps, from]);

  it("sem tabela configurada a taxa e indisponivel (null), nunca zero", async () => {
    expect(await service.feeFor("sim_a", "boleto", 4900, "BRL")).toBeNull();
  });

  it("cada banco e cada forma de pagamento tem a sua taxa; vale a vigencia mais recente que ja comecou", async () => {
    await fee("sim_a", "boleto", 349, 0, "2026-01-01T00:00:00Z");
    await fee("sim_a", "boleto", 299, 0, "2026-03-01T00:00:00Z"); // reajuste ja vigente
    await fee("sim_a", "boleto", 100, 0, "2026-06-01T00:00:00Z"); // futura: ainda nao vale
    await fee("sim_a", "pix", 0, 99, "2026-01-01T00:00:00Z");
    await fee("sim_b", "boleto", 500, 0, "2026-01-01T00:00:00Z");
    expect(await service.feeFor("sim_a", "boleto", 4900, "BRL")).toMatchObject({ feeMinor: 299, netMinor: 4601 });
    expect(await service.feeFor("sim_a", "pix", 4900, "BRL")).toMatchObject({ feeMinor: 49, netMinor: 4851 });
    expect(await service.feeFor("sim_b", "boleto", 4900, "BRL")).toMatchObject({ feeMinor: 500 });
    expect(await service.feeFor("sim_a", "card", 4900, "BRL")).toBeNull(); // forma nao configurada
    expect(await service.feeFor("sim_a", "boleto", 4900, "USD")).toBeNull(); // outra moeda: nao converte
    expect(await service.feeFor("sim_a", "boleto", 4900, "BRL", new Date("2026-07-01T00:00:00Z"))).toMatchObject({ feeMinor: 100 });
    expect(await service.feeFor("sim_a", "boleto", 4900, "BRL", new Date("2025-12-01T00:00:00Z"))).toBeNull(); // antes de qualquer vigencia
  });

  it("tabela desativada nao vale; o banco recusa taxa invalida", async () => {
    await fee("sim_a", "boleto", 349, 0, "2026-01-01T00:00:00Z");
    await pool.query(`UPDATE fmcc_saas_fee_schedule SET active=false WHERE provider_id='sim_a'`);
    expect(await service.feeFor("sim_a", "boleto", 4900, "BRL")).toBeNull();
    await expect(fee("sim_a", "pix", 0, 10001, "2026-01-01T00:00:00Z")).rejects.toThrow();
    await expect(fee("sim_a", "cheque", 0, 1, "2026-01-01T00:00:00Z")).rejects.toThrow();
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
  it("rota do pais vence a da moeda; rota desligada ou provedor ausente = sem meio de cobranca; provedor que nao cobra a moeda e pulado", async () => {
    await pool.query(`INSERT INTO fmcc_saas_payment_route(currency, country, provider_id) VALUES('BRL','PT','sim_b')`);
    await profile("pt", "BRL", "PT");
    await subscribe("pt");
    expect((await repo.current(`${TP}pt`))!.providerId).toBe("sim_b");
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=false WHERE currency='BRL'`);
    await expect(subscribe("br")).rejects.toMatchObject({ code: "subscription.no_payment_method" });
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=true, provider_id='sim_c' WHERE currency='USD'`); // sim_c so cobra BRL
    await expect(subscribe("us")).rejects.toMatchObject({ code: "subscription.no_payment_method" }); // sim_c nao cobra USD: sem reserva, nao ha meio
    await pool.query(`UPDATE fmcc_saas_payment_route SET provider_id='nao_configurado' WHERE currency='USD'`);
    await expect(subscribe("us")).rejects.toMatchObject({ code: "subscription.no_payment_method" });
  });
});

describe("varios provedores por rota (reserva) e capacidades", () => {
  const route = (currency: string, provider: string, priority: number, country: string | null = null) =>
    pool.query(`INSERT INTO fmcc_saas_payment_route(currency, country, provider_id, priority) VALUES($1,$2,$3,$4)`, [currency, country, provider, priority]);

  it("usa o de menor prioridade; se estiver desligado, o seguinte assume; a existente nao muda", async () => {
    await pool.query(`DELETE FROM fmcc_saas_payment_route WHERE currency='BRL'`);
    await route("BRL", "sim_a", 0); await route("BRL", "sim_b", 1);
    await subscribe("br");
    expect((await repo.current(`${TP}br`))!.providerId).toBe("sim_a");
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=false WHERE provider_id='sim_a'`);
    await profile("br2", "BRL", "BR");
    await subscribe("br2");
    expect((await repo.current(`${TP}br2`))!.providerId).toBe("sim_b");
    expect((await repo.current(`${TP}br`))!.providerId).toBe("sim_a");
  });

  it("provedor sem configuracao neste ambiente e pulado; rota do pais vem antes da generica", async () => {
    await pool.query(`DELETE FROM fmcc_saas_payment_route WHERE currency='BRL'`);
    await route("BRL", "nao_configurado", 0); await route("BRL", "sim_b", 1); await route("BRL", "sim_a", 0, "BR");
    await subscribe("br");
    expect((await repo.current(`${TP}br`))!.providerId).toBe("sim_a"); // pais BR antes da generica
    await pool.query(`UPDATE fmcc_saas_payment_route SET enabled=false WHERE country='BR'`);
    await profile("br2", "BRL", "BR");
    await subscribe("br2");
    expect((await repo.current(`${TP}br2`))!.providerId).toBe("sim_b"); // generica: o nao configurado e pulado
  });

  it("o banco recusa prioridade repetida e o mesmo provedor duas vezes na mesma rota", async () => {
    await pool.query(`DELETE FROM fmcc_saas_payment_route WHERE currency='BRL'`);
    await route("BRL", "sim_a", 0);
    await expect(route("BRL", "sim_b", 0)).rejects.toThrow();
    await expect(route("BRL", "sim_a", 1)).rejects.toThrow();
  });

  it("provedor que cobra a cada ciclo (ainda nao implementado) e declarado mas nunca escolhido", async () => {
    const invoiceOnly = new SimulatedPaymentProvider("sim_c", "x", ["BRL"], { billingMode: "invoice_each_cycle", methods: ["pix", "boleto"], refunds: false });
    const svc = new SubscriptionService(repo, new PaymentProviderRegistry({ sim_a: () => simA, sim_c: () => invoiceOnly }), () => now);
    await pool.query(`DELETE FROM fmcc_saas_payment_route WHERE currency='BRL'`);
    await route("BRL", "sim_c", 0);
    await expect(svc.subscribe(ctx("br"), { planId: "saas-it-pro", customer, idempotencyKey: "kinv" })).rejects.toMatchObject({ code: "subscription.no_payment_method" });
    expect(invoiceOnly.calls.createCustomer).toBe(0);
    await route("BRL", "sim_a", 1); // com uma reserva que cobra sozinha, segue
    expect((await svc.subscribe(ctx("br"), { planId: "saas-it-pro", customer, idempotencyKey: "kinv2" })).subscription.state).toBe("pending");
  });

  it("compara o liquido por rota com as taxas configuradas (sem taxa = fim da lista, nunca zero)", async () => {
    await pool.query(`DELETE FROM fmcc_saas_payment_route WHERE currency='BRL'`);
    await route("BRL", "sim_a", 0); await route("BRL", "sim_b", 1);
    const ins = (p: string, m: string, fixed: number) => pool.query(`INSERT INTO fmcc_saas_fee_schedule(provider_id, method, currency, fixed_minor, effective_from) VALUES($1,$2,'BRL',$3,'2026-01-01')`, [p, m, fixed]);
    await ins("sim_a", "pix", 300); await ins("sim_b", "pix", 100);
    expect(await service.compareRoutes("BRL", "BR", "pix", 4900)).toEqual([
      { providerId: "sim_b", priority: 1, feeMinor: 100, netMinor: 4800 },
      { providerId: "sim_a", priority: 0, feeMinor: 300, netMinor: 4600 },
    ]);
    await pool.query(`DELETE FROM fmcc_saas_fee_schedule WHERE provider_id='sim_b'`);
    const r = await service.compareRoutes("BRL", "BR", "pix", 4900);
    expect(r.map((x) => x.providerId)).toEqual(["sim_a", "sim_b"]);
    expect(r[1]).toMatchObject({ feeMinor: null, netMinor: null });
  });
});
