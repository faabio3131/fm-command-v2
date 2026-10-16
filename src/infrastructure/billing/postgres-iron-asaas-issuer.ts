import type { Pool } from "pg";
import { resolveIronPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";
import { ASAAS_PRODUCTION_SECRET_REF } from "./secret-resolver";
import { ironAsaasInvoiceReference } from "./asaas-iron-payment-readonly-client";
import type { IssuedIronPayment } from "./asaas-iron-issuer-client";

export interface IronIssueClaim {
  readonly tenantId: string; readonly productId: string; readonly invoiceId: string;
  readonly gatewayAccountId: string; readonly customerId: string;
  readonly externalTenantId: string; readonly amountMinor: number;
  readonly reference: string; readonly created: boolean; readonly status: string;
  readonly paymentId: string | null;
}

export class PostgresIronAsaasIssuer {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async gymBinding(tenantId: string, productId: string, invoiceId: string): Promise<string | null> {
    const client=await this.pool.connect();
    try {
      const result=await client.query<{external_tenant_id:string}>(`
        SELECT b.external_tenant_id FROM fmcc_billing_invoice i
        JOIN fmcc_billing_customer_binding b ON b.tenant_id=i.tenant_id
          AND b.product_id=i.product_id AND b.customer_id=i.customer_id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id AND product.id=i.product_id
        WHERE i.tenant_id=$1 AND i.product_id=$2 AND i.id=$3
          AND product.slug='iron' AND product.status='active'
      `,[tenantId,productId,invoiceId]);
      return result.rowCount===1 ? result.rows[0].external_tenant_id : null;
    } finally {client.release();}
  }

  async reserve(input: {
    tenantId: string; productId: string; invoiceId: string; customerId: string;
  }): Promise<IronIssueClaim> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const query = await client.query<{
        customer_id: string; external_customer_id: string; external_tenant_id: string;
        gateway_account_id: string; amount_minor: string; plan_code: string;
        invoice_status: string; subscription_status: string;
        provider: string; environment: string; gateway_status: string; route_status: string;
        secret_ref: string; created_at: Date; provider_payment_id: string | null;
      }>(`
        SELECT i.customer_id,c.external_customer_id,b.external_tenant_id,
          i.gateway_account_id,i.amount_minor::text,s.plan_code,i.status AS invoice_status,
          s.status AS subscription_status,g.provider,g.environment,g.status AS gateway_status,
          r.status AS route_status,g.secret_ref,i.created_at,
          p.id AS provider_payment_id
        FROM fmcc_billing_invoice i
        JOIN fmcc_billing_customer c ON c.tenant_id=i.tenant_id AND c.id=i.customer_id
        JOIN fmcc_billing_customer_binding b ON b.tenant_id=i.tenant_id AND b.product_id=i.product_id
          AND b.customer_id=i.customer_id
        JOIN fmcc_billing_subscription s ON s.tenant_id=i.tenant_id AND s.id=i.subscription_id
          AND s.product_id=i.product_id AND s.customer_id=i.customer_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
        JOIN fmcc_billing_product_route r ON r.tenant_id=i.tenant_id
          AND r.product_id=i.product_id AND r.gateway_account_id=i.gateway_account_id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id AND product.id=i.product_id
        LEFT JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id
          AND p.invoice_id=i.id
        WHERE i.tenant_id=$1 AND i.product_id=$2 AND i.id=$3
          AND product.slug='iron' AND product.status='active'
        FOR UPDATE OF i,c
      `,[input.tenantId,input.productId,input.invoiceId]);
      if (query.rowCount !== 1) throw new Error("billing.iron_issuer_invoice_unavailable");
      const row = query.rows[0], amountMinor=Number(row.amount_minor);
      if (row.provider !== "asaas" || row.environment !== "production" ||
          row.gateway_status !== "enabled" || row.route_status !== "enabled" ||
          row.secret_ref !== ASAAS_PRODUCTION_SECRET_REF ||
          !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.external_tenant_id)) {
        throw new Error("billing.iron_issuer_canonical_state_denied");
      }
      const source = await client.query<{ config: Record<string,unknown> }>(`
        SELECT config FROM fmcc_source_definition
        WHERE tenant_id=$1 AND product_id=$2 AND name='IRON FIT CORE Commercial'
          AND source_type='iron-commercial-v1' AND authoritative_domain='commercial'
          AND secret_ref='env:FMCC_IRON_CONTROL_PLANE_TOKEN'
      `,[input.tenantId,input.productId]);
      if (source.rowCount !== 1) throw new Error("billing.iron_issuer_source_denied");
      const mapping = resolveIronPlanMapping(source.rows[0].config,row.plan_code);
      if (row.created_at.getTime() < new Date(mapping.effectiveFrom).getTime()) {
        throw new Error("billing.iron_issuer_mapping_not_effective");
      }
      // Enrollment is a separate FM-owned authority. Issuance cannot create
      // or overwrite an unverified provider customer binding.
      const payer = await client.query<{external_customer_id:string}>(`
        SELECT external_customer_id
        FROM fmcc_billing_iron_customer_enrollment
        WHERE tenant_id=$1 AND product_id=$2 AND customer_id=$3
          AND external_tenant_id=$4 AND gateway_account_id=$5
          AND status='enrolled' AND external_customer_id=$6
        FOR UPDATE
      `,[input.tenantId,input.productId,row.customer_id,row.external_tenant_id,
        row.gateway_account_id,input.customerId]);
      if (payer.rowCount!==1 || row.external_customer_id!==input.customerId) {
        throw new Error("billing.iron_issuer_payer_not_enrolled");
      }
      const prior = await client.query<{
        external_customer_id: string; status: string; external_payment_id: string|null;
      }>(`
        SELECT external_customer_id,status,external_payment_id FROM fmcc_billing_iron_issue_claim
        WHERE tenant_id=$1 AND invoice_id=$2 FOR UPDATE
      `,[input.tenantId,input.invoiceId]);
      if (prior.rowCount === 1) {
        if (prior.rows[0].external_customer_id !== input.customerId) {
          throw new Error("billing.iron_issuer_claim_conflict");
        }
        await client.query("COMMIT");
        return {
          ...input, gatewayAccountId: row.gateway_account_id,
          externalTenantId: row.external_tenant_id, amountMinor,
          reference: ironAsaasInvoiceReference(input.invoiceId),
          created: false, status:prior.rows[0].status,paymentId:prior.rows[0].external_payment_id,
        };
      }
      if (row.provider_payment_id || !["pending","payment_pending"].includes(row.invoice_status) ||
          row.subscription_status !== "pending") {
        throw new Error("billing.iron_issuer_invoice_already_processed");
      }
      await client.query(`
        INSERT INTO fmcc_billing_iron_issue_claim
          (tenant_id,product_id,invoice_id,gateway_account_id,external_customer_id,external_reference)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,[input.tenantId,input.productId,input.invoiceId,row.gateway_account_id,input.customerId,
        ironAsaasInvoiceReference(input.invoiceId)]);
      await client.query("COMMIT");
      return {
        ...input,gatewayAccountId:row.gateway_account_id,externalTenantId:row.external_tenant_id,
        amountMinor,reference:ironAsaasInvoiceReference(input.invoiceId),
        created:true,status:"reserved",paymentId:null,
      };
    } catch(error) {
      await client.query("ROLLBACK");throw error;
    } finally { client.release(); }
  }

  async claimForRecovery(tenantId:string, productId:string, invoiceId:string):Promise<IronIssueClaim|null> {
    const client=await this.pool.connect();
    try {
      const query=await client.query<{
        gateway_account_id:string;external_customer_id:string;external_tenant_id:string;
        amount_minor:string;external_reference:string;status:string;external_payment_id:string|null;
      }>(`
        SELECT claim.gateway_account_id,claim.external_customer_id,b.external_tenant_id,
          i.amount_minor::text,claim.external_reference,claim.status,claim.external_payment_id
        FROM fmcc_billing_iron_issue_claim claim
        JOIN fmcc_billing_invoice i ON i.tenant_id=claim.tenant_id AND i.id=claim.invoice_id
          AND i.product_id=claim.product_id AND i.gateway_account_id=claim.gateway_account_id
        JOIN fmcc_billing_customer_binding b ON b.tenant_id=i.tenant_id AND b.product_id=i.product_id
          AND b.customer_id=i.customer_id
        WHERE claim.tenant_id=$1 AND claim.product_id=$2 AND claim.invoice_id=$3
      `,[tenantId,productId,invoiceId]);
      if (query.rowCount!==1) return null;
      const row=query.rows[0], amountMinor=Number(row.amount_minor);
      if (!Number.isSafeInteger(amountMinor)||amountMinor<=0 ||
          row.external_reference!==ironAsaasInvoiceReference(invoiceId)) return null;
      return {
        tenantId,productId,invoiceId,gatewayAccountId:row.gateway_account_id,
        customerId:row.external_customer_id,externalTenantId:row.external_tenant_id,
        amountMinor,reference:row.external_reference,status:row.status,
        paymentId:row.external_payment_id,created:false,
      };
    } finally {client.release();}
  }

  async persistPayment(claim:IronIssueClaim, payment:IssuedIronPayment):Promise<"issued"|"already_issued"> {
    if (payment.customer!==claim.customerId || payment.externalReference!==claim.reference ||
        Math.abs(payment.value*100-claim.amountMinor)>0.001) {
      throw new Error("billing.iron_issuer_payment_mismatch");
    }
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row=await client.query<{status:string;external_payment_id:string|null}>(`
        SELECT status,external_payment_id FROM fmcc_billing_iron_issue_claim
        WHERE tenant_id=$1 AND product_id=$2 AND invoice_id=$3 AND external_customer_id=$4
        FOR UPDATE
      `,[claim.tenantId,claim.productId,claim.invoiceId,claim.customerId]);
      if (row.rowCount!==1||row.rows[0].status==="blocked") throw new Error("billing.iron_issuer_claim_invalid");
      if(row.rows[0].status==="issued"){
        if(row.rows[0].external_payment_id!==payment.id)throw new Error("billing.iron_issuer_payment_conflict");
        await client.query("COMMIT");return "already_issued";
      }
      await client.query(`
        INSERT INTO fmcc_billing_provider_payment
          (tenant_id,invoice_id,gateway_account_id,external_payment_id,status)
        VALUES ($1,$2,$3,$4,'pending')
        ON CONFLICT (tenant_id,invoice_id) DO NOTHING
      `,[claim.tenantId,claim.invoiceId,claim.gatewayAccountId,payment.id]);
      const stored=await client.query<{external_payment_id:string}>(`
        SELECT external_payment_id FROM fmcc_billing_provider_payment
        WHERE tenant_id=$1 AND invoice_id=$2 AND gateway_account_id=$3
      `,[claim.tenantId,claim.invoiceId,claim.gatewayAccountId]);
      if(stored.rowCount!==1||stored.rows[0].external_payment_id!==payment.id)
        throw new Error("billing.iron_issuer_provider_binding_conflict");
      await client.query(`UPDATE fmcc_billing_invoice SET status='payment_pending'
        WHERE tenant_id=$1 AND id=$2 AND product_id=$3 AND status IN ('pending','payment_pending')
      `,[claim.tenantId,claim.invoiceId,claim.productId]);
      await client.query(`UPDATE fmcc_billing_iron_issue_claim SET
        status='issued',external_payment_id=$4,last_error_code=NULL,updated_at=now()
        WHERE tenant_id=$1 AND product_id=$2 AND invoice_id=$3
      `,[claim.tenantId,claim.productId,claim.invoiceId,payment.id]);
      await client.query("COMMIT");
      return "issued";
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }

  async markUncertain(claim:IronIssueClaim,code:string):Promise<void>{
    if(!/^[A-Z0-9_]{2,65}$/.test(code))throw new Error("billing.iron_issuer_error_code_invalid");
    const client=await this.pool.connect();
    try {
      await client.query(`
        UPDATE fmcc_billing_iron_issue_claim
        SET status='uncertain',last_error_code=$4,updated_at=now()
        WHERE tenant_id=$1 AND product_id=$2 AND invoice_id=$3 AND status='reserved'
      `,[claim.tenantId,claim.productId,claim.invoiceId,code]);
    } finally {client.release();}
  }
}
