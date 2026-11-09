import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedBody } from "@/infrastructure/http/read-limited-body";
import { IronCommerceProvisioning, verifyIronCommerceBearer } from "@/application/billing/iron-commerce-provisioning";

export const dynamic = "force-dynamic";

/** Public-to-tenant offer catalog goes through an authenticated IRON backend proxy. */
export async function GET(request: Request) {
  if (!verifyIronCommerceBearer(request.headers.get("authorization"), process.env.FMCC_IRON_COMMERCE_S2S_TOKEN))
    return NextResponse.json({ error: "iron.commerce_unauthorized" }, { status: 401 });
  try {
    const plans = await new IronCommerceProvisioning().offers();
    return NextResponse.json({ plans }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "iron.commerce_offers_unavailable" }, { status: 503 });
  }
}

/** IRON backend only: gym owner has already passed session, OWNER, tenant and step-up gates. */
export async function POST(request: Request) {
  if (!verifyIronCommerceBearer(request.headers.get("authorization"), process.env.FMCC_IRON_COMMERCE_S2S_TOKEN))
    return NextResponse.json({ error: "iron.commerce_unauthorized" }, { status: 401 });
  let input: unknown;
  try { input = JSON.parse(await readLimitedBody(request, 4096)); }
  catch (error) {
    if (error instanceof BodyTooLargeError)
      return NextResponse.json({ error: "iron.commerce_payload_too_large" }, { status: 413 });
    return NextResponse.json({ error: "iron.commerce_input_invalid" }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return NextResponse.json({ error: "iron.commerce_input_invalid" }, { status: 400 });
  const body = input as Record<string, unknown>;
  if (typeof body.gymId !== "string" || typeof body.expectedSubscriptionId !== "string" ||
      typeof body.planCode !== "string" || typeof body.idempotencyKey !== "string")
    return NextResponse.json({ error: "iron.commerce_input_invalid" }, { status: 400 });
  try {
    const result = await new IronCommerceProvisioning().prepare({
      gymId: body.gymId, expectedSubscriptionId: body.expectedSubscriptionId,
      planCode: body.planCode, idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    // Provider/internal details, tenant existence and account secrets stay private.
    return NextResponse.json({ error: "iron.commerce_checkout_unavailable" }, { status: 409 });
  }
}
