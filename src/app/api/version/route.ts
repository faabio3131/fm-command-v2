import { NextResponse } from "next/server";
import { readDeploymentIdentity } from "@/application/deployment/deployment-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(readDeploymentIdentity(), {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
