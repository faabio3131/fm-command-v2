import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildChannelService } from "@/application/channels/channel-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { channelErrorResponse } from "./error-response";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json(await buildChannelService().overview(context));
  } catch (error) { return channelErrorResponse(error); }
}
