import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildAgentService } from "@/application/agents/agent-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { agentErrorResponse } from "./error-response";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    const o = await buildAgentService().overview(context);
    return NextResponse.json({
      budget: o.budget ? { enabled: o.budget.enabled, capMicroMinor: o.budget.capMicroMinor, currency: o.budget.currency } : null,
      drafts: o.drafts.map((d) => ({ id: d.id, period: d.periodKey, status: d.status, errorCode: d.errorCode, unverified: d.unverifiedNumbers.length })),
    });
  } catch (error) { return agentErrorResponse(error); }
}
