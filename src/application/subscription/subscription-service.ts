import { PaymentProviderError, WebhookRejectedError, type PaymentProvider } from "@/domain/subscription/payment-provider";
import { selectPrice } from "@/domain/subscription/plan";
import { DEFAULT_GRACE_DAYS, isEntitled, type SubscriptionState } from "@/domain/subscription/subscription-state";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import { LiveSubscriptionExistsError, type PostgresSubscriptionRepository, type SubscriptionRow } from "@/infrastructure/subscription/postgres-subscription-repository";
import type { PaymentProviderRegistry } from "@/infrastructure/subscription/provider-registry";

/** Erro de negocio com codigo publico estavel; a tela traduz o codigo, nunca mostra texto do provedor. */
export class SubscriptionError extends Error {
  constructor(readonly code: string, readonly httpStatus: number) { super(code); this.name = "SubscriptionError"; }
}

export interface PublicSubscription {
  readonly id: string; readonly planId: string; readonly state: SubscriptionState;
  readonly price: { amountMinor: number; currency: string }; readonly interval: "month" | "year";
  readonly currentPeriodEnd: string | null; readonly cancelAtPeriodEnd: boolean; readonly entitled: boolean; readonly checkoutUrl: string | null;
}

const NAME = (v: unknown) => typeof v === "string" && v.trim().length >= 2 && v.length <= 200;
const EMAIL = (v: unknown) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
/** Posse da criacao: maior que a soma dos tempos limite das 3 chamadas ao provedor (3 x 10 s). Cada chamada renova a posse. */
const CREATE_LEASE_MS = 60_000;
const KEY = /^[\x21-\x7e]{1,128}$/;

export class SubscriptionService {
  constructor(
    private readonly repo: PostgresSubscriptionRepository,
    private readonly providers: PaymentProviderRegistry,
    private readonly clock: () => Date = () => new Date(),
    private readonly graceDays = DEFAULT_GRACE_DAYS,
  ) {}

  private view(s: SubscriptionRow): PublicSubscription {
    return {
      id: s.id, planId: s.planId, state: s.state, price: { amountMinor: s.priceAmountMinor, currency: s.currency }, interval: s.interval,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      entitled: isEntitled(s, this.clock(), this.graceDays), checkoutUrl: s.checkoutUrl,
    };
  }

  /** Planos com o preco que vale para ESTA empresa (moeda e pais do perfil). Plano sem preco na moeda da empresa nao e oferecido. */
  async offers(ctx: TenantContext) {
    requirePermission(ctx, "billing:read");
    const profile = await this.repo.orgProfile(ctx.tenantId);
    if (!profile) throw new SubscriptionError("subscription.profile_required", 409);
    const plans = await this.repo.activePlans();
    const offers = plans.flatMap((p) => {
      const price = selectPrice(p.prices, profile);
      return price ? [{ planId: p.id, name: p.name, price: { amountMinor: price.amountMinor, currency: price.currency }, interval: price.interval }] : [];
    });
    return { currency: profile.currency, country: profile.country, offers };
  }

  async status(ctx: TenantContext): Promise<{ subscription: PublicSubscription | null; entitled: boolean }> {
    requirePermission(ctx, "billing:read");
    const s = await this.repo.current(ctx.tenantId);
    return { subscription: s ? this.view(s) : null, entitled: s ? isEntitled(s, this.clock(), this.graceDays) : false };
  }

  /** Uso interno (sem papel): a empresa tem direito de uso agora? */
  async isEntitled(tenantId: string): Promise<boolean> {
    const s = await this.repo.current(tenantId);
    return s ? isEntitled(s, this.clock(), this.graceDays) : false;
  }

  async subscribe(ctx: TenantContext, input: { planId: unknown; customer: unknown; idempotencyKey?: unknown }): Promise<{ subscription: PublicSubscription; deduplicated: boolean }> {
    requirePermission(ctx, "billing:write");
    const c = (input.customer ?? {}) as Record<string, unknown>;
    if (typeof input.planId !== "string" || !NAME(c.name) || !EMAIL(c.email) || (c.taxId != null && !(typeof c.taxId === "string" && c.taxId.length <= 32)))
      throw new SubscriptionError("subscription.input_invalid", 400);
    // A chave e obrigatoria: sem ela, uma falha incerta deixaria a empresa presa em "creating" sem como retomar.
    const key = input.idempotencyKey;
    if (key == null || key === "") throw new SubscriptionError("subscription.idempotency_key_required", 400);
    if (typeof key !== "string" || !KEY.test(key)) throw new SubscriptionError("subscription.input_invalid", 400);

    const profile = await this.repo.orgProfile(ctx.tenantId);
    if (!profile) throw new SubscriptionError("subscription.profile_required", 409);
    const plan = (await this.repo.activePlans()).find((p) => p.id === input.planId);
    if (!plan) throw new SubscriptionError("subscription.plan_not_found", 404);
    const price = selectPrice(plan.prices, profile);
    if (!price) throw new SubscriptionError("subscription.no_price_for_currency", 409);
    const providerId = await this.repo.routeFor(price.currency, profile.country);
    const provider = providerId ? this.providers.get(providerId) : null;
    if (!providerId || !provider) throw new SubscriptionError("subscription.no_payment_method", 409);
    if (!provider.currencies.includes(price.currency)) throw new SubscriptionError("subscription.provider_currency_unsupported", 409);

    let reserved;
    try { reserved = await this.repo.reserve({ tenantId: ctx.tenantId, planId: plan.id, price, providerId, idempotencyKey: key, createdBy: ctx.userId }); }
    catch (e) { if (e instanceof LiveSubscriptionExistsError) throw new SubscriptionError("subscription.already_exists", 409); throw e; }

    let sub = reserved.row;
    let activeProvider = provider;
    if (!reserved.inserted) {
      // Mesma chave: devolve o que ja existe; so uma criacao interrompida ("creating") e retomada.
      if (sub.state === "failed") throw new SubscriptionError("subscription.failed", 409);
      if (sub.state !== "creating") return { subscription: this.view(sub), deduplicated: true };
      // A retomada usa o provedor GRAVADO na assinatura, nunca a rota de hoje (a rota pode ter mudado).
      const stored = this.providers.get(sub.providerId);
      if (!stored) throw new SubscriptionError("subscription.provider_unavailable", 503);
      activeProvider = stored;
      // Reserva atomica: so um retomador por vez, e so se a posse anterior expirou.
      const claimed = await this.repo.claimResume(sub.id, CREATE_LEASE_MS);
      if (!claimed) throw new SubscriptionError("subscription.in_progress", 409);
      sub = claimed;
    }
    sub = await this.finishCreation(activeProvider, sub, { name: (c.name as string).trim(), email: c.email as string, taxId: (c.taxId as string | null | undefined) ?? null }, plan.name);
    return { subscription: this.view(sub), deduplicated: !reserved.inserted };
  }

