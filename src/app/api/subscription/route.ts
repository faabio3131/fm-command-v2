import { NextResponse } from "next/server";
import { subscriptionService } from "@/application/subscription/subscription-runtime";
import { SubscriptionError } from "@/application/subscription/subscription-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, CrossTenantAccessError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" } as const;

function failure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: NO_STORE });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError || error instanceof CrossTenantAccessError)
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  if (error instanceof SubscriptionError) return NextResponse.json({ error: error.code }, { status: error.httpStatus, headers: NO_STORE });
  return NextResponse.json({ error: "subscription.internal_error" }, { status: 500, headers: NO_STORE });
}

/** Planos oferecidos a esta empresa (preco na moeda e pais do perfil) e a situacao da assinatura. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveTenantContext(request.headers);
    const [offers, status] = await Promise.all([subscriptionService().offers(ctx).catch((e) => { if (e instanceof SubscriptionError && e.code === "subscription.profile_required") return null; throw e; }), subscriptionService().status(ctx)]);
    return NextResponse.json({ offers, ...status }, { headers: NO_STORE });
  } catch (e) { return failure(e); }
}

/** Contratar. A chave de idempotencia (cabecalho Idempotency-Key) evita cobranca em dobro se a tela repetir o envio. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveTenantContext(request.headers);
    const raw = await request.text();
    if (raw.length > 8192) return NextResponse.json({ error: "subscription.input_invalid" }, { status: 413, headers: NO_STORE });
    let body: { planId?: unknown; customer?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "subscription.input_invalid" }, { status: 400, headers: NO_STORE }); }
    const r = await subscriptionService().subscribe(ctx, { planId: body?.planId, customer: body?.customer, idempotencyKey: request.headers.get("idempotency-key") });
    return NextResponse.json(r, { status: r.deduplicated ? 200 : 201, headers: NO_STORE });
  } catch (e) { return failure(e); }
}

/** Cancelar: o direito de uso continua ate o fim do periodo ja pago. */
export async function DELETE(request: Request) {
  try {
    const ctx = await resolveTenantContext(request.headers);
    return NextResponse.json({ subscription: await subscriptionService().cancel(ctx) }, { headers: NO_STORE });
  } catch (e) { return failure(e); }
}
