import { NextResponse, type NextRequest } from "next/server";
import { processRole } from "@/config/process-role";

/** Rotas que o processo de IA atende. Todo o resto é da operação e não existe neste processo. */
const AI_PROCESS_PATHS = [/^\/api\/core(\/|$)/, /^\/api\/health$/, /^\/api\/ready$/, /^\/api\/version$/];

export function proxy(request: NextRequest) {
  if (processRole() !== "ai") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (AI_PROCESS_PATHS.some((re) => re.test(path))) return NextResponse.next();
  return NextResponse.json({ error: "core.not_served_by_ai_process" }, { status: 404 });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
