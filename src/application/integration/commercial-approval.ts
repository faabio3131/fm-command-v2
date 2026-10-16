import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const APPROVAL_TTL_MS = 5 * 60 * 1000;

export class CommercialApprovalRequiredError extends Error {
  constructor(code = "commercial.approval_required") {
    super(code);
  }
}

export class CommercialApprovalInvalidError extends Error {
  constructor(code = "commercial.approval_invalid") {
    super(code);
  }
}

const PREVIEW_TO_PUBLISH = {
  "plan_version.preview": "plan_version.publish",
  "price.preview": "price.publish",
  "promotion_version.preview": "promotion_version.publish",
} as const;

export function publishActionForPreview(action: string): string | null {
  return PREVIEW_TO_PUBLISH[action as keyof typeof PREVIEW_TO_PUBLISH] ?? null;
}

export function isHighRiskCommercialPublish(action: string): boolean {
  return Object.values(PREVIEW_TO_PUBLISH).includes(
    action as (typeof PREVIEW_TO_PUBLISH)[keyof typeof PREVIEW_TO_PUBLISH],
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function commercialPayloadHash(payload: Record<string, unknown>): string {
  return digest(canonicalJson(payload));
}

function approvalTokenHash(token: string): string {
  return digest(token);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  return typeof metadata[key] === "string" ? metadata[key] as string : null;
}

export async function issueCommercialApproval(
  context: TenantContext,
  input: {
    sourceId: string;
    resourceId?: string;
    publishAction: string;
    publishPayload: Record<string, unknown>;
  },
): Promise<{ token: string; expiresAt: string }> {
  if (!isHighRiskCommercialPublish(input.publishAction)) {
    throw new CommercialApprovalInvalidError("commercial.approval_action_invalid");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = approvalTokenHash(token);
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const payloadHash = commercialPayloadHash(input.publishPayload);

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorId: context.userId,
    actorType: "user",
    action: "commercial.command.preview_approved",
    resourceType: "kordena_commercial_publish_approval",
    resourceId: input.resourceId ?? null,
    result: "allowed",
    correlationId: context.correlationId,
    metadata: {
      sourceId: input.sourceId,
      publishAction: input.publishAction,
      resourceId: input.resourceId ?? null,
      payloadHash,
      tokenHash,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function consumeCommercialApproval(
  context: TenantContext,
  input: {
    sourceId: string;
    resourceId?: string;
    publishAction: string;
    publishPayload: Record<string, unknown>;
    token: string;
  },
): Promise<void> {
  const token = input.token.trim();
  if (token.length < 32 || !isHighRiskCommercialPublish(input.publishAction)) {
    throw new CommercialApprovalRequiredError();
  }

  const tokenHash = approvalTokenHash(token);
  const payloadHash = commercialPayloadHash(input.publishPayload);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${context.tenantId}:commercial-approval:${tokenHash}`}))`,
    );

    const approvals = await tx
      .select()
      .from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, context.tenantId),
        eq(auditEvents.actorId, context.userId),
        eq(auditEvents.action, "commercial.command.preview_approved"),
        sql`${auditEvents.metadata}->>'tokenHash' = ${tokenHash}`,
      ))
      .limit(1);

    const approval = approvals[0];
    if (approval) {
      const metadata = approval.metadata;
      if (
        metadataString(metadata, "sourceId") !== input.sourceId ||
        metadataString(metadata, "publishAction") !== input.publishAction ||
        (metadataString(metadata, "resourceId") ?? "") !== (input.resourceId ?? "") ||
        metadataString(metadata, "payloadHash") !== payloadHash
      ) {
        throw new CommercialApprovalRequiredError();
      }
    }

    if (!approval) throw new CommercialApprovalRequiredError();

    const expiresAtRaw = metadataString(approval.metadata, "expiresAt");
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new CommercialApprovalInvalidError("commercial.approval_expired");
    }

    const consumedRows = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, context.tenantId),
        eq(auditEvents.action, "commercial.command.approval_consumed"),
        sql`${auditEvents.metadata}->>'tokenHash' = ${tokenHash}`,
      ))
      .limit(1);

    if (consumedRows[0]) {
      throw new CommercialApprovalInvalidError("commercial.approval_already_used");
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorId: context.userId,
      actorType: "user",
      action: "commercial.command.approval_consumed",
      resourceType: "kordena_commercial_publish_approval",
      resourceId: input.resourceId ?? null,
      result: "success",
      correlationId: context.correlationId,
      metadata: {
        sourceId: input.sourceId,
        publishAction: input.publishAction,
        resourceId: input.resourceId ?? null,
        payloadHash,
        tokenHash,
        approvedAt: approval.occurredAt.toISOString(),
      },
    });
  });
}
