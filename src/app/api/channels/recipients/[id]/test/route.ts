import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildChannelService, testText } from "@/application/channels/channel-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { channelErrorResponse } from "../../../error-response";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const receipt = await buildChannelService().sendTest(context, id, await testText(context.tenantId), randomUUID());
    return NextResponse.json({ receipt });
  } catch (error) { return channelErrorResponse(error); }
}
