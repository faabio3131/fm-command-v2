import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildChannelService } from "@/application/channels/channel-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { channelErrorResponse, readJson } from "../error-response";

export async function PUT(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await readJson(request);
    const config = await buildChannelService().saveConfig(context, body as Parameters<ReturnType<typeof buildChannelService>["saveConfig"]>[1]);
    return NextResponse.json({ config });
  } catch (error) { return channelErrorResponse(error); }
}
