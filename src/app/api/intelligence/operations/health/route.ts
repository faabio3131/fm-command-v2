import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const productId =
      new URL(request.url).searchParams.get("productId")?.trim() || undefined;
    const service = new OperationalHealthService(
      new PostgresOperationalHealthRepository(),
      new PostgresProductRepository(),
    );
    return NextResponse.json(await service.overview(context, productId));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
