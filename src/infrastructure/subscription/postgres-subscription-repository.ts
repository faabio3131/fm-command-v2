import type { Pool } from "pg";
import type { PaymentEvent } from "@/domain/subscription/payment-provider";
import type { BillingInterval, PlanPrice } from "@/domain/subscription/plan";
import type { FeeSchedule, PaymentMethod } from "@/domain/subscription/fee-schedule";
import { applyPaymentEvent, type SubscriptionSnapshot, type SubscriptionState, type TransitionOutcome } from "@/domain/subscription/subscription-state";

export interface SubscriptionRow {
  readonly id: string; readonly tenantId: string; readonly planId: string;
  readonly priceAmountMinor: number; readonly currency: string; readonly interval: BillingInterval;
  readonly state: SubscriptionState; readonly providerId: string;
  readonly providerCustomerRef: string | null; readonly providerSubscriptionRef: string | null; readonly checkoutUrl: string | null;
  readonly currentPeriodEnd: Date | null; readonly cancelAtPeriodEnd: boolean; readonly lastEventAt: Date | null; readonly createdAt: Date; readonly updatedAt: Date;
  /** Idade desde a ultima atividade, medida pelo relogio do BANCO (mesma fonte para todos os processos). */
  readonly idleMs: number;
}

const COLS = `id, tenant_id, plan_id, price_amount_minor, currency, "interval", state, provider_id, provider_customer_ref,
  provider_subscription_ref, checkout_url, current_period_end, cancel_at_period_end, last_event_at, created_at, updated_at,
  (extract(epoch from (now() - updated_at)) * 1000)::float8 AS idle_ms`;

type Raw = Record<string, unknown>;
function row(r: Raw): SubscriptionRow {
  return {
    id: r.id as string, tenantId: r.tenant_id as string, planId: r.plan_id as string, priceAmountMinor: r.price_amount_minor as number,
    currency: r.currency as string, interval: r.interval as BillingInterval, state: r.state as SubscriptionState, providerId: r.provider_id as string,
    providerCustomerRef: r.provider_customer_ref as string | null, providerSubscriptionRef: r.provider_subscription_ref as string | null,
    checkoutUrl: r.checkout_url as string | null, currentPeriodEnd: r.current_period_end as Date | null,
    cancelAtPeriodEnd: r.cancel_at_period_end as boolean, lastEventAt: r.last_event_at as Date | null, createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, idleMs: Number(r.idle_ms),
  };
}

export class LiveSubscriptionExistsError extends Error { constructor() { super("subscription.already_exists"); } }
export type ApplyEventResult = { kind: "duplicate" } | { kind: "unmatched" } | { kind: "applied"; outcome: TransitionOutcome; subscription: SubscriptionRow };

