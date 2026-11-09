import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedBody } from "@/infrastructure/http/read-limited-body";
import { WebhookRejectedError } from "@/domain/subscription/payment-provider";
import { CaktoIronProductBilling } from "@/application/billing/cakto-iron-product-billing";

export const dynamic = "force-dynamic";
/** Payment authority is FM Command product ledger, never the IRON academy finance ledger. */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await readLimitedBody(request, 65_536); }
  catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "webhook.too_large" }, { status: 413 });
    return NextResponse.json({ error: "webhook.body_invalid" }, { status: 400 });
  }
  try {
    const result = await new CaktoIronProductBilling().handleWebhook(request.headers, raw);
    return NextResponse.json({ accepted: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof WebhookRejectedError) return NextResponse.json({ error: e.code }, { status: 401 });
    // Payment events are never acknowledged if canonical storage/entitlement outbox failed.
    return NextResponse.json({ error: "webhook.persistence_unavailable" }, { status: 503 });
  }
}
