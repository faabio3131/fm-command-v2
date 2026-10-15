import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AlertAutomationService } from "@/application/alerts/alert-automation-service";
import { alertAutomationEnv } from "@/config/env";

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  let configuredSecret: string;
  try {
    configuredSecret = alertAutomationEnv().schedulerSecret;
  } catch {
    return NextResponse.json(
      { error: "automation.scheduler_not_configured" },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (
    !authorization.startsWith(prefix) ||
    !safeEqual(authorization.slice(prefix.length), configuredSecret)
  ) {
    return NextResponse.json(
      { error: "automation.unauthorized" },
      { status: 401 },
    );
  }

  const runId = request.headers.get("idempotency-key")?.trim() ?? "";
  const correlationId = request.headers.get("x-correlation-id")?.trim();

  try {
    const result = await new AlertAutomationService().run({
      runId,
      correlationId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "automation.run_id_invalid") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "automation.alert_evaluation_failed" },
      { status: 500 },
    );
  }
}
