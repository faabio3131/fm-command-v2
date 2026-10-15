import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

const IRON_REF = /^fmcc-iron-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const EVENT_ID = /^evt_[a-zA-Z0-9_&-]{3,240}$/;
const PAYMENT_ID = /^pay_[a-zA-Z0-9_-]{1,128}$/;
const WEBHOOK_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_REFUNDED"]);

/** Separate Asaas webhook authToken; NEVER use the Asaas REST API key here. */
export function verifyIronAsaasWebhookToken(provided: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || expected.length > 255 || /\s/.test(expected) ||
      !provided || provided.length > 255) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export type IronAsaasWebhookEvent = {
  eventId: string; eventType: "PAYMENT_RECEIVED" | "PAYMENT_REFUNDED";
  paymentId: string; externalReference: string; invoiceId: string; fingerprint: string;
};

/** The webhook is a notification, NOT evidence of a settled payment. */
export function parseIronAsaasWebhook(raw: unknown): IronAsaasWebhookEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("billing.iron_webhook_invalid");
  const item = raw as Record<string, unknown>;
  if (typeof item.event !== "string" || !WEBHOOK_EVENTS.has(item.event)) return null;
  if (typeof item.id !== "string" || !EVENT_ID.test(item.id) ||
      !item.payment || typeof item.payment !== "object" || Array.isArray(item.payment)) {
    throw new Error("billing.iron_webhook_invalid");
  }
  const payment = item.payment as Record<string, unknown>;
  if (typeof payment.externalReference !== "string" ||
      !payment.externalReference.startsWith("fmcc-iron-")) return null;
  const matched = IRON_REF.exec(payment.externalReference);
  if (!matched || typeof payment.id !== "string" || !PAYMENT_ID.test(payment.id)) {
    throw new Error("billing.iron_webhook_binding_invalid");
  }
  const eventType = item.event as IronAsaasWebhookEvent["eventType"];
  const fingerprint = createHash("sha256").update(JSON.stringify({
    id:item.id, event:eventType, paymentId:payment.id, externalReference:payment.externalReference,
  })).digest("hex");
  return {
    eventId:item.id,eventType,paymentId:payment.id,
    externalReference:payment.externalReference,invoiceId:matched[1],fingerprint,
  };
}

export class IronAsaasWebhookInbox {
  constructor(private readonly database: Pick<Pool, "query">) {}

  async persist(controlTenantId: string, event: IronAsaasWebhookEvent):
    Promise<"received" | "duplicate" | "unbound"> {
    if (!controlTenantId) throw new Error("billing.iron_webhook_scope_missing");
    // Authority comes from the Command invoice and its immutable gateway, not
    // any webhook-provided tenant, gym, customer, amount or status.
    const gateway = await this.database.query<{id:string; tenant_id:string}>(`
      SELECT g.id, g.tenant_id FROM fmcc_billing_invoice i
      JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id
        AND product.id=i.product_id
      JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id
        AND g.id=i.gateway_account_id
      WHERE i.tenant_id=$1 AND i.id=$2
        AND product.slug='iron' AND product.status='active'
        AND g.provider='asaas' AND g.environment='production'
        AND g.secret_ref='env://FMCC_ASAAS_PRODUCTION_API_KEY'
    `, [controlTenantId,event.invoiceId]);
    if (gateway.rowCount !== 1) return "unbound";
    const target = gateway.rows[0];
    const inserted = await this.database.query<{id:string}>(`
      INSERT INTO fmcc_billing_gateway_event
        (tenant_id,gateway_account_id,external_event_id,status,event_type,
         external_payment_id,external_reference,payload_fingerprint)
      VALUES ($1,$2,$3,'received',$4,$5,$6,$7)
      ON CONFLICT (tenant_id,gateway_account_id,external_event_id) DO NOTHING
      RETURNING id
    `,[target.tenant_id,target.id,event.eventId,event.eventType,
      event.paymentId,event.externalReference,event.fingerprint]);
    if (inserted.rowCount === 1) return "received";
    const previous = await this.database.query<{
      event_type:string|null;external_payment_id:string|null;
      external_reference:string|null;payload_fingerprint:string|null;
    }>(`
      SELECT event_type,external_payment_id,external_reference,payload_fingerprint
      FROM fmcc_billing_gateway_event
      WHERE tenant_id=$1 AND gateway_account_id=$2 AND external_event_id=$3
    `,[target.tenant_id,target.id,event.eventId]);
    if (previous.rowCount !== 1 ||
        previous.rows[0].event_type !== event.eventType ||
        previous.rows[0].external_payment_id !== event.paymentId ||
        previous.rows[0].external_reference !== event.externalReference ||
        previous.rows[0].payload_fingerprint !== event.fingerprint) {
      throw new Error("billing.iron_webhook_duplicate_conflict");
    }
    return "duplicate";
  }
}
