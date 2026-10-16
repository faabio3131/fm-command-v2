import { NextResponse } from "next/server";
import { verifyScheduledWorkerBearer } from "@/application/security/verify-scheduled-worker-bearer";
import { GovernedIronOutboxDispatcher } from "@/application/billing/governed-iron-outbox-dispatcher";
import type { TenantContext } from "@/domain/security/tenant-context";
import { PostgresIronEntitlementOutbox } from "@/infrastructure/billing/postgres-iron-entitlement-outbox";
import { pool } from "@/infrastructure/db/client";
import {
  environmentIronControlTenantId,IronCommercialConnector,
  IRON_COMMERCIAL_SECRET_REF,IRON_COMMERCIAL_SOURCE_TYPE,
} from "@/infrastructure/integration/iron-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

export const dynamic="force-dynamic";

/** Machine-only delivery of one already authorized canonical outbox item.
 * This never decides whether an invoice was paid and never calls the gateway.
 */
export async function POST(request:Request){
  if(process.env.FMCC_IRON_OUTBOX_AUTOMATIC_DELIVERY_ENABLED!=="YES" ||
     process.env.FMCC_IRON_OUTBOX_DELIVERY_ENABLED!=="YES" ||
     process.env.FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED!=="YES"){
    return NextResponse.json({error:"billing.iron_outbox_worker_disabled"},{status:503});
  }
  const workerSecret=process.env.FMCC_IRON_OUTBOX_WORKER_SECRET;
  if(workerSecret && [
    process.env.FMCC_IRON_ASAAS_WEBHOOK_WORKER_SECRET,
    process.env.FMCC_IRON_ASAAS_WEBHOOK_AUTH_TOKEN,
    process.env.FMCC_ASAAS_PRODUCTION_API_KEY,
    process.env.FMCC_IRON_CONTROL_PLANE_TOKEN,
  ].some(other=>Boolean(other) && other===workerSecret)){
    return NextResponse.json({error:"billing.iron_outbox_worker_secret_not_segregated"},{status:503});
  }
  if(!verifyScheduledWorkerBearer(request.headers.get("authorization"),workerSecret)){
    return NextResponse.json({error:"billing.iron_outbox_worker_unauthorized"},{status:401});
  }
  const tenantId=environmentIronControlTenantId();
  if(!tenantId)return NextResponse.json({error:"billing.iron_outbox_worker_scope_missing"},{status:503});
  try{
    // No tenant or product selection is accepted from the request; only FM's
    // canonical registered IRON commercial source can address the outbox.
    const sources=(await new PostgresSourceRepository().list(tenantId)).filter(source=>
      source.productId && source.tenantId===tenantId &&
      source.name==="IRON FIT CORE Commercial" &&
      source.sourceType===IRON_COMMERCIAL_SOURCE_TYPE &&
      source.secretRef===IRON_COMMERCIAL_SECRET_REF &&
      source.authoritativeDomain==="commercial",
    );
    if(sources.length!==1||!sources[0].productId){
      return NextResponse.json({error:"billing.iron_outbox_worker_source_unavailable"},{status:409});
    }
    // A dedicated, separately authenticated system identity; this is NOT a
    // human admin login or a user-supplied tenant/role.
    const context:TenantContext={
      tenantId,userId:"fmcc:iron-outbox-scheduler",role:"admin",
      correlationId:"fmcc:iron-outbox-scheduled",
    };
    const result=await new GovernedIronOutboxDispatcher(
      new PostgresIronEntitlementOutbox(pool),new IronCommercialConnector(),
    ).processOne(context,sources[0],sources[0].productId);
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch{
    return NextResponse.json({error:"billing.iron_outbox_worker_unavailable"},{status:503});
  }
}
