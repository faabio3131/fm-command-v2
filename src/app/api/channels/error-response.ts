import { NextResponse } from "next/server";
import { ChannelInputError, ChannelNotFoundError } from "@/application/channels/channel-service";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export function channelErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ChannelInputError) return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
  if (error instanceof ChannelNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  throw error;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch { return {}; }
}
