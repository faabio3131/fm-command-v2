"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  KordenaBillingAction,
  KordenaBillingOverview,
  KordenaBillingProviderAccount,
} from "@/infrastructure/integration/kordena-commercial-connector";

type Props = {
  sourceId: string;
  productCode: string;
  initialOverview: KordenaBillingOverview;
  canWrite: boolean;
};

function messageForError(code?: string) {
  const messages: Record<string, string> = {
    "security.step_up_required": "Confirme sua senha novamente.",
    "integration.kordena_billing_command_failed":
      "O Command não conseguiu concluir a operação no control plane de billing.",
    "billing_provider_production_legal_entity_type_required":
      "Selecione Pessoa Física ou Pessoa Jurídica antes de ativar produção.",
    "billing_provider_activation_requires_connection_test":
      "Execute e aprove o teste de conexão antes de ativar esta conta.",
    "billing_credential_not_configured":
      "Configure as credenciais do provider antes de testar a conexão.",
    "billing_routing_scope_duplicate":
      "Já existe uma rota para este produto, método e ambiente.",
  };
  return messages[code ?? ""] ?? "A operação não pôde ser concluída.";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function statusLabel(status: KordenaBillingProviderAccount["status"]) {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    validating: "Em validação",
    active: "Ativa",
    suspended: "Suspensa",
    disabled: "Desativada",
  };
  return labels[status] ?? status;
}

