import { NextResponse } from "next/server";
import { alertAutomationEnv } from "@/config/env";
import { verifyScheduledWorkerBearer } from "@/application/security/verify-scheduled-worker-bearer";
import { IronAiCreditOutboxWorker } from "@/application/billing/iron-ai-credit-outbox-worker";
import { pool } from "@/infrastructure/db/client";

export const dynamic = "force-dynamic";

/** Uses the existing scheduler secret; repeated deliveries are idempotent at the IRON boundary. */
export async function POST(request: Request) {
  let secret: string;
  try { secret = alertAutomationEnv().schedulerSecret; }
  catch { return NextResponse.json({ error: "automation.scheduler_not_configured" }, { status: 503 }); }
  if (!verifyScheduledWorkerBearer(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "automation.unauthorized" }, { status: 401 });
  const worker = new IronAiCreditOutboxWorker(pool, process.env);
  const outcome = { delivered: 0, retry: 0, blocked: 0, idle: 0 };
  try {
    for (let i=0; i<5; i++) {
      const status = await worker.processOne();
      outcome[status] += 1;
      if (status === "idle") break;
    }
    return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "iron.credits_delivery_unavailable" }, { status: 503 });
  }
}
