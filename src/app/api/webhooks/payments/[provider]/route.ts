import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedBody } from "@/infrastructure/http/read-limited-body";
import { subscriptionService } from "@/application/subscription/subscription-runtime";
import { SubscriptionError } from "@/application/subscription/subscription-service";

export const dynamic = "force-dynamic";
const MAX_BODY = 65_536;

/**
 * Aviso do meio de cobranca (ADR-021). Sem sessao: a autenticidade e verificada pelo proprio provedor configurado.
 * Responde 200 para tudo que foi aceito, repetido, ignorado ou guardado para depois; erro de armazenamento responde 503 para o provedor reenviar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(provider)) return NextResponse.json({ error: "webhook.not_found" }, { status: 404 });
  let raw: string;
  try { raw = await readLimitedBody(request, MAX_BODY); }
  catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "webhook.too_large" }, { status: 413 });
    return NextResponse.json({ error: "webhook.body_invalid" }, { status: 400 });
  }
  try {
    const status = await subscriptionService().handleWebhook(provider, request.headers, raw);
    return NextResponse.json({ accepted: true, status }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof SubscriptionError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    return NextResponse.json({ error: "webhook.persistence_unavailable" }, { status: 503 });
  }
}
