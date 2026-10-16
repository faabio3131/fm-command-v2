import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { ExecutiveAnalysisArgumentError, ExecutiveAnalysisService } from "@/application/executive/executive-analysis-service";
import { MetricService } from "@/application/metrics/metric-service";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId") ?? undefined;
    const metricIds = url.searchParams.getAll("metricId");
    const service = new ExecutiveAnalysisService(
      new MetricService(new PostgresMetricStore()),
      new PostgresProductRepository(),
    );
    const overview = await service.overview(context, {
      productId,
      metricIds: metricIds.length ? metricIds : undefined,
    });
    await recordAuditEvent(context, {
      action: "executive.analysis",
      resourceType: "executive_intelligence",
      resourceId: productId,
      result: "success",
      metadata: {
        productId: productId ?? null,
        metricIds: overview.signals.map((signal) => signal.metricId),
        availableSignals: overview.signals.filter((signal) => signal.status === "available").length,
        anomalyStatus: overview.anomaly.status,
        riskStatus: overview.risk.status,
        forecastStatus: overview.forecast.status,
      },
    });
    return NextResponse.json(overview);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ProductNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ExecutiveAnalysisArgumentError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
