import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import {
  CommercialApprovalInvalidError,
  CommercialApprovalRequiredError,
  consumeCommercialApproval,
  isHighRiskCommercialPublish,
  issueCommercialApproval,
  publishActionForPreview,
} from "@/application/integration/commercial-approval";
import { KordenaCommercialControlService } from "@/application/integration/kordena-commercial-control-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  StepUpRequiredError,
  verifyPasswordStepUp,
} from "@/application/security/password-step-up";
import {
  isKordenaCommercialAction,
  type KordenaCommercialCommand,
} from "@/infrastructure/integration/kordena-commercial-connector";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

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
      approvalToken?: unknown;
    };
    if (
      typeof body.sourceId !== "string" ||
      typeof body.password !== "string" ||
      !isKordenaCommercialAction(body.action) ||
      !body.payload ||
      typeof body.payload !== "object" ||
      Array.isArray(body.payload)
    ) {
      return NextResponse.json(
        { error: "integration.kordena_command_invalid" },
        { status: 400 },
      );
    }

    const proof = await verifyPasswordStepUp(requestHeaders, body.password);
    if (proof.userId !== context.userId) {
      throw new StepUpRequiredError();
    }
    if (context.role !== "owner" && context.role !== "admin") {
      throw new PermissionDeniedError("commercial:write");
    }

    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId : undefined;
    const publishPayload = body.payload as Record<string, unknown>;

    if (isHighRiskCommercialPublish(body.action)) {
      if (typeof body.approvalToken !== "string") {
        throw new CommercialApprovalRequiredError();
      }
      await consumeCommercialApproval(context, {
        sourceId: body.sourceId,
        resourceId,
        publishAction: body.action,
        publishPayload,
        token: body.approvalToken,
      });
    }

    const previewPublishAction = publishActionForPreview(body.action);

    const command = {
      actor: {
        user_id: context.userId,
        role: context.role,
        step_up_at: proof.verifiedAt.toISOString(),
      },
      action: body.action,
      resource_id: resourceId,
      payload: publishPayload,
    } as KordenaCommercialCommand;

    const result = await new KordenaCommercialControlService().command(
      context,
      {
        sourceId: body.sourceId,
        command,
        idempotencyKey,
      },
    );

    const approval = previewPublishAction
      ? await issueCommercialApproval(context, {
          sourceId: body.sourceId,
          resourceId,
          publishAction: previewPublishAction,
          publishPayload,
        })
      : null;
    await recordAuditEvent(context, {
      action: "commercial.command.forwarded",
      resourceType: "kordena_commercial_control_plane",
      result: "success",
      metadata: {
        sourceId: body.sourceId,
        commandAction: body.action,
        resourceId: resourceId ?? null,
        approvalIssued: Boolean(approval),
      },
    });
    return NextResponse.json(approval ? { ...result, approval } : result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError ||
      error instanceof StepUpRequiredError ||
      error instanceof CommercialApprovalRequiredError ||
      error instanceof CommercialApprovalInvalidError
    ) {
      if (context) {
        await recordAuditEvent(context, {
          action: "commercial.command.forwarded",
          resourceType: "kordena_commercial_control_plane",
          result: "denied",
          metadata: { error: error.message },
        });
      }
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (context) {
      await recordAuditEvent(context, {
        action: "commercial.command.forwarded",
        resourceType: "kordena_commercial_control_plane",
        result: "failure",
        metadata: { error: "integration.kordena_command_failed" },
      });
    }
    return NextResponse.json(
      { error: "integration.kordena_command_failed" },
      { status: 502 },
    );
  }
}
