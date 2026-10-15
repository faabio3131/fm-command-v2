import type { TenantContext } from "@/domain/security/tenant-context";
import { ironAsaasInvoiceReference, type VerifiedAsaasPayment } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";
import type { AsaasIronPaymentReadOnlyClient } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";
import type { PostgresIronAsaasAtomicReconciliation } from "@/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation";
import type { ClaimedIronWebhook, PostgresIronAsaasWebhookQueue } from "@/infrastructure/billing/postgres-iron-asaas-webhook-queue";

type Queue = Pick<PostgresIronAsaasWebhookQueue,"claimOne"|"acknowledge"|"fail">;
type Ledger = Pick<PostgresIronAsaasAtomicReconciliation,"binding"|"commitVerified">;
type Verifier = Pick<AsaasIronPaymentReadOnlyClient,"verify">;

export class VerifiedIronAsaasWebhookProcessor {
  constructor(
    private readonly queue:Queue,
    private readonly ledger:Ledger,
    private readonly provider:Verifier,
  ) {}

  /** Verifies Asaas current status via GET; webhook payload never grants rights. */
  async processOne(controlTenantId:string) {
    const item=await this.queue.claimOne(controlTenantId);
    if(!item)return {status:"empty" as const};
    try {
      const binding=await this.ledger.binding(item.tenantId,item.productId,item.invoiceId);
      if(!binding) throw new Error("WEBHOOK_BINDING_NOT_READY");
      if(binding.paymentId!==item.paymentId ||
         binding.tenantId!==controlTenantId ||
         item.reference!==ironAsaasInvoiceReference(item.invoiceId)) {
        throw new Error("WEBHOOK_PAYMENT_SCOPE_CONFLICT");
      }
      const payment:VerifiedAsaasPayment=await this.provider.verify({
        paymentId:binding.paymentId,invoiceId:binding.invoiceId,
        customerId:binding.customerId,amountMinor:binding.amountMinor,
      });
      // A late/replayed notification cannot change the canonical provider state.
      // Refunded invoices must never be reactivated by an old RECEIVED event.
      if ((item.eventType==="PAYMENT_RECEIVED" && payment.status!=="RECEIVED") ||
          (item.eventType==="PAYMENT_REFUNDED" && payment.status!=="REFUNDED")) {
        throw new Error("WEBHOOK_EVENT_PROVIDER_STATE_CONFLICT");
      }
      const context:TenantContext={
        tenantId:item.tenantId,userId:"fmcc:iron-asaas-webhook-worker",
        role:"admin",correlationId:"iron-webhook:"+item.id,
      };
      const outcome=await this.ledger.commitVerified(context,binding,payment);
      if(!await this.queue.acknowledge(item)) {
        return {status:"lease_lost" as const,eventId:item.eventId};
      }
      return {status:"reconciled" as const,eventId:item.eventId,
        eventType:outcome.eventType,createdOutboxEvent:outcome.inserted};
    } catch(error) {
      const msg=error instanceof Error?error.message:"";
      const permanent=msg==="WEBHOOK_PAYMENT_SCOPE_CONFLICT" ||
        msg==="WEBHOOK_EVENT_PROVIDER_STATE_CONFLICT" ||
        msg==="billing.iron_asaas_payment_mismatch" ||
        msg==="billing.iron_asaas_scope_mismatch" ||
        msg==="billing.iron_asaas_paid_after_reversal_denied" ||
        msg==="billing.iron_asaas_refund_state_requires_review";
      const code=permanent?"WEBHOOK_AUTHORITY_REVIEW":
        msg==="WEBHOOK_BINDING_NOT_READY"?"WEBHOOK_BINDING_RETRY":
        "WEBHOOK_PROVIDER_OR_DB_RETRY";
      const released=await this.queue.fail(item,code,permanent);
      return {status:!released?"lease_lost" as const:
        permanent?"blocked" as const:"retry" as const,eventId:item.eventId,errorCode:code};
    }
  }
}
