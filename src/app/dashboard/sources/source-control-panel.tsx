"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ProductOption = {
  id: string;
  name: string;
  slug: string;
};

type SourceView = {
  id: string;
  productId?: string;
  name: string;
  sourceType: string;
  authoritativeDomain: string;
  status: string;
  syncMode: string;
  freshnessSeconds?: number;
  hasSecretReference: boolean;
  baseUrl?: string;
  lastAttemptAt?: string;
  lastAttemptStatus?: string;
  lastSuccessfulSyncAt?: string;
};

type Props = {
  products: ProductOption[];
  sources: SourceView[];
  canWrite: boolean;
};

const CONFIGURED_PRODUCTS = {
  kordena: {
    title: "Conectar Kordena",
    name: "Kordena Commercial",
    sourceType: "kordena-commercial-v1",
    secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
    urlLabel: "URL HTTPS do Kordena",
    placeholder: "https://seu-kordena.exemplo.com",
  },
  iron: {
    title: "Conectar IRON FIT CORE",
    name: "IRON FIT CORE Commercial",
    sourceType: "iron-commercial-v1",
    secretRef: "env:FMCC_IRON_CONTROL_PLANE_TOKEN",
    urlLabel: "URL HTTPS do backend IRON",
    placeholder: "https://gym-saas-backend-t9ej.onrender.com",
  },
} as const;

type SupportedProduct = keyof typeof CONFIGURED_PRODUCTS;

type SourceState = {
  health?: string;
  sync?: string;
};

function rotuloSaude(status: string) {
  if (status === "healthy") return "Saudável";
  if (status === "degraded") return "Degradada";
  if (status === "unavailable") return "Indisponível";
  if (status === "configured") return "Configurada — ainda não testada";
  return "Desconhecida";
}

function rotuloSync(status?: string) {
  if (status === "completed") return "Concluída";
  if (status === "running") return "Em andamento";
  if (status === "failed") return "Falhou";
  return "Nunca executada";
}

