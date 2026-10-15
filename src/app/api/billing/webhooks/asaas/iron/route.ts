import { NextResponse } from "next/server";
import { environmentIronControlTenantId } from "@/infrastructure/integration/iron-commercial-connector";
import { pool } from "@/infrastructure/db/client";
import { IronAsaasWebhookInbox, parseIronAsaasWebhook, verifyIronAsaasWebhookToken } from "@/infrastructure/billing/iron-asaas-webhook-inbox";

export const dynamic = "force-dynamic";

/** Public provider boundary: durable notification inbox only; NEVER grants a license. */
export async function POST(request: Request) {
  if (process.env.FMCC_IRON_ASAAS_WEBHOOK_INBOX_ENABLED !== "YES") {
    return NextResponse.json({error:"billing.iron_webhook_disabled"},{status:503});
  }
  if (!verifyIronAsaasWebhookToken(request.headers.get("asaas-access-token"),
      process.env.FMCC_IRON_ASAAS_WEBHOOK_AUTH_TOKEN)) {
    return NextResponse.json({error:"billing.iron_webhook_unauthorized"},{status:401});
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 16384) {
    return NextResponse.json({error:"billing.iron_webhook_too_large"},{status:413});
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({error:"billing.iron_webhook_media_type"},{status:415});
  }
  let event;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw,"utf8") > 16384) {
      return NextResponse.json({error:"billing.iron_webhook_too_large"},{status:413});
    }
    event = parseIronAsaasWebhook(JSON.parse(raw) as unknown);
  } catch {
    return NextResponse.json({error:"billing.iron_webhook_invalid"},{status:400});
  }
  if (!event) return NextResponse.json({accepted:true,status:"ignored"});
  const controlTenantId = environmentIronControlTenantId();
  if (!controlTenantId) return NextResponse.json({error:"billing.iron_webhook_unavailable"},{status:503});
  try {
    const status = await new IronAsaasWebhookInbox(pool).persist(controlTenantId,event);
    if (status === "unbound") {
      // Do not acknowledge a relevant IRON notification before durable
      // canonical binding; Asaas should retry after a temporary race.
      return NextResponse.json({error:"billing.iron_webhook_binding_not_ready"},{status:503});
    }
    // Acknowledgement means only that the notification was stored or safely
    // ignored. A separate authenticated Asaas GET must certify financial state.
    return NextResponse.json({accepted:true,status},{headers:{"Cache-Control":"no-store"}});
  } catch {
    // Retryable: never acknowledge an event that failed durable persistence.
    return NextResponse.json({error:"billing.iron_webhook_persistence_unavailable"},{status:503});
  }
}
