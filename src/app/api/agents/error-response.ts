import { NextResponse } from "next/server";
import { AgentInputError, AgentNotFoundError, AgentRefusedError, AgentStateError } from "@/application/agents/agent-service";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export function agentErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AgentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof AgentInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof AgentRefusedError) return NextResponse.json({ error: error.reason }, { status: 409 });
  if (error instanceof AgentStateError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
