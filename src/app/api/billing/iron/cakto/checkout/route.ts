import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { CaktoIronProductBilling } from "@/application/billing/cakto-iron-product-billing";

export const dynamic = "force-dynamic";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operator-assisted first-client checkout, using an already prepared canonical invoice. */
export async function POST(request: Request) {
  let body: { invoiceId?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "billing.input_invalid" }, { status: 400 }); }
  if (!body || !ID.test(String(body.invoiceId ?? "")) || typeof body.password !== "string")
    return NextResponse.json({ error: "billing.input_invalid" }, { status: 400 });
  try {
    const context = await resolveTenantContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    const proof = await verifyPasswordStepUp(request.headers, body.password);
    if (proof.userId !== context.userId)
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    const checkoutUrl = await new CaktoIronProductBilling().checkoutUrl(body.invoiceId as string);
    return NextResponse.json({ checkoutUrl }, { headers: { "cache-control": "no-store" } });
  } catch {
    // Never leak canonical invoice existence, tenant identity or payment secret.
    return NextResponse.json({ error: "billing.checkout_unavailable" }, { status: 409 });
  }
}
