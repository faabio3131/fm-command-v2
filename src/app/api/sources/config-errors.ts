import { NextResponse } from "next/server";
import {
  ConnectorNotReadyError,
  ConnectorUnknownError,
  SourceConfigInvalidError,
  SourceNotFoundForConfigError,
} from "@/application/integration/source-configuration-service";
import { InvalidProductScopeError } from "@/application/integration/source-registry-service";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

/** Traduz erros da configuração de fontes em respostas HTTP sem expor detalhes internos. */
export function configErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof SourceNotFoundForConfigError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof SourceConfigInvalidError) {
    return NextResponse.json({ error: "integration.source_config_invalid", field: error.field }, { status: 400 });
  }
  if (error instanceof ConnectorUnknownError || error instanceof ConnectorNotReadyError || error instanceof InvalidProductScopeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "integration.source_config_failed" }, { status: 500 });
}
