import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchDueChannelDeliveries } from "@/application/channels/channel-composition";
import { buildReportService, metricNameFor } from "@/application/reports/report-composition";
import { alertAutomationEnv } from "@/config/env";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Rodada do agendador de relatórios (mesmo segredo interno da automação de alertas). Repetir a chamada não reenvia nada. */
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
    const reports = await buildReportService().runDue(metricNameFor, correlationId);
    const deliveries = await dispatchDueChannelDeliveries().catch(() => null);
    return NextResponse.json({ reports, deliveries });
  } catch {
    return NextResponse.json({ error: "automation.report_run_failed" }, { status: 500 });
  }
}