export function BillingControlPanel({
  sourceId,
  productCode,
  initialOverview,
  canWrite,
}: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const providerAccounts = initialOverview.providerAccounts;
  const routingPolicies = initialOverview.routingPolicies;

  const providerByCode = useMemo(
    () =>
      new Map(
        (initialOverview.options.provider_options ?? []).map(
          (item) => [item.provider_code, item] as const,
        ),
      ),
    [initialOverview.options.provider_options],
  );

  async function command(input: {
    action: KordenaBillingAction;
    resourceId?: string;
    payload: Record<string, unknown>;
  }) {
    if (!password.trim()) {
      setMessage("Informe sua senha de confirmação para executar alterações.");
      return false;
    }
    const operation = `${input.action}:${input.resourceId ?? "new"}`;
    setBusy(operation);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/integrations/kordena-commercial/billing",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            sourceId,
            password,
            action: input.action,
            resourceId: input.resourceId,
            payload: input.payload,
          }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        setMessage(
          messageForError(
            typeof body.error === "string" ? body.error : undefined,
          ),
        );
        return false;
      }
      setPassword("");
      setMessage("Alteração registrada. Atualizando o estado do billing…");
      router.refresh();
      return true;
    } catch {
      setMessage("Não foi possível comunicar com o control plane de billing.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paymentMethods = initialOverview.options.payment_methods.filter(
      (method) => form.get(`method:${method}`) === "on",
    );
    if (paymentMethods.length === 0) {
      setMessage("Selecione pelo menos uma forma de pagamento.");
      return;
    }

    const ok = await command({
      action: "provider.create",
      payload: {
        provider_code: String(form.get("providerCode") ?? ""),
        display_name: String(form.get("displayName") ?? ""),
        legal_entity_type: String(form.get("legalEntityType") ?? ""),
        legal_entity_ref: null,
        environment: String(form.get("environment") ?? ""),
        supported_payment_methods: paymentMethods,
        supports_recurring: form.get("supportsRecurring") === "on",
        supports_webhooks: form.get("supportsWebhooks") === "on",
        priority: Number(form.get("priority") ?? "100"),
      },
    });
    if (ok) event.currentTarget.reset();
  }

  async function configureCredential(
    event: FormEvent<HTMLFormElement>,
    account: KordenaBillingProviderAccount,
  ) {
    event.preventDefault();
    const spec = providerByCode.get(account.provider_code);
    if (!spec?.credential_fields?.length) {
      setMessage("O provider não publicou campos de credencial configuráveis.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const credential: Record<string, string> = {};
    for (const field of spec.credential_fields) {
      const value = String(form.get(field.key) ?? "").trim();
      if (!value) {
        setMessage(`Preencha o campo ${field.label}.`);
        return;
      }
      credential[field.key] = value;
    }
    const ok = await command({
      action: "provider.credential",
      resourceId: account.provider_account_id,
      payload: {
        expected_version: account.version,
        credential: JSON.stringify(credential),
      },
    });
    if (ok) event.currentTarget.reset();
  }

  async function createRouting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await command({
      action: "routing.create",
      payload: {
        product_code: productCode,
        payment_method: String(form.get("paymentMethod") ?? ""),
        environment: String(form.get("environment") ?? ""),
        requires_recurring: form.get("requiresRecurring") === "on",
        requires_webhooks: form.get("requiresWebhooks") === "on",
        primary_provider_account_id: String(
          form.get("primaryProviderAccountId") ?? "",
        ),
        fallback_provider_account_ids: [],
      },
    });
  }

  return (
    <>
      <section className="panel">
        <h2>Confirmação administrativa</h2>
        <p>
          Alterações de billing exigem sua senha e step-up fresco. A senha não é
          armazenada pelo painel.
        </p>
        <label>
          Senha de confirmação
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={!canWrite}
          />
        </label>
        {message ? <p role="status">{message}</p> : null}
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Conta recebedora</span>
            <h2>Providers configurados</h2>
          </div>
          <p>
            Uma conta pode existir em rascunho sem credenciais. Produção só deve
            ser ativada depois da configuração e do teste de conexão.
          </p>
        </div>

        {providerAccounts.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma conta recebedora configurada.</strong>
            <p>Crie a conta quando estiver pronto para vincular o provider.</p>
          </div>
        ) : (
          <div className="product-grid">
            {providerAccounts.map((account) => {
              const spec = providerByCode.get(account.provider_code);
              const operationPrefix = account.provider_account_id;
              return (
                <article className="product-card" key={account.provider_account_id}>
                  <span className="eyebrow">{account.provider_code}</span>
                  <strong>{account.display_name}</strong>
                  <small>
                    Titular:{" "}
                    {account.legal_entity_type === "individual"
                      ? "Pessoa Física"
                      : account.legal_entity_type === "company"
                        ? "Pessoa Jurídica"
                        : "Não configurado"}
                  </small>
                  <small>Ambiente: {account.environment}</small>
                  <small>Status: {statusLabel(account.status)}</small>
                  <small>
                    Credencial:{" "}
                    {account.credential_configured ? "Configurada" : "Ausente"}
                  </small>
                  <small>
                    Último teste:{" "}
                    {account.last_test_status === "pass"
                      ? "Aprovado"
                      : account.last_test_status === "fail"
                        ? "Falhou"
                        : "Não executado"}
                  </small>

                  {canWrite && spec?.credential_fields?.length ? (
                    <form
                      className="product-create-form"
                      onSubmit={(event) =>
                        void configureCredential(event, account)
                      }
                    >
                      <strong>Credenciais do provider</strong>
                      {spec.credential_fields.map((field) => (
                        <label key={field.key}>
                          {field.label}
                          <input
                            name={field.key}
                            type={field.secret ? "password" : "text"}
                            autoComplete="off"
                            required
                          />
                        </label>
                      ))}
                      <button
                        className="button"
                        type="submit"
                        disabled={
                          busy === `provider.credential:${operationPrefix}`
                        }
                      >
                        {busy === `provider.credential:${operationPrefix}`
                          ? "Salvando…"
                          : account.credential_configured
                            ? "Rotacionar credenciais"
                            : "Salvar credenciais"}
                      </button>
                    </form>
                  ) : null}

                  {canWrite ? (
                    <div>
                      <button
                        className="button"
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void command({
                            action: "provider.test",
                            resourceId: account.provider_account_id,
                            payload: {
                              expected_version: account.version,
                              timeout_seconds: 10,
                            },
                          })
                        }
                      >
                        Testar conexão
                      </button>
                      {account.status !== "active" ? (
                        <button
                          className="button"
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void command({
                              action: "provider.status",
                              resourceId: account.provider_account_id,
                              payload: {
                                expected_version: account.version,
                                status: "active",
                              },
                            })
                          }
                        >
                          Ativar
                        </button>
                      ) : (
                        <button
                          className="button"
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void command({
                              action: "provider.status",
                              resourceId: account.provider_account_id,
                              payload: {
                                expected_version: account.version,
                                status: "suspended",
                              },
                            })
                          }
                        >
                          Suspender
                        </button>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {canWrite ? (
        <section className="executive-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Nova conta</span>
              <h2>Configurar provider de recebimento</h2>
            </div>
            <p>
              Os campos disponíveis vêm do backend. Nenhum provider é fixado no
              formulário.
            </p>
          </div>
          <form className="product-create-form" onSubmit={createProvider}>
            <label>
              Provider
              <select name="providerCode" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {initialOverview.options.provider_codes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome da conta
              <input
                name="displayName"
                required
                maxLength={128}
                placeholder="Conta recebedora principal"
              />
            </label>
            <label>
              Tipo do titular
              <select name="legalEntityType" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {initialOverview.options.legal_entity_types.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ambiente
              <select name="environment" required defaultValue="sandbox">
                {initialOverview.options.environments.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment === "production" ? "Produção" : "Sandbox"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <input
                name="priority"
                type="number"
                min={0}
                max={100000}
                defaultValue={100}
                required
              />
            </label>
            <fieldset>
              <legend>Formas de pagamento</legend>
              {initialOverview.options.payment_methods.map((method) => (
                <label key={method}>
                  <input name={`method:${method}`} type="checkbox" />
                  {method}
                </label>
              ))}
            </fieldset>
            <label>
              <input name="supportsRecurring" type="checkbox" defaultChecked />
              Recorrência
            </label>
            <label>
              <input name="supportsWebhooks" type="checkbox" defaultChecked />
              Webhooks
            </label>
            <button className="button" type="submit" disabled={busy !== null}>
              Criar conta em rascunho
            </button>
          </form>
        </section>
      ) : null}

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Roteamento</span>
            <h2>Recebimento por produto</h2>
          </div>
          <p>
            A política liga {productCode} à conta recebedora sem misturar a
            receita de outros produtos.
          </p>
        </div>

        {routingPolicies.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma rota de billing configurada.</strong>
            <p>A contratação permanece fail-closed até existir rota válida.</p>
          </div>
        ) : (
          <div className="product-grid">
            {routingPolicies.map((policy) => (
              <article className="product-card" key={policy.routing_policy_id}>
                <span className="eyebrow">{policy.product_code}</span>
                <strong>{policy.payment_method}</strong>
                <small>Ambiente: {policy.environment}</small>
                <small>
                  Provider principal: {policy.primary_provider_account_id}
                </small>
                <small>Status: {policy.active ? "Ativa" : "Inativa"}</small>
              </article>
            ))}
          </div>
        )}

        {canWrite && providerAccounts.length > 0 ? (
          <form className="product-create-form" onSubmit={createRouting}>
            <label>
              Forma de pagamento
              <select name="paymentMethod" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {initialOverview.options.payment_methods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ambiente
              <select name="environment" required defaultValue="sandbox">
                {initialOverview.options.environments.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment === "production" ? "Produção" : "Sandbox"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Conta principal
              <select name="primaryProviderAccountId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {providerAccounts.map((account) => (
                  <option
                    key={account.provider_account_id}
                    value={account.provider_account_id}
                  >
                    {account.display_name} · {statusLabel(account.status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input name="requiresRecurring" type="checkbox" defaultChecked />
              Exigir recorrência
            </label>
            <label>
              <input name="requiresWebhooks" type="checkbox" defaultChecked />
              Exigir webhooks
            </label>
            <button className="button" type="submit" disabled={busy !== null}>
              Criar rota para {productCode}
            </button>
          </form>
        ) : null}
      </section>
    </>
  );
}
