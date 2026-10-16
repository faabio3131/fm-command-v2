import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildChannelService } from "@/application/channels/channel-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { channelErrorResponse, readJson } from "../error-response";

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await readJson(request);
    const result = await buildChannelService().addRecipient(context, { kind: body.kind, address: body.address, label: body.label });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) { return channelErrorResponse(error); }
}
