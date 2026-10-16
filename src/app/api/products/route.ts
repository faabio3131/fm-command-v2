import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { ProductDefinitionInvalidError, ProductRegistryService, ProductSlugConflictError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

function securityResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json(await new ProductRegistryService(new PostgresProductRepository()).list(context));
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as { slug?: unknown; name?: unknown; status?: unknown };
    if (typeof body.slug !== "string" || typeof body.name !== "string") {
      return NextResponse.json({ error: "product.definition_invalid" }, { status: 400 });
    }
    if (body.status !== undefined && body.status !== "active" && body.status !== "inactive") {
      return NextResponse.json({ error: "product.definition_invalid" }, { status: 400 });
    }
    const product = await new ProductRegistryService(new PostgresProductRepository()).register(context, {
      slug: body.slug, name: body.name, status: body.status,
    });
    await recordAuditEvent(context, {
      action: "product.create", resourceType: "product", resourceId: product.id, result: "success",
      metadata: { slug: product.slug, status: product.status },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    if (error instanceof ProductDefinitionInvalidError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ProductSlugConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
