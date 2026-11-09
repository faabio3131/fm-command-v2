import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedBody } from "@/infrastructure/http/read-limited-body";
import { WebhookRejectedError } from "@/domain/subscription/payment-provider";
import { IronAiCreditBilling } from "@/application/billing/iron-ai-credit-billing";

export const dynamic = "force-dynamic";
/** Dedicated signed provider boundary for one-time packs; recurring invoices remain untouched. */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await readLimitedBody(request, 65_536); }
  catch (error) {
    return NextResponse.json(
      { error: error instanceof BodyTooLargeError ? "webhook.too_large" : "webhook.body_invalid" },
      { status: error instanceof BodyTooLargeError ? 413 : 400 },
    );
  }
  try {
    const result = await new IronAiCreditBilling().handleWebhook(request.headers, raw);
    return NextResponse.json({ accepted: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof WebhookRejectedError)
      return NextResponse.json({ error: error.code }, { status: 401 });
    return NextResponse.json({ error: "webhook.persistence_unavailable" }, { status: 503 });
  }
}
