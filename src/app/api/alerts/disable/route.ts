import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AlertRuleNotFoundError } from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as { ruleId?: unknown };
    if (typeof body.ruleId !== "string" || !body.ruleId.trim()) {
      return NextResponse.json({ error: "alert.rule_not_found" }, { status: 400 });
    }
    return NextResponse.json(await buildAlertService().disableRule(context, body.ruleId));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AlertRuleNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
