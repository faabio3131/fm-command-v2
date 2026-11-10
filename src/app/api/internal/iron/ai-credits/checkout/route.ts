import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { IronAiCreditBilling } from "@/application/billing/iron-ai-credit-billing";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.FMCC_IRON_CREDITS_CHECKOUT_TOKEN?.trim() ?? "";
  const supplied = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (expected.length < 32 || !supplied) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

/** Only the IRON backend's authenticated tenant-owner flow may request a checkout.
 * Never trust a browser-supplied amount, provider ID, or a raw Cakto redirect as proof.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "iron.credits_unauthorized" }, { status: 401 });
  let input: Record<string, unknown>;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4096)
      return NextResponse.json({ error: "iron.credits_body_too_large" }, { status: 413 });
    input = await request.json() as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "iron.credits_input_invalid" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return NextResponse.json({ error: "iron.credits_input_invalid" }, { status: 400 });
  try {
    const result = await new IronAiCreditBilling().prepareCheckout(
      String(input.gymId ?? ""), String(input.packageCode ?? ""),
      request.headers.get("idempotency-key") ?? "",
    );
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "iron.credits_checkout_unavailable" }, { status: 409 });
  }
}
