import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildAgentService } from "@/application/agents/agent-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { agentErrorResponse } from "../../../error-response";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    await buildAgentService().reject(context, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) { return agentErrorResponse(error); }
}
