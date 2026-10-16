import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildAgentService } from "@/application/agents/agent-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { agentErrorResponse } from "../error-response";

export async function PUT(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await buildAgentService().setBudget(context, { enabled: body.enabled, capMinor: body.capMinor, reserveMinor: body.reserveMinor, currency: body.currency });
    return NextResponse.json({ ok: true });
  } catch (error) { return agentErrorResponse(error); }
}
