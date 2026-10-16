import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildAgentService } from "@/application/agents/agent-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { agentErrorResponse } from "../error-response";

/** Pede o rascunho da semana. Só gera texto; nada é enviado aqui. */
export async function POST() {
  try {
    const context = await resolveTenantContext(await headers());
    const { draft, created } = await buildAgentService().requestDraft(context);
    return NextResponse.json({ id: draft.id, status: draft.status, created }, { status: created ? 201 : 200 });
  } catch (error) { return agentErrorResponse(error); }
}
