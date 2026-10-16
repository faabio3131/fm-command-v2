import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { KordenaBillingControlService } from "@/application/integration/kordena-billing-control-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  StepUpRequiredError,
  verifyPasswordStepUp,
} from "@/application/security/password-step-up";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import type {
  KordenaBillingAction,
  KordenaBillingCommand,
} from "@/infrastructure/integration/kordena-commercial-connector";

const BILLING_ACTIONS = new Set<KordenaBillingAction>([
  "provider.create",
  "provider.update",
  "provider.credential",
  "provider.test",
  "provider.status",
  "routing.create",
  "routing.update",
]);

function isBillingAction(value: unknown): value is KordenaBillingAction {
  return typeof value === "string" && BILLING_ACTIONS.has(value as KordenaBillingAction);
}

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim();
    if (!sourceId) {
      return NextResponse.json(
        { error: "integration.source_id_required" },
        { status: 400 },
      );
    }
    const result = await new KordenaBillingControlService().overview(
      context,
      sourceId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "integration.kordena_billing_read_failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let context;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    const idempotencyKey =
      requestHeaders.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 192) {
      return NextResponse.json(
        { error: "integration.idempotency_key_invalid" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      sourceId?: unknown;
      password?: unknown;
      action?: unknown;
      resourceId?: unknown;
      payload?: unknown;
    };
    if (
      typeof body.sourceId !== "string" ||
      typeof body.password !== "string" ||
      !isBillingAction(body.action) ||
      !body.payload ||
      typeof body.payload !== "object" ||
      Array.isArray(body.payload)
    ) {
      return NextResponse.json(
        { error: "integration.kordena_billing_command_invalid" },
        { status: 400 },
      );
    }

    const proof = await verifyPasswordStepUp(requestHeaders, body.password);
    if (proof.userId !== context.userId) {
      throw new StepUpRequiredError();
    }
    if (context.role !== "owner" && context.role !== "admin") {
      throw new PermissionDeniedError("billing:write");
    }

    const command: KordenaBillingCommand = {
      actor: {
        user_id: context.userId,
        role: context.role,
        step_up_at: proof.verifiedAt.toISOString(),
      },
      action: body.action,
      resource_id:
        typeof body.resourceId === "string" ? body.resourceId : undefined,
      payload: body.payload as Record<string, unknown>,
    };

    const result = await new KordenaBillingControlService().command(context, {
      sourceId: body.sourceId,
      command,
      idempotencyKey,
    });

    await recordAuditEvent(context, {
      action: "commercial.billing.command.forwarded",
      resourceType: "kordena_billing_control_plane",
      result: "success",
      metadata: {
        sourceId: body.sourceId,
        commandAction: body.action,
        resourceId:
          typeof body.resourceId === "string" ? body.resourceId : null,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError ||
      error instanceof StepUpRequiredError
    ) {
      if (context) {
        await recordAuditEvent(context, {
          action: "commercial.billing.command.forwarded",
          resourceType: "kordena_billing_control_plane",
          result: "denied",
          metadata: { error: error.message },
        });
      }
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (context) {
      await recordAuditEvent(context, {
        action: "commercial.billing.command.forwarded",
        resourceType: "kordena_billing_control_plane",
        result: "failure",
        metadata: { error: "integration.kordena_billing_command_failed" },
      });
    }
    return NextResponse.json(
      { error: "integration.kordena_billing_command_failed" },
      { status: 502 },
    );
  }
}
