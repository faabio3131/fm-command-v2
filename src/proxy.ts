import { NextResponse, type NextRequest } from "next/server";
import { processRole } from "@/config/process-role";

/** Rotas que o processo de IA atende. Todo o resto é da operação e não existe neste processo. */
const AI_PROCESS_PATHS = [/^\/api\/core(\/|$)/, /^\/api\/health$/, /^\/api\/ready$/, /^\/api\/version$/];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Rotas que não usam o cookie da sessão: webhooks (assinatura), agendador (segredo) e a autenticação (própria checagem de origem). */
const NO_ORIGIN_CHECK = [/^\/api\/webhooks\//, /^\/api\/internal\//, /^\/api\/auth(\/|$)/];

/**
 * Pedido que altera dados vindo de outro site é recusado. O navegador sempre manda Origin em POST/PUT/PATCH/DELETE entre sites;
 * clientes sem navegador (testes, cron) não mandam e passam, porque não carregam o cookie de ninguém.
 */
export function crossSiteMutation(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const path = request.nextUrl.pathname;
  if (!path.startsWith("/api/") || NO_ORIGIN_CHECK.some((re) => re.test(path))) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  try { return new URL(origin).host !== host; } catch { return true; }
}

export function proxy(request: NextRequest) {
  if (crossSiteMutation(request)) return NextResponse.json({ error: "request.cross_site_blocked" }, { status: 403 });
  if (processRole() !== "ai") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (AI_PROCESS_PATHS.some((re) => re.test(path))) return NextResponse.next();
  return NextResponse.json({ error: "core.not_served_by_ai_process" }, { status: 404 });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
