import { AsaasCheckoutClient } from "./asaas-checkout-client";
import { AsaasIronIssuerClient } from "./asaas-iron-issuer-client";
import { PostgresIronAsaasIssuer, type IronIssueClaim } from "./postgres-iron-asaas-issuer";

export class GovernedIronAsaasIssuance {
  constructor(
    private readonly repo: Pick<PostgresIronAsaasIssuer, "gymBinding"|"reserve"|"claimForRecovery"|"persistPayment"|"markUncertain">,
    private readonly provider: Pick<AsaasIronIssuerClient, "findUnique"|"createOnce">,
    private readonly customers: Pick<AsaasCheckoutClient, "customerById" | "findCustomers">,
  ) {}

  private async recoverByRead(claim: IronIssueClaim) {
    if (claim.status === "issued") {
      // Read-only refresh of the Asaas-hosted invoice link. A known issuance
      // must never cause another provider POST even if the GET is unavailable.
      try {
        const payment = await this.provider.findUnique({
          invoiceId: claim.invoiceId, customerId: claim.customerId, amountMinor: claim.amountMinor,
        });
        if (payment?.id === claim.paymentId) {
          return {
            status: "issued" as const, paymentId: payment.id, recovered: false,
            ...(payment.invoiceUrl ? { invoiceUrl: payment.invoiceUrl } : {}),
          };
        }
      } catch { /* existing persisted issuance remains authoritative */ }
      return { status: "issued" as const, paymentId: claim.paymentId, recovered: false };
    }
    // Never retry POST for a reservation, even if it was originally aborted
    // before reaching the provider. There may be an eventual-consistency lag.
    try {
      const payment = await this.provider.findUnique({
        invoiceId:claim.invoiceId,customerId:claim.customerId,amountMinor:claim.amountMinor,
      });
      if (!payment) {
        await this.repo.markUncertain(claim,"RECOVERY_NO_MATCH");
        return { status: "manual_review_required" as const };
      }
      await this.repo.persistPayment(claim,payment);
      return { status:"issued" as const,paymentId:payment.id,recovered:true,
        ...(payment.invoiceUrl ? {invoiceUrl:payment.invoiceUrl} : {}) };
    } catch {
      await this.repo.markUncertain(claim,"RECOVERY_UNVERIFIED");
      return { status: "manual_review_required" as const };
    }
  }

  async issue(input: {
    tenantId:string;productId:string;invoiceId:string;customerId?:string;dueDate:string;
  }) {
    if (input.customerId !== undefined &&
        !/^cus_[A-Za-z0-9_-]{1,128}$/.test(input.customerId)) {
      throw new Error("billing.iron_issuer_customer_id_invalid");
    }
    // Fail before reserving. A malformed date must never poison a legitimate
    // invoice with a permanent one-shot claim.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const max = new Date(now.getTime()+60*24*60*60*1000).toISOString().slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
        input.dueDate < today || input.dueDate > max) {
      throw new Error("billing.iron_issuer_due_date_invalid");
    }
    const gym = await this.repo.gymBinding(input.tenantId,input.productId,input.invoiceId);
    if (!gym) throw new Error("billing.iron_issuer_gym_binding_missing");
    // Resolve by the persisted gym binding, never by user-controlled document,
    // email or tenant. The provider query is GET-only; customer creation has
    // its own separate operational gate.
    const reference = "fmcc-iron-customer-" + gym;
    let customerId = input.customerId;
    if (customerId === undefined) {
      const matches = await this.customers.findCustomers(reference);
      if (matches.length !== 1) {
        throw new Error(matches.length === 0
          ? "billing.iron_issuer_customer_enrollment_required"
          : "billing.iron_issuer_customer_ambiguous");
      }
      customerId = matches[0].id;
    }
    if (!/^cus_[A-Za-z0-9_-]{1,128}$/.test(customerId)) {
      throw new Error("billing.iron_issuer_customer_id_invalid");
    }
    const customer = await this.customers.customerById(customerId);
    if (!customer || customer.id !== customerId || customer.externalReference !== reference) {
      throw new Error("billing.iron_issuer_customer_gym_mismatch");
    }

    const claim = await this.repo.reserve({ ...input, customerId });
    if (!claim.created) return this.recoverByRead(claim);

    // The durable claim is committed BEFORE the first provider preflight/POST.
    let existing;
    try {
      existing = await this.provider.findUnique({
        invoiceId:claim.invoiceId,customerId:claim.customerId,amountMinor:claim.amountMinor,
      });
    } catch {
      await this.repo.markUncertain(claim,"PRECHECK_UNCERTAIN");
      return {status:"manual_review_required" as const};
    }
    if (existing) {
      try {await this.repo.persistPayment(claim,existing);}
      catch {await this.repo.markUncertain(claim,"PERSISTENCE_UNCERTAIN");return {status:"manual_review_required" as const};}
      return {status:"issued" as const,paymentId:existing.id,recovered:true,
        ...(existing.invoiceUrl ? {invoiceUrl:existing.invoiceUrl} : {})};
    }

    try {
      const payment=await this.provider.createOnce({
        invoiceId:claim.invoiceId,customerId:claim.customerId,
        amountMinor:claim.amountMinor,dueDate:input.dueDate,
      });
      await this.repo.persistPayment(claim,payment);
      return {status:"issued" as const,paymentId:payment.id,recovered:false,
        ...(payment.invoiceUrl ? {invoiceUrl:payment.invoiceUrl} : {})};
    } catch {
      await this.repo.markUncertain(claim,"POST_OR_PERSISTENCE_UNCERTAIN");
      return {status:"manual_review_required" as const};
    }
  }

  async recover(input:{tenantId:string;productId:string;invoiceId:string}) {
    const claim=await this.repo.claimForRecovery(input.tenantId,input.productId,input.invoiceId);
    if (!claim) throw new Error("billing.iron_issuer_claim_missing");
    return this.recoverByRead(claim);
  }
}
