"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  KordenaPlatformIntegration,
  KordenaPlatformIntegrationsOverview,
} from "@/infrastructure/integration/kordena-platform-integration-connector";

type Props = {
  sourceId: string;
  initialOverview: KordenaPlatformIntegrationsOverview;
  canWrite: boolean;
};

function labelForField(field: string): string {
  const labels: Record<string, string> = {
    model: "Modelo",
    country_code: "País",
    language: "Idioma",
    api_key: "API Key",
    browser_api_key: "Browser API Key",
    server_api_key: "Server API Key",
  };
  return labels[field] ?? field.replaceAll("_", " ");
}

function defaultParameter(
  integration: KordenaPlatformIntegration,
  name: string,
): string {
  const existing = integration.configuracao?.parametros[name];
  if (existing !== undefined) return String(existing);
  if (integration.catalogo.provedor === "openai" && name === "model") {
    return "gpt-5.6-luna";
  }
  if (integration.catalogo.provedor === "google_maps" && name === "country_code") {
    return "BR";
  }
  if (integration.catalogo.provedor === "google_maps" && name === "language") {
    return "pt-BR";
  }
  return "";
}

function stateLabel(integration: KordenaPlatformIntegration): string {
  const config = integration.configuracao;
  if (!config) return "Não configurada";
  if (config.homologada && config.prontidao.pronto) return "Homologada";
  if (config.habilitada) return "Configurada";
  return "Desativada";
}

