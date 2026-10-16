import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildGlobalSearchService } from "@/application/search/global-search-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  GlobalSearchQueryError,
  GlobalSearchRateLimitError,
} from "@/domain/search/contracts";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

function readLimit(url: URL): number | null {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 20;
  if (!/^\d{1,2}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const limit = readLimit(url);
    if (limit === null) {
      return NextResponse.json(
        { error: "search.limit_invalid" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await buildGlobalSearchService().search(context, query, limit),
    );
  } catch (error) {
    if (error instanceof GlobalSearchQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof GlobalSearchRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