  /** Cria no provedor sem nunca repetir um POST as cegas: antes de criar, procura pela nossa referencia. */
  private async finishCreation(provider: PaymentProvider, sub: SubscriptionRow, customer: { name: string; email: string; taxId: string | null }, planName: string): Promise<SubscriptionRow> {
    try {
      let customerRef = sub.providerCustomerRef;
      if (!customerRef) {
        await this.repo.touch(sub.id);
        customerRef = (await provider.createCustomer({ ...customer, externalReference: sub.id })).customerRef;
        await this.repo.setCustomer(sub.id, customerRef);
      }
      await this.repo.touch(sub.id);
      const found = await provider.findSubscriptionByReference(sub.id);
      if (!found) await this.repo.touch(sub.id);
      const created = found ?? await provider.createSubscription({
        customerRef, price: { amountMinor: sub.priceAmountMinor, currency: sub.currency }, interval: sub.interval, externalReference: sub.id,
        description: `FM Command - ${planName}`, firstDueDate: this.clock().toISOString().slice(0, 10),
      });
      // Grava a referencia e reaplica, na mesma transacao, os avisos que o provedor mandou antes de ela existir.
      return await this.repo.markPending(sub.id, provider.id, created.subscriptionRef, created.checkoutUrl);
    } catch (e) {
      if (e instanceof PaymentProviderError) {
        // Recusa definitiva: encerra. Incerta/transitoria: continua "creating"; repetir com a mesma chave recupera.
        if (e.kind === "rejected") { await this.repo.markFailed(sub.id); throw new SubscriptionError("subscription.provider_rejected", 422); }
        throw new SubscriptionError("subscription.provider_unavailable", 503);
      }
      // Falta de chave/segredo do provedor e problema de configuracao temporario: a criacao continua retomavel.
      if (e instanceof Error && e.name === "GatewaySecretError") throw new SubscriptionError("subscription.provider_unavailable", 503);
      throw e;
    }
  }

  async cancel(ctx: TenantContext): Promise<PublicSubscription> {
    requirePermission(ctx, "billing:write");
    const s = await this.repo.current(ctx.tenantId);
    if (!s || s.state === "cancelled" || s.state === "failed") throw new SubscriptionError("subscription.nothing_to_cancel", 409);
    if (s.state === "creating" || !s.providerSubscriptionRef) throw new SubscriptionError("subscription.not_ready", 409);
    const provider = this.providers.get(s.providerId);
    if (!provider) throw new SubscriptionError("subscription.no_payment_method", 409);
    try { await provider.cancelSubscription(s.providerSubscriptionRef); }
    catch (e) {
      if (e instanceof PaymentProviderError && e.kind === "rejected") throw new SubscriptionError("subscription.provider_rejected", 422);
      if (e instanceof PaymentProviderError) throw new SubscriptionError("subscription.provider_unavailable", 503);
      throw e;
    }
    const done = await this.repo.markCancelled(ctx.tenantId, s.id);
    return this.view(done ?? (await this.repo.current(ctx.tenantId))!);
  }

  /** Webhook do provedor: autentica, normaliza e aplica uma unica vez. Eventos que nao sao nossos viram "ignored". */
  async handleWebhook(providerId: string, headers: Headers, rawBody: string): Promise<"applied" | "duplicate" | "unmatched" | "ignored"> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new SubscriptionError("subscription.no_payment_method", 404);
    let event;
    try { event = provider.verifyWebhook(headers, rawBody); }
    catch (e) { if (e instanceof WebhookRejectedError) throw new SubscriptionError(e.code, 401); throw e; }
    if (!event) return "ignored";
    const r = await this.repo.applyEvent(providerId, event);
    return r.kind === "applied" ? "applied" : r.kind;
  }
}
