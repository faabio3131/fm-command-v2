import type { Pool } from "pg";
import { ASAAS_PRODUCTION_SECRET_REF } from "./secret-resolver";

const GYM=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IronPayerClaim {
  readonly tenantId:string;readonly productId:string;readonly customerId:string;
  readonly gymId:string;readonly gatewayAccountId:string;readonly reference:string;
  readonly created:boolean;readonly status:string;readonly providerCustomerId:string|null;
}

/** FM Command binding, one-shot provider reservation and atomic payer-ID registration. */
export class PostgresIronPayerEnrollment {
  constructor(private readonly pool:Pick<Pool,"connect">){}

  async reserve(tenantId:string,productId:string,gymId:string):Promise<IronPayerClaim>{
    if(!tenantId||tenantId.length>128||!GYM.test(productId)||!GYM.test(gymId)){
      throw new Error("billing.iron_payer_scope_invalid");
    }
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const binding=await client.query<{
        customer_id:string; gateway_account_id:string; external_customer_id:string;
      }>(`
        SELECT b.customer_id,r.gateway_account_id,c.external_customer_id
        FROM fmcc_billing_customer_binding b
        JOIN fmcc_billing_customer c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id
        JOIN fmcc_product_definition p ON p.tenant_id=b.tenant_id AND p.id=b.product_id
        JOIN fmcc_billing_product_route r ON r.tenant_id=b.tenant_id AND r.product_id=b.product_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=b.tenant_id AND g.id=r.gateway_account_id
        JOIN fmcc_source_definition src ON src.tenant_id=b.tenant_id
          AND src.product_id=b.product_id AND src.name='IRON FIT CORE Commercial'
          AND src.source_type='iron-commercial-v1' AND src.authoritative_domain='commercial'
          AND src.secret_ref='env:FMCC_IRON_CONTROL_PLANE_TOKEN'
        WHERE b.tenant_id=$1 AND b.product_id=$2 AND b.external_tenant_id=$3
          AND p.slug='iron' AND p.status='active'
          AND g.provider='asaas' AND g.environment='production'
          AND g.secret_ref=$4 AND g.status='enabled' AND r.status='enabled'
        FOR UPDATE OF c
      `,[tenantId,productId,gymId,ASAAS_PRODUCTION_SECRET_REF]);
      if(binding.rowCount!==1)throw new Error("billing.iron_payer_canonical_binding_missing");
      const canonical=binding.rows[0];
      const reference="fmcc-iron-customer-"+gymId.toLowerCase();
      const inserted=await client.query<{id:string}>(`
        INSERT INTO fmcc_billing_iron_customer_enrollment
          (tenant_id,product_id,customer_id,external_tenant_id,gateway_account_id,external_reference,status,external_customer_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (tenant_id,product_id,external_tenant_id) DO NOTHING
        RETURNING id
      `,[tenantId,productId,canonical.customer_id,gymId,canonical.gateway_account_id,reference,
        canonical.external_customer_id.startsWith("pending:")?"reserved":"uncertain",
        canonical.external_customer_id.startsWith("pending:")?null:canonical.external_customer_id]);
      const found=await client.query<{
        customer_id:string;gateway_account_id:string;external_reference:string;
        status:string;external_customer_id:string|null;
      }>(`
        SELECT customer_id,gateway_account_id,external_reference,status,external_customer_id
        FROM fmcc_billing_iron_customer_enrollment
        WHERE tenant_id=$1 AND product_id=$2 AND external_tenant_id=$3
        FOR UPDATE
      `,[tenantId,productId,gymId]);
      if(found.rowCount!==1)throw new Error("billing.iron_payer_reservation_missing");
      const item=found.rows[0];
      if(item.customer_id!==canonical.customer_id ||
        item.gateway_account_id!==canonical.gateway_account_id ||
        item.external_reference!==reference ||
        (item.status==="enrolled" && item.external_customer_id!==canonical.external_customer_id) ||
        (!canonical.external_customer_id.startsWith("pending:") &&
         canonical.external_customer_id!==item.external_customer_id)){
        throw new Error("billing.iron_payer_canonical_binding_changed");
      }
      await client.query("COMMIT");
      return {tenantId,productId,customerId:canonical.customer_id,gymId,
        gatewayAccountId:canonical.gateway_account_id,reference,
        status:item.status,providerCustomerId:item.external_customer_id,created:inserted.rowCount===1};
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async confirm(claim:IronPayerClaim,providerCustomerId:string):Promise<boolean>{
    if(!/^cus_[A-Za-z0-9_-]{1,128}$/.test(providerCustomerId))throw new Error("billing.iron_payer_provider_id_invalid");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const locked=await client.query<{status:string;external_customer_id:string|null;stored_customer_id:string}>(`
        SELECT e.status,e.external_customer_id,c.external_customer_id AS stored_customer_id
        FROM fmcc_billing_iron_customer_enrollment e
        JOIN fmcc_billing_customer c ON c.tenant_id=e.tenant_id AND c.id=e.customer_id
        WHERE e.tenant_id=$1 AND e.product_id=$2 AND e.external_tenant_id=$3
          AND e.customer_id=$4 AND e.gateway_account_id=$5 AND e.external_reference=$6
        FOR UPDATE OF e,c
      `,[claim.tenantId,claim.productId,claim.gymId,claim.customerId,
        claim.gatewayAccountId,claim.reference]);
      if(locked.rowCount!==1)throw new Error("billing.iron_payer_claim_changed");
      const row=locked.rows[0];
      if(row.status==="blocked" ||
         (row.status==="enrolled" && row.external_customer_id!==providerCustomerId) ||
         (!row.stored_customer_id.startsWith("pending:") &&
          row.stored_customer_id!==providerCustomerId)){
        throw new Error("billing.iron_payer_identity_conflict");
      }
      await client.query(`
        UPDATE fmcc_billing_customer SET external_customer_id=$1
        WHERE tenant_id=$2 AND id=$3
      `,[providerCustomerId,claim.tenantId,claim.customerId]);
      await client.query(`
        UPDATE fmcc_billing_iron_customer_enrollment SET
          status='enrolled',external_customer_id=$1,last_error_code=NULL,updated_at=now()
        WHERE tenant_id=$2 AND product_id=$3 AND external_tenant_id=$4
      `,[providerCustomerId,claim.tenantId,claim.productId,claim.gymId]);
      await client.query(`
        INSERT INTO fmcc_billing_audit_event
          (tenant_id,actor_id,action,subject_id,correlation_id)
        VALUES ($1,'fmcc:iron-payer-enrollment','iron.asaas.payer_confirmed',$2,$3)
      `,[claim.tenantId,claim.customerId,"iron-payer:"+claim.gymId]);
      await client.query("COMMIT");return true;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async markUncertain(claim:IronPayerClaim,code:string):Promise<void>{
    if(!/^[A-Z0-9_]{3,64}$/.test(code))throw new Error("billing.iron_payer_error_code_invalid");
    const client=await this.pool.connect();
    try{
      await client.query(`
        UPDATE fmcc_billing_iron_customer_enrollment SET
          status='uncertain',last_error_code=$1,updated_at=now()
        WHERE tenant_id=$2 AND product_id=$3 AND external_tenant_id=$4
          AND customer_id=$5 AND gateway_account_id=$6
          AND status IN ('reserved','uncertain')
      `,[code,claim.tenantId,claim.productId,claim.gymId,
        claim.customerId,claim.gatewayAccountId]);
    }finally{client.release();}
  }
}
