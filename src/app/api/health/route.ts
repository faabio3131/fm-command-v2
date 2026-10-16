import { NextResponse } from "next/server";
export function GET(){ return NextResponse.json({ service: "fm-control-center", status: "ok" }); }