export class PostgresSubscriptionRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}

  async orgProfile(tenantId: string): Promise<{ currency: string; country: string } | null> {
    const r = await this.pool.query(`SELECT currency, country_code FROM fmcc_org_profile WHERE tenant_id=$1`, [tenantId]);
    return r.rows[0] ? { currency: r.rows[0].currency, country: r.rows[0].country_code } : null;
  }

  async activePlans(): Promise<Array<{ id: string; name: string; prices: PlanPrice[] }>> {
    const [plans, prices] = await Promise.all([
      this.pool.query(`SELECT id, name FROM fmcc_saas_plan WHERE active ORDER BY id`),
      this.pool.query(`SELECT plan_id, currency, country, amount_minor, "interval" FROM fmcc_saas_plan_price WHERE active`),
    ]);
    return plans.rows.map((p) => ({
      id: p.id, name: p.name,
      prices: prices.rows.filter((x) => x.plan_id === p.id).map((x) => ({ planId: x.plan_id, currency: x.currency, country: x.country, amountMinor: x.amount_minor, interval: x.interval })),
    }));
  }

  /**
   * Rotas ligadas para a moeda/pais, na ordem em que devem ser tentadas: as do pais antes das genericas, e dentro de cada grupo
   * pela prioridade (menor primeiro). Devolve todas; quem escolhe descarta as que nao estao configuradas neste ambiente.
   */
  async routesFor(currency: string, country: string): Promise<Array<{ providerId: string; priority: number }>> {
    const r = await this.pool.query(
      `SELECT provider_id, priority FROM fmcc_saas_payment_route WHERE enabled AND currency=$1 AND (country=$2 OR country IS NULL)
       ORDER BY (country IS NULL) ASC, priority ASC, provider_id ASC`, [currency, country]);
    return r.rows.map((x) => ({ providerId: x.provider_id as string, priority: x.priority as number }));
  }

  /** Reserva a assinatura ANTES de falar com o provedor. Mesma chave = mesma linha (inserted=false). */
  async reserve(i: { tenantId: string; planId: string; price: PlanPrice; providerId: string; idempotencyKey: string; createdBy: string }): Promise<{ row: SubscriptionRow; inserted: boolean }> {
    try {
      const ins = await this.pool.query(
        `INSERT INTO fmcc_saas_subscription(tenant_id, plan_id, price_amount_minor, currency, "interval", state, provider_id, idempotency_key, created_by)
         VALUES($1,$2,$3,$4,$5,'creating',$6,$7,$8) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING ${COLS}`,
        [i.tenantId, i.planId, i.price.amountMinor, i.price.currency, i.price.interval, i.providerId, i.idempotencyKey, i.createdBy]);
      if (ins.rows[0]) return { row: row(ins.rows[0]), inserted: true };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new LiveSubscriptionExistsError();
      throw e;
    }
    const ex = await this.pool.query(`SELECT ${COLS} FROM fmcc_saas_subscription WHERE tenant_id=$1 AND idempotency_key=$2`, [i.tenantId, i.idempotencyKey]);
    return { row: row(ex.rows[0]), inserted: false };
  }

  /**
   * Reserva ATOMICA da retomada de uma criacao interrompida: so quem muda `updated_at` com a linha parada ha mais de `leaseMs`
   * (relogio do banco) recebe a linha; os demais recebem null e respondem "em andamento". Evita dois POSTs no provedor.
   */
  async claimResume(id: string, leaseMs: number): Promise<SubscriptionRow | null> {
    const r = await this.pool.query(
      `UPDATE fmcc_saas_subscription SET updated_at=now()
       WHERE id=$1 AND state='creating' AND now() - updated_at > make_interval(secs => $2::float8 / 1000) RETURNING ${COLS}`, [id, leaseMs]);
    return r.rows[0] ? row(r.rows[0]) : null;
  }
  /** Renova a posse antes de cada chamada ao provedor (cada uma pode levar ate o timeout). */
  async touch(id: string): Promise<void> {
    await this.pool.query(`UPDATE fmcc_saas_subscription SET updated_at=now() WHERE id=$1 AND state='creating'`, [id]);
  }

  async setCustomer(id: string, customerRef: string): Promise<void> {
    await this.pool.query(`UPDATE fmcc_saas_subscription SET provider_customer_ref=$2, updated_at=now() WHERE id=$1 AND state='creating'`, [id, customerRef]);
  }
  /**
   * Grava a referencia do provedor E reaplica, na MESMA transacao e sob a mesma trava da referencia, os avisos que chegaram antes.
   * A trava (por provedor+referencia) serializa com o webhook: ou o aviso ja estava gravado e e reaplicado aqui, ou espera e ja acha a assinatura.
   */
  async markPending(id: string, providerId: string, subscriptionRef: string, checkoutUrl: string | null): Promise<SubscriptionRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockRef(client, providerId, subscriptionRef);
      await client.query(
        `UPDATE fmcc_saas_subscription SET state='pending', provider_subscription_ref=$2, checkout_url=$3, updated_at=now() WHERE id=$1 AND state='creating'`,
        [id, subscriptionRef, checkoutUrl]);
      await this.replayUnmatched(client, providerId, subscriptionRef);
      const cur = await client.query(`SELECT ${COLS} FROM fmcc_saas_subscription WHERE id=$1`, [id]);
      await client.query("COMMIT");
      return row(cur.rows[0]);
    } catch (err) { await client.query("ROLLBACK").catch(() => undefined); throw err; }
    finally { client.release(); }
  }
  async markFailed(id: string): Promise<void> {
    await this.pool.query(`UPDATE fmcc_saas_subscription SET state='failed', updated_at=now() WHERE id=$1 AND state='creating'`, [id]);
  }

  /** A assinatura viva da empresa, ou a mais recente. */
  async current(tenantId: string): Promise<SubscriptionRow | null> {
    const r = await this.pool.query(
      `SELECT ${COLS} FROM fmcc_saas_subscription WHERE tenant_id=$1 AND state <> 'failed'
       ORDER BY (state IN ('creating','pending','active','past_due')) DESC, created_at DESC LIMIT 1`, [tenantId]);
    return r.rows[0] ? row(r.rows[0]) : null;
  }

  async markCancelled(tenantId: string, id: string): Promise<SubscriptionRow | null> {
    const r = await this.pool.query(
      `UPDATE fmcc_saas_subscription SET state='cancelled', cancel_at_period_end=true, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND state IN ('pending','active','past_due') RETURNING ${COLS}`, [id, tenantId]);
    return r.rows[0] ? row(r.rows[0]) : null;
  }

  /**
   * Aplica um evento do provedor uma unica vez. Livro e assinatura mudam na mesma transacao: se algo falhar no meio, nada fica
   * gravado e o reenvio do provedor reaplica. A empresa vem da assinatura que NOS gravamos, nunca do evento.
   * Evento de assinatura ainda desconhecida fica como "unmatched" e e reaplicado quando a assinatura for gravada (replayUnmatched).
   */
  async applyEvent(providerId: string, e: PaymentEvent): Promise<ApplyEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockRef(client, providerId, e.subscriptionRef);
      const led = await client.query(
        `INSERT INTO fmcc_saas_event(provider_id, event_id, subscription_ref, amount_minor, currency, type, outcome, occurred_at) VALUES($1,$2,$3,$4,$5,$6,'received',$7)
         ON CONFLICT (provider_id, event_id) DO NOTHING RETURNING event_id`,
        [providerId, e.eventId, e.subscriptionRef, e.amount?.amountMinor ?? null, e.amount?.currency ?? null, e.type, e.occurredAt]);
      if (!led.rows[0]) {
        // Reenvio de aviso que ficou guardado sem assinatura: tenta de novo (a assinatura pode ter sido gravada depois).
        const prev = await client.query(`SELECT outcome FROM fmcc_saas_event WHERE provider_id=$1 AND event_id=$2 FOR UPDATE`, [providerId, e.eventId]);
        if (prev.rows[0]?.outcome === "unmatched") {
          const again = await this.resolve(client, providerId, e);
          await client.query("COMMIT");
          return again;
        }
        await client.query("ROLLBACK");
        return { kind: "duplicate" };
      }
      const result = await this.resolve(client, providerId, e);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally { client.release(); }
  }

  private async resolve(client: { query: Pool["query"] }, providerId: string, e: PaymentEvent): Promise<ApplyEventResult> {
    const cur = await client.query(`SELECT ${COLS} FROM fmcc_saas_subscription WHERE provider_id=$1 AND provider_subscription_ref=$2 FOR UPDATE`, [providerId, e.subscriptionRef]);
    if (!cur.rows[0]) {
      await client.query(`UPDATE fmcc_saas_event SET outcome='unmatched' WHERE provider_id=$1 AND event_id=$2`, [providerId, e.eventId]);
      return { kind: "unmatched" };
    }
    const s = row(cur.rows[0]);
    const snap: SubscriptionSnapshot = { state: s.state, price: { amountMinor: s.priceAmountMinor, currency: s.currency }, interval: s.interval, currentPeriodEnd: s.currentPeriodEnd, lastEventAt: s.lastEventAt };
    const t = applyPaymentEvent(snap, e);
    const up = await client.query(
      `UPDATE fmcc_saas_subscription SET state=$2, current_period_end=$3, last_event_at=$4, updated_at=now() WHERE id=$1 RETURNING ${COLS}`,
      [s.id, t.next.state, t.next.currentPeriodEnd, t.next.lastEventAt]);
    await client.query(`UPDATE fmcc_saas_event SET outcome=$3, subscription_id=$4 WHERE provider_id=$1 AND event_id=$2`, [providerId, e.eventId, t.outcome, s.id]);
    return { kind: "applied", outcome: t.outcome, subscription: row(up.rows[0]) };
  }

  private async lockRef(client: { query: Pool["query"] }, providerId: string, subscriptionRef: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${providerId}:${subscriptionRef}`]);
  }

  /** Reaplica, em ordem, os avisos guardados para esta referencia. Roda dentro da transacao e da trava de quem chama. */
  private async replayUnmatched(client: { query: Pool["query"] }, providerId: string, subscriptionRef: string): Promise<number> {
    const pending = await client.query(
      `SELECT event_id, type, subscription_ref, amount_minor, currency, occurred_at FROM fmcc_saas_event
       WHERE provider_id=$1 AND subscription_ref=$2 AND outcome='unmatched' ORDER BY occurred_at, received_at FOR UPDATE`, [providerId, subscriptionRef]);
    let applied = 0;
    for (const l of pending.rows) {
      const r = await this.resolve(client, providerId, {
        eventId: l.event_id, type: l.type, subscriptionRef: l.subscription_ref, paymentRef: null,
        amount: l.amount_minor !== null ? { amountMinor: l.amount_minor, currency: l.currency } : null, occurredAt: l.occurred_at,
      });
      if (r.kind === "applied") applied++;
    }
    return applied;
  }

  /** Tabela de taxas vigente em `at` para o meio e a forma de pagamento (a de vigencia mais recente que ja comecou). null = nao configurada. */
  async feeScheduleAt(providerId: string, method: PaymentMethod, currency: string, at: Date): Promise<FeeSchedule | null> {
    const r = await this.pool.query(
      `SELECT provider_id, method, currency, fixed_minor, percent_bps, min_minor, max_minor, effective_from FROM fmcc_saas_fee_schedule
       WHERE active AND provider_id=$1 AND method=$2 AND currency=$3 AND effective_from <= $4 ORDER BY effective_from DESC LIMIT 1`,
      [providerId, method, currency, at]);
    const x = r.rows[0];
    return x ? { providerId: x.provider_id, method: x.method, currency: x.currency, fixedMinor: x.fixed_minor, percentBps: x.percent_bps, minMinor: x.min_minor, maxMinor: x.max_minor, effectiveFrom: x.effective_from } : null;
  }
}
