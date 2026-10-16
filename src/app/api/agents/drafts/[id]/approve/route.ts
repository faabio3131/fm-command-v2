import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildAgentService } from "@/application/agents/agent-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { agentErrorResponse } from "../../../error-response";

/** Única rota que leva um rascunho ao envio: exige permissão de aprovar e o rascunho em 'pronto'. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { subject?: unknown; body?: unknown };
    return NextResponse.json(await buildAgentService().approve(context, id, { subject: body.subject, body: body.body }));
  } catch (error) { return agentErrorResponse(error); }
}
