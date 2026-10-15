import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ProductIntelligenceService } from "@/application/products/product-intelligence-service";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { MetricService } from "@/application/metrics/metric-service";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export async function GET(_request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const tenant = await resolveTenantContext(await headers());
    const { productId } = await context.params;
    const result = await new ProductIntelligenceService(
      new PostgresProductRepository(),
      new MetricService(new PostgresMetricStore()),
    ).overview(tenant, productId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ProductNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
