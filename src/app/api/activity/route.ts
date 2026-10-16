import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  ACTIVITY_CATEGORIES,
  ActivityQueryError,
  type ActivityCategory,
} from "@/domain/activity/contracts";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

function readInteger(
  url: URL,
  name: string,
  fallback: number,
  max: number,
): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : null;
}

function readCategory(url: URL): ActivityCategory | null | undefined {
  const raw = url.searchParams.get("category");
  if (raw === null || raw === "all") return undefined;
  return ACTIVITY_CATEGORIES.includes(raw as ActivityCategory)
    ? (raw as ActivityCategory)
    : null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const url = new URL(request.url);
    const legacyLimit = url.searchParams.get("limit");
    const pageSize = legacyLimit !== null
      ? readInteger(url, "limit", 20, 100)
      : readInteger(url, "pageSize", 20, 100);
    const page = readInteger(url, "page", 1, 25);
    const category = readCategory(url);
    const productId = url.searchParams.get("productId")?.trim() || undefined;

    if (page === null || pageSize === null || category === null) {
      return NextResponse.json(
        { error: "activity.query_invalid" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await buildActivityFeedService().page(context, {
        page,
        pageSize,
        category,
        productId,
      }),
    );
  } catch (error) {
    if (error instanceof ActivityQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
