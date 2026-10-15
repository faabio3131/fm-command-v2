import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildProductReceivablesService } from "@/application/finance/product-receivables-composition";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { ReceivablesContractError } from "@/domain/finance/receivables";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

export async function GET(
  _request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  try {
    const tenant = await resolveTenantContext(await headers());
    const { productId } = await context.params;
    return NextResponse.json(
      await buildProductReceivablesService().overview(tenant, productId),
    );
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
    if (error instanceof ReceivablesContractError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
