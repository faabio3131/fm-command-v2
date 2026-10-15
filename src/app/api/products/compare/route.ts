import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { MetricService } from "@/application/metrics/metric-service";
import { ProductIntelligenceService } from "@/application/products/product-intelligence-service";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const url = new URL(request.url);
    const metricId = url.searchParams.get("metricId");
    const productIds = url.searchParams.getAll("productId");
    if (!metricId) return NextResponse.json({ error: "product.compare_metric_required" }, { status: 400 });

    const result = await new ProductIntelligenceService(
      new PostgresProductRepository(),
      new MetricService(new PostgresMetricStore()),
    ).compare(context, metricId, productIds);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ProductNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof Error && error.message === "product.compare_scope_invalid") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
