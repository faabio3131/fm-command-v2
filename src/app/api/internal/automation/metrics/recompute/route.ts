import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createMetricRecomputeService } from "@/application/metrics/metric-composition";
import { alertAutomationEnv } from "@/config/env";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Rodada agendada de recálculo das métricas de todas as empresas (mesmo segredo interno da automação). Repetir é seguro. */
export async function POST(request: Request) {
  let secret: string;
  try { secret = alertAutomationEnv().schedulerSecret; }
  catch { return NextResponse.json({ error: "automation.scheduler_not_configured" }, { status: 503 }); }
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !timingSafeEqual(digest(authorization.slice(7)), digest(secret))) {
    return NextResponse.json({ error: "automation.unauthorized" }, { status: 401 });
  }
  try {
    const correlationId = request.headers.get("x-correlation-id")?.trim() || randomUUID();
    return NextResponse.json(await createMetricRecomputeService().recomputeAll(correlationId));
  } catch {
    return NextResponse.json({ error: "automation.metric_recompute_failed" }, { status: 500 });
  }
}