function dataHora(value?: string) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function mensagemErro(codigo?: string) {
  const conhecido: Record<string, string> = {
    "integration.source_definition_invalid": "A definição da fonte é inválida.",
    "integration.product_scope_invalid": "O produto selecionado não é válido ou não está ativo.",
    "integration.product_source_binding_invalid": "A integração não corresponde ao produto ou à credencial configurada.",
    "integration.secret_reference_invalid": "A referência de segredo da fonte é inválida.",
    "integration.sync_failed": "A sincronização falhou ou a configuração externa ainda não está pronta.",
    "integration.health_failed": "Não foi possível consultar a saúde da integração.",
    "security.permission_denied:source:write": "Seu papel não pode cadastrar fontes.",
    "security.permission_denied:integration:write": "Seu papel não pode sincronizar fontes.",
  };
  return conhecido[codigo ?? ""] ?? "A operação não pôde ser concluída.";
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function SourceControlPanel({ products, sources, canWrite }: Props) {
  const router = useRouter();
  const [selectedProductId, setSelectedProductId] = useState("");
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const selection = selectedProduct && selectedProduct.slug in CONFIGURED_PRODUCTS
    ? CONFIGURED_PRODUCTS[selectedProduct.slug as SupportedProduct]
    : null;
  const alreadyRegistered = sources.some((source) =>
    source.productId === selectedProductId && source.sourceType === selection?.sourceType
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SourceState>>({});

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const productId = String(form.get("productId") ?? "").trim();
    const baseUrl = String(form.get("baseUrl") ?? "").trim();
    const freshnessSeconds = Number(form.get("freshnessSeconds") ?? "300");

    const product = products.find((item) => item.id === productId);
    const config = product && product.slug in CONFIGURED_PRODUCTS
      ? CONFIGURED_PRODUCTS[product.slug as SupportedProduct]
      : null;
    if (!config || !baseUrl || sources.some((item) =>
      item.productId === productId && item.sourceType === config.sourceType
    )) {
      setMessage("Selecione uma integração suportada e ainda não cadastrada.");
      return;
    }
    setBusy("register");
    setMessage(null);
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId,
          name: config.name,
          sourceType: config.sourceType,
          authoritativeDomain: "commercial",
          syncMode: "pull",
          secretRef: config.secretRef,
          mappingVersion: config.sourceType,
          freshnessSeconds,
          config: { baseUrl },
        }),
      });
      const body = await json(response);
      if (!response.ok) {
        setMessage(mensagemErro(typeof body.error === "string" ? body.error : undefined));
        return;
      }
      formElement.reset();
      setSelectedProductId("");
      setMessage(`Fonte ${product?.name ?? "comercial"} cadastrada. Teste a conexão antes de sincronizar.`);
      router.refresh();
    } catch {
      setMessage("Não foi possível cadastrar a fonte.");
    } finally {
      setBusy(null);
    }
  }

  async function health(sourceId: string) {
    setBusy(`health:${sourceId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/health`, {
        cache: "no-store",
      });
      const body = await json(response);
      if (!response.ok) {
        const error = typeof body.error === "string" ? body.error : undefined;
        setStates((current) => ({
          ...current,
          [sourceId]: { ...current[sourceId], health: mensagemErro(error) },
        }));
        return;
      }
      const status = typeof body.status === "string" ? body.status : "unknown";
      setStates((current) => ({
        ...current,
        [sourceId]: {
          ...current[sourceId],
          health: `Saúde: ${rotuloSaude(status)}`,
        },
      }));
      router.refresh();
    } catch {
      setStates((current) => ({
        ...current,
        [sourceId]: {
          ...current[sourceId],
          health: "Saúde: não foi possível consultar.",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function sync(sourceId: string) {
    setBusy(`sync:${sourceId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/sync`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      const body = await json(response);
      if (!response.ok) {
        const error = typeof body.error === "string" ? body.error : undefined;
        setStates((current) => ({
          ...current,
          [sourceId]: { ...current[sourceId], sync: mensagemErro(error) },
        }));
        return;
      }
      const status = typeof body.status === "string" ? body.status : "completed";
      const ingested = typeof body.ingested === "number" ? body.ingested : 0;
      const label = status === "duplicate"
        ? "Sincronização já processada para esta chave."
        : status === "in_progress"
          ? "Sincronização já está em andamento."
          : `Sincronização concluída: ${ingested} fato(s) canônico(s) ingerido(s).`;
      setStates((current) => ({
        ...current,
        [sourceId]: { ...current[sourceId], sync: label },
      }));
      router.refresh();
    } catch {
      setStates((current) => ({
        ...current,
        [sourceId]: {
          ...current[sourceId],
          sync: "A sincronização não pôde ser concluída.",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canWrite ? (
        <section className="executive-section" aria-labelledby="source-register-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Cadastro governado</span>
              <h2 id="source-register-title">{selection?.title ?? "Conectar produto"}</h2>
            </div>
            <p>
              O navegador grava somente URL e referência do segredo. O valor real
              do segredo permanece exclusivamente no runtime do servidor.
            </p>
          </div>

          {products.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhum produto ativo disponível.</strong>
              <p>Cadastre primeiro um produto no dashboard.</p>
            </div>
          ) : (
            <form className="product-create-form" onSubmit={register}>
              <label>
                Produto
                <select name="productId" required value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                  <option value="" disabled>Selecione o produto</option>
                  {products.filter((product) => product.slug in CONFIGURED_PRODUCTS).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.slug})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {selection?.urlLabel ?? "URL HTTPS do produto"}
                <input
                  name="baseUrl"
                  type="url"
                  required
                  pattern="https://.*"
                  placeholder={selection?.placeholder ?? "Selecione um produto suportado"}
                  autoComplete="off"
                  disabled={!selection || alreadyRegistered}
                />
              </label>
              <label>
                Atualidade esperada (segundos)
                <input
                  name="freshnessSeconds"
                  type="number"
                  min={30}
                  max={86400}
                  defaultValue={300}
                  required
                />
              </label>
              {alreadyRegistered ? <p role="status">Esta fonte já está registrada. Use a seção de saúde e sincronização abaixo.</p> : null}
              <button className="button" type="submit" disabled={busy === "register" || !selection || alreadyRegistered}>
                {busy === "register" ? "Cadastrando…" : "Cadastrar fonte"}
              </button>
            </form>
          )}
          {message ? <p role="status">{message}</p> : null}
        </section>
      ) : null}

      <section className="executive-section" aria-labelledby="source-list-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Fontes registradas</span>
            <h2 id="source-list-title">Saúde e sincronização</h2>
          </div>
          <p>
            Uma fonte cadastrada não é considerada conectada até que saúde,
            autenticação e ingestão real sejam comprovadas.
          </p>
        </div>

        {sources.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma fonte configurada.</strong>
            <p>O FMCC permanecerá exibindo dados ausentes como indisponíveis.</p>
          </div>
        ) : (
          <div className="product-grid">
            {sources.map((source) => (
              <article className="product-card" key={source.id}>
                <span className="eyebrow">{source.authoritativeDomain}</span>
                <strong>{source.name}</strong>
                <small>Tipo técnico: {source.sourceType}</small>
                <small>Modo: {source.syncMode === "pull" ? "Consulta periódica" : source.syncMode}</small>
                <small>Referência de segredo: {source.hasSecretReference ? "Configurada por referência" : "Ausente"}</small>
                <small>Saúde persistida: {rotuloSaude(source.status)}</small>
                <small>Último sync bem-sucedido: {dataHora(source.lastSuccessfulSyncAt)}</small>
                <small>
                  Última tentativa: {dataHora(source.lastAttemptAt)} · {rotuloSync(source.lastAttemptStatus)}
                </small>
                {source.baseUrl ? <small>Origem: {source.baseUrl}</small> : null}
                <div>
                  <button
                    className="button"
                    type="button"
                    disabled={busy === `health:${source.id}`}
                    onClick={() => void health(source.id)}
                  >
                    {busy === `health:${source.id}` ? "Testando…" : "Testar conexão"}
                  </button>
                  {canWrite ? (
                    <button
                      className="button"
                      type="button"
                      disabled={busy === `sync:${source.id}`}
                      onClick={() => void sync(source.id)}
                    >
                      {busy === `sync:${source.id}` ? "Sincronizando…" : "Sincronizar agora"}
                    </button>
                  ) : null}
                </div>
                {states[source.id]?.health ? <small role="status">{states[source.id]?.health}</small> : null}
                {states[source.id]?.sync ? <small role="status">{states[source.id]?.sync}</small> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
