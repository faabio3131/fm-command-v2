import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildChannelService } from "@/application/channels/channel-composition";
import { ChannelInputError } from "@/application/channels/channel-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { channelErrorResponse, readJson } from "../../error-response";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const body = await readJson(request);
    if (typeof body.enabled !== "boolean") throw new ChannelInputError("enabled");
    await buildChannelService().setRecipientEnabled(context, id, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (error) { return channelErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    await buildChannelService().removeRecipient(context, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return channelErrorResponse(error); }
}
