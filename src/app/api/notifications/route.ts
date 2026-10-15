import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildNotificationService } from "@/application/notifications/notification-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  NotificationNotFoundError,
  NotificationQueryError,
} from "@/domain/notifications/contracts";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

function readLimit(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null) return 25;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const limit = readLimit(request);
    if (limit === null) {
      return NextResponse.json(
        { error: "notification.query_invalid" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await buildNotificationService().inbox(context, limit),
    );
  } catch (error) {
    if (error instanceof NotificationQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as { notificationId?: unknown };
    if (
      typeof body.notificationId !== "string" ||
      !body.notificationId.trim()
    ) {
      return NextResponse.json(
        { error: "notification.query_invalid" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await buildNotificationService().markRead(
        context,
        body.notificationId,
      ),
    );
  } catch (error) {
    if (error instanceof NotificationQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotificationNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