function errorMessage(code?: string | null): string {
  const messages: Record<string, string> = {
    "security.step_up_required": "Confirme novamente sua senha do Command.",
    "openai_api_key_invalida": "A API Key da OpenAI foi recusada.",
    "openai_api_key_sem_permissao":
      "A API Key não possui permissão para este uso.",
    "openai_modelo_indisponivel":
      "O modelo configurado não está disponível para esta credencial.",
    "openai_quota_ou_faturamento":
      "A OpenAI recusou a chamada por quota, rate limit ou faturamento.",
    "openai_provedor_indisponivel":
      "A OpenAI está temporariamente indisponível.",
    "openai_timeout": "O healthcheck da OpenAI excedeu o tempo limite.",
    "integration.kordena_platform_operation_failed":
      "O Command não conseguiu concluir a operação no control plane do Kordena.",
  };
  return messages[code ?? ""] ?? code ?? "A operação não pôde ser concluída.";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function PlatformIntegrationsControlPanel({
  sourceId,
  initialOverview,
  canWrite,
}: Props) {
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  async function execute(input: {
    action: "configure" | "healthcheck" | "homologate";
    configId: string;
    configuracao?: Record<string, unknown>;
    evidenceRef?: string;
  }): Promise<Record<string, unknown> | null> {
    setMessageTarget(input.configId);
    if (!password.trim()) {
      setMessage("Informe sua senha de confirmação para esta operação.");
      passwordRef.current?.focus();
      return null;
    }
    const operation = `${input.action}:${input.configId}`;
    setBusy(operation);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/integrations/kordena-commercial/platform",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId,
            password,
            action: input.action,
            configId: input.configId,
            configuracao: input.configuracao,
            evidenceRef: input.evidenceRef,
          }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        setMessage(
          errorMessage(typeof body.error === "string" ? body.error : null),
        );
        return null;
      }
      return body;
    } catch {
      setMessage("Não foi possível comunicar com o control plane do Kordena.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function configure(
    event: FormEvent<HTMLFormElement>,
    integration: KordenaPlatformIntegration,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const config = integration.configuracao;
    const configId = config?.configuracao_id ?? `${integration.catalogo.servico}--${integration.catalogo.provedor}`;
    setMessageTarget(configId);

    const parametros = integration.catalogo.parametros_obrigatorios.map(
      (name) => ({
        nome: name,
        valor: String(form.get(`param:${name}`) ?? "").trim(),
      }),
    );
    if (parametros.some((item) => !item.valor)) {
      setMessage("Preencha todos os parâmetros obrigatórios.");
      return;
    }

    const credenciais = integration.catalogo.credenciais_obrigatorias
      .map((role) => ({
        papel: role,
        valor: String(form.get(`credential:${role}`) ?? "").trim(),
      }))
      .filter((item) => item.valor);

    const missingCredential = integration.catalogo.credenciais_obrigatorias.find(
      (role) =>
        !config?.credenciais_estado[role] &&
        !credenciais.some((item) => item.papel === role),
    );
    if (missingCredential) {
      setMessage(`Informe ${labelForField(missingCredential)}.`);
      return;
    }

    const result = await execute({
      action: "configure",
      configId,
      configuracao: {
        servico: integration.catalogo.servico,
        provedor: integration.catalogo.provedor,
        conta_externa: config?.conta_externa ?? "principal",
        ambiente: config?.ambiente ?? "homologacao",
        parametros,
        credenciais,
        habilitada: true,
        versao: config?.versao ?? 0,
      },
    });
    if (!result) return;

    setPassword("");
    setEvidence((current) => {
      const next = { ...current };
      delete next[configId];
      return next;
    });
    formElement.reset();
    setMessage("Configuração salva no Vault canônico. Estado atualizado.");
    router.refresh();
  }

  async function healthcheck(integration: KordenaPlatformIntegration) {
    const config = integration.configuracao;
    if (!config) return;
    const result = await execute({
      action: "healthcheck",
      configId: config.configuracao_id,
    });
    if (!result) return;

    if (result.executado !== true) {
      setMessage(
        errorMessage(typeof result.erro === "string" ? result.erro : null),
      );
      return;
    }
    const evidenceRef =
      typeof result.evidencia_ref === "string" ? result.evidencia_ref : "";
    if (!evidenceRef) {
      setMessage("O healthcheck não produziu evidência homologável.");
      return;
    }
    setEvidence((current) => ({
      ...current,
      [config.configuracao_id]: evidenceRef,
    }));
    setPassword("");
    setMessage(
      `Healthcheck real aprovado para ${integration.catalogo.label}. Evidência sanitizada pronta para homologação.`,
    );
  }

  async function homologate(integration: KordenaPlatformIntegration) {
    const config = integration.configuracao;
    if (!config) return;
    const evidenceRef = evidence[config.configuracao_id];
    if (!evidenceRef) {
      setMessage("Execute um healthcheck real aprovado antes de homologar.");
      return;
    }
    const result = await execute({
      action: "homologate",
      configId: config.configuracao_id,
      evidenceRef,
    });
    if (!result) return;

    setPassword("");
    setEvidence((current) => {
      const next = { ...current };
      delete next[config.configuracao_id];
      return next;
    });
    setMessage(`${integration.catalogo.label} homologada no Command.`);
    router.refresh();
  }

  return (
    <>
      <section className="panel" style={{ padding: 12, marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, marginBottom: 2 }}>Confirmação administrativa</h2>
        <p id="platform-admin-confirmation-help" style={{ fontSize: 12, marginBottom: 5 }}>
          Configuração, teste real e homologação exigem reautenticação. A senha
          serve apenas para o step-up e não é armazenada pelo painel.
        </p>
        <div style={{ maxWidth: 380, width: "100%" }}>
          <label htmlFor="command-step-up-password">Senha da sua conta FM Command</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5 }}>
            <input
              id="command-step-up-password"
              aria-describedby="platform-admin-confirmation-help"
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!canWrite}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
              disabled={!canWrite}
              style={{ minWidth: 44, height: 40, borderRadius: 8, border: "1px solid var(--border, #314366)", background: "transparent", color: "inherit", cursor: "pointer" }}
            >
              <span aria-hidden="true" style={{ fontSize: 18 }}>{showPassword ? "◉" : "👁"}</span>
            </button>
          </div>
          <small style={{ display: "block", marginTop: 5 }}>
            Use sua senha atual de login, não a API Key. Para criar ou redefinir a senha,
            utilize o fluxo de cadastro ou recuperação de acesso do Command.
            Nunca informe a senha neste chat.
          </small>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </section>

      <section className="executive-section" style={{ paddingTop: 0, marginTop: 8 }}>
        <div className="section-heading" style={{ marginBottom: 8 }}>
          <div>
            <span className="eyebrow">APIs compartilhadas</span>
            <h2>Serviços gerenciados pela FM</h2>
          </div>
          <p>
            A interface nunca recupera o valor de uma credencial salva. Campos
            vazios preservam segredos já configurados.
          </p>
        </div>

        <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 245px), 1fr))", gap: 10, alignItems: "start" }}>
          {initialOverview.integracoes.map((integration) => {
            const config = integration.configuracao;
            const configId =
              config?.configuracao_id ??
              `${integration.catalogo.servico}--${integration.catalogo.provedor}`;
            const healthEvidence = evidence[configId];

            return (
              <article className="product-card" key={configId} style={{ padding: 12, gap: 6 }}>
                <span className="eyebrow">{integration.catalogo.provedor}</span>
                <strong>{integration.catalogo.label}</strong>
                <small>Gestão: FM / Command</small>
                <small>Estado: {stateLabel(integration)}</small>
                <small>
                  Ambiente: {config?.ambiente ?? "Ainda não configurado"}
                </small>
                <small>
                  Credenciais:{" "}
                  {integration.catalogo.credenciais_obrigatorias
                    .map(
                      (role) =>
                        `${labelForField(role)}: ${
                          config?.credenciais_estado[role]
                            ? "configurada"
                            : "ausente"
                        }`,
                    )
                    .join(" · ")}
                </small>
                {config?.evidencia_homologacao_ref ? (
                  <small>Evidência homologada registrada.</small>
                ) : null}

                {canWrite ? (
                  <form
                    className="product-create-form"
                    style={{ gap: 7, marginTop: 7 }}
                    onSubmit={(event) => void configure(event, integration)}
                  >
                    {integration.catalogo.parametros_obrigatorios.map((name) => (
                      <label key={name}>
                        {labelForField(name)}
                        <input
                          name={`param:${name}`}
                          style={{ height: 34, padding: "6px 9px" }}
                          defaultValue={defaultParameter(integration, name)}
                          autoComplete="off"
                          required
                        />
                      </label>
                    ))}
                    {integration.catalogo.credenciais_obrigatorias.map((role) => (
                      <label key={role}>
                        {labelForField(role)}
                        <input
                          name={`credential:${role}`}
                          style={{ height: 34, padding: "6px 9px" }}
                          type="password"
                          autoComplete="new-password"
                          required={!config?.credenciais_estado[role]}
                          placeholder={
                            config?.credenciais_estado[role]
                              ? "Deixe vazio para preservar a credencial atual"
                              : "Obrigatório para configurar"
                          }
                        />
                      </label>
                    ))}
                    {message && messageTarget === configId ? (
                      <p role="alert" aria-live="assertive" style={{ fontSize: 12, margin: "3px 0", color: "var(--text-primary, inherit)" }}>
                        {message}
                      </p>
                    ) : null}
                    <button
                      className="button"
                      style={{ minHeight: 36, padding: "6px 10px" }}
                      type="submit"
                      disabled={busy !== null}
                    >
                      {busy === `configure:${configId}`
                        ? "Salvando…"
                        : config
                          ? "Salvar / atualizar"
                          : "Configurar"}
                    </button>
                  </form>
                ) : null}

                {canWrite && config && integration.catalogo.healthcheck_supported ? (
                  <div>
                    <button
                      className="button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void healthcheck(integration)}
                    >
                      {busy === `healthcheck:${configId}`
                        ? "Testando…"
                        : "Executar healthcheck real"}
                    </button>
                    {healthEvidence ? (
                      <button
                        className="button"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void homologate(integration)}
                      >
                        {busy === `homologate:${configId}`
                          ? "Homologando…"
                          : "Homologar evidência"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
