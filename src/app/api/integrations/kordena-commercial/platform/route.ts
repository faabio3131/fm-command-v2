import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { KordenaPlatformIntegrationControlService } from "@/application/integration/kordena-platform-integration-control-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  StepUpRequiredError,
  verifyPasswordStepUp,
} from "@/application/security/password-step-up";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import type {
  KordenaPlatformActor,
  KordenaPlatformIntegrationConfigInput,
  PlatformParameterValue,
} from "@/infrastructure/integration/kordena-platform-integration-connector";

type Action = "configure" | "healthcheck" | "homologate";

function actionOf(value: unknown): Action | null {
  return value === "configure" ||
    value === "healthcheck" ||
    value === "homologate"
    ? value
    : null;
}

function compactString(value: unknown, max = 4096): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function parameterValue(value: unknown): PlatformParameterValue | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length <= 4096) {
    return value.trim();
  }
  return null;
}

function parseConfiguration(
  value: unknown,
): KordenaPlatformIntegrationConfigInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const servico = compactString(item.servico, 128);
  const provedor = compactString(item.provedor, 128);
  const contaExterna = compactString(item.conta_externa, 128);
  const ambiente = compactString(item.ambiente, 64);
  if (
    !servico ||
    !provedor ||
    !contaExterna ||
    !ambiente ||
    typeof item.habilitada !== "boolean" ||
    typeof item.versao !== "number" ||
    !Number.isInteger(item.versao) ||
    item.versao < 0 ||
    !Array.isArray(item.parametros) ||
    item.parametros.length > 32 ||
    !Array.isArray(item.credenciais) ||
    item.credenciais.length > 16
  ) {
    return null;
  }

  const parametros: {
    nome: string;
    valor: PlatformParameterValue;
  }[] = [];
  for (const raw of item.parametros) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const param = raw as Record<string, unknown>;
    const nome = compactString(param.nome, 128);
    const valor = parameterValue(param.valor);
    if (!nome || valor === null) return null;
    parametros.push({ nome, valor });
  }

  const credenciais: { papel: string; valor: string }[] = [];
  for (const raw of item.credenciais) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const credential = raw as Record<string, unknown>;
    const papel = compactString(credential.papel, 128);
    const valor = compactString(credential.valor, 8192);
    if (!papel || !valor) return null;
    credenciais.push({ papel, valor });
  }

  return {
    servico,
    provedor,
    conta_externa: contaExterna,
    ambiente,
    parametros,
    credenciais,
    habilitada: item.habilitada,
    versao: item.versao,
  };
}

function safeConfigId(value: unknown): string | null {
  const configId = compactString(value, 256);
  return configId && /^[a-z0-9._-]+$/i.test(configId) ? configId : null;
}

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim();
    if (!sourceId) {
      return NextResponse.json(
        { error: "integration.source_id_required" },
        { status: 400 },
      );
    }
    const result = await new KordenaPlatformIntegrationControlService().overview(
      context,
      sourceId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "integration.kordena_platform_read_failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let context;
  let action: Action | null = null;
  let configId: string | null = null;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    const body = (await request.json()) as Record<string, unknown>;
    action = actionOf(body.action);
    configId = safeConfigId(body.configId);
    const sourceId = compactString(body.sourceId, 256);
    const password = compactString(body.password, 128);
    if (!action || !configId || !sourceId || !password) {
      return NextResponse.json(
        { error: "integration.kordena_platform_request_invalid" },
        { status: 400 },
      );
    }

    if (context.role !== "owner" && context.role !== "admin") {
      throw new PermissionDeniedError("integration:write");
    }
    const proof = await verifyPasswordStepUp(requestHeaders, password);
    if (proof.userId !== context.userId) throw new StepUpRequiredError();

    const actor: KordenaPlatformActor = {
      user_id: context.userId,
      role: context.role,
      step_up_at: proof.verifiedAt.toISOString(),
    };
    const service = new KordenaPlatformIntegrationControlService();

    let result: unknown;
    if (action === "configure") {
      const configuracao = parseConfiguration(body.configuracao);
      if (!configuracao) {
        return NextResponse.json(
          { error: "integration.kordena_platform_configuration_invalid" },
          { status: 400 },
        );
      }
      result = await service.configure(context, {
        sourceId,
        configId,
        actor,
        configuracao,
      });
    } else if (action === "healthcheck") {
      result = await service.healthcheck(context, {
        sourceId,
        configId,
        actor,
      });
    } else {
      const evidenceRef = compactString(body.evidenceRef, 512);
      if (!evidenceRef || !evidenceRef.startsWith("healthcheck://")) {
        return NextResponse.json(
          { error: "integration.kordena_platform_evidence_invalid" },
          { status: 400 },
        );
      }
      result = await service.homologate(context, {
        sourceId,
        configId,
        actor,
        evidenceRef,
      });
    }

    await recordAuditEvent(context, {
      action: `platform.integration.${action}`,
      resourceType: "kordena_platform_integration_control_plane",
      result: "success",
      metadata: { sourceId, configId },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError ||
      error instanceof StepUpRequiredError
    ) {
      if (context) {
        await recordAuditEvent(context, {
          action: `platform.integration.${action ?? "unknown"}`,
          resourceType: "kordena_platform_integration_control_plane",
          result: "denied",
          metadata: {
            configId,
            error: error.message,
          },
        });
      }
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (context) {
      await recordAuditEvent(context, {
        action: `platform.integration.${action ?? "unknown"}`,
        resourceType: "kordena_platform_integration_control_plane",
        result: "failure",
        metadata: {
          configId,
          error: "integration.kordena_platform_operation_failed",
        },
      });
    }
    return NextResponse.json(
      { error: "integration.kordena_platform_operation_failed" },
      { status: 502 },
    );
  }
}
