import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { MetricService } from "@/application/metrics/metric-service";
import { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const productId = new URL(request.url).searchParams.get("productId") ?? undefined;
    const service = new OperationsIntelligenceService(
      new MetricService(new PostgresMetricStore()),
      new PostgresProductRepository(),
    );
    return NextResponse.json(await service.overview(context, productId));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ProductNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
