import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { logEvent } from "@/infrastructure/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(){
  try { await db.execute(sql`select 1 as ready`); return NextResponse.json({status:"ready"}); }
  catch(error){ logEvent("error","readiness_failed",{errorType:error instanceof Error ? error.name:"unknown"}); return NextResponse.json({status:"unavailable"},{status:503}); }
}
