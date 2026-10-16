"use client";

import { useMemo, useState } from "react";

const ACTIONS = [
  "plan_version.create",
  "plan_version.validate",
  "plan_version.publish",
  "price.create",
  "price.validate",
  "price.publish",
  "promotion.create",
  "promotion_version.create",
  "promotion_version.validate",
  "promotion_version.publish",
] as const;

type Action = (typeof ACTIONS)[number];

const ACTION_LABELS: Record<Action, string> = {
  "plan_version.create": "Criar versão de plano",
  "plan_version.validate": "Validar versão de plano",
  "plan_version.publish": "Publicar versão de plano",
  "price.create": "Criar preço",
  "price.validate": "Validar preço",
  "price.publish": "Publicar preço",
  "promotion.create": "Criar promoção",
  "promotion_version.create": "Criar versão de promoção",
  "promotion_version.validate": "Validar versão de promoção",
  "promotion_version.publish": "Publicar versão de promoção",
};

function previewAction(action: Action) {
  if (action === "plan_version.publish") return "plan_version.preview";
  if (action === "price.publish") return "price.preview";
  if (action === "promotion_version.publish") {
    return "promotion_version.preview";
  }
  return null;
}

function mensagemFalha(codigo: string, statusHttp?: number) {
  const conhecido: Record<string, string> = {
    "security.step_up_required": "A reautenticação por senha é obrigatória.",
    "security.permission_denied:commercial:write": "Seu papel não possui permissão para alteração comercial.",
    "commercial.approval_required": "Visualize e aprove a prévia antes de publicar.",
    "commercial.approval_invalid": "A aprovação da publicação não é válida.",
    "commercial.approval_expired": "A aprovação expirou. Gere uma nova prévia.",
    "commercial.approval_already_used": "Essa aprovação já foi utilizada. Gere uma nova prévia.",
    "commercial.approval_context_required": "A prévia precisa estar vinculada aos dados que serão publicados.",
    "integration.kordena_command_failed": "O Kordena não conseguiu processar o comando comercial.",
  };
  const mensagem = conhecido[codigo] ?? "A operação comercial foi recusada.";
  return statusHttp
    ? `${mensagem} Código técnico: ${codigo} · HTTP ${statusHttp}.`
    : `${mensagem} Código técnico: ${codigo}.`;
}

export function KordenaCommercialAdminForm(props: { sourceId: string }) {
  const [action, setAction] = useState<Action>("plan_version.create");
  const [resourceId, setResourceId] = useState("KORDENA_PLAN_A");
  const [payload, setPayload] = useState(
    JSON.stringify(
      {
        display_name: "Plano A",
        description: "Nova versão comercial",
        trial_eligible: true,
        marketing_badge: null,
        metadata: {},
        entitlements: [],
        change_reason: "Alteração administrativa via FMCC",
      },
      null,
      2,
    ),
  );
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [approvalExpiresAt, setApprovalExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requiredPreview = useMemo(() => previewAction(action), [action]);

  function invalidatePreview() {
    setPreview(null);
    setApprovalToken(null);
    setApprovalExpiresAt(null);
    setStatus(null);
  }

  async function send(
    selectedAction: string,
    selectedPayload: Record<string, unknown>,
    options?: {
      approvalToken?: string;
    },
  ) {
    const response = await fetch(
      "/api/integrations/kordena-commercial/commands",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          sourceId: props.sourceId,
          password,
          action: selectedAction,
          resourceId: resourceId.trim() || undefined,
          payload: selectedPayload,
          approvalToken: options?.approvalToken,
        }),
      },
    );
    const body = (await response.json()) as Record<string, unknown> & {
      error?: string;
      approval?: {
        token?: unknown;
        expiresAt?: unknown;
      };
    };
    if (!response.ok) {
      const code = body.error ?? "commercial.operation_failed";
      throw new Error(mensagemFalha(code, response.status));
    }
    return body;
  }

  function parsePayload(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setStatus("Os dados da operação precisam ser um objeto JSON.");
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setStatus("Os dados da operação não formam um JSON válido.");
      return null;
    }
  }

  async function showPreview() {
    if (!requiredPreview) return;
    const proposedPayload = parsePayload();
    if (!proposedPayload) return;

    setBusy(true);
    setStatus(null);
    try {
      const body = await send(requiredPreview, proposedPayload);
      const token = body.approval?.token;
      const expiresAt = body.approval?.expiresAt;
      if (typeof token !== "string" || typeof expiresAt !== "string") {
        throw new Error("A prévia foi retornada sem uma aprovação governada válida.");
      }
      setPreview(JSON.stringify(body.result ?? body, null, 2));
      setApprovalToken(token);
      setApprovalExpiresAt(expiresAt);
      setStatus(
        `Prévia canônica carregada e vinculada a esta publicação. Aprovação válida até ${new Date(expiresAt).toLocaleTimeString("pt-BR")}.`,
      );
    } catch (error) {
      setPreview(null);
      setApprovalToken(null);
      setApprovalExpiresAt(null);
      setStatus(error instanceof Error ? error.message : "Não foi possível carregar a prévia.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePayload();
    if (!parsed) return;

    if (requiredPreview && (!preview || !approvalToken)) {
      setStatus("Visualize a prévia canônica antes de confirmar a publicação.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      await send(action, parsed, {
        approvalToken: approvalToken ?? undefined,
      });
      setStatus("Comando aceito pela autoridade comercial canônica.");
      setPassword("");
      setPreview(null);
      setApprovalToken(null);
      setApprovalExpiresAt(null);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Os dados são inválidos ou o comando não pôde ser enviado.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <span className="eyebrow">Administração governada</span>
      <h2>Comando comercial Kordena</h2>
      <p>
        Toda alteração exige reautenticação por senha e é encaminhada para a
        Plataforma Comercial canônica. Publicações de alto risco exigem uma
        prévia aprovada pelo servidor antes da confirmação.
      </p>
      <label>
        Ação
        <select
          value={action}
          onChange={(event) => {
            setAction(event.target.value as Action);
            invalidatePreview();
          }}
        >
          {ACTIONS.map((value) => (
            <option key={value} value={value}>
              {ACTION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Identificador do recurso
        <input
          value={resourceId}
          onChange={(event) => {
            setResourceId(event.target.value);
            invalidatePreview();
          }}
        />
      </label>
      <label>
        Dados canônicos da operação (JSON)
        <textarea
          rows={14}
          value={payload}
          onChange={(event) => {
            setPayload(event.target.value);
            invalidatePreview();
          }}
        />
      </label>
      <label>
        Confirme sua senha
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            invalidatePreview();
          }}
          required
        />
      </label>
      {requiredPreview ? (
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void showPreview()}
        >
          {busy ? "Carregando…" : "Visualizar prévia antes de publicar"}
        </button>
      ) : null}
      {preview ? (
        <pre className="card" aria-label="Prévia canônica das alterações">
          {preview}
        </pre>
      ) : null}
      {approvalExpiresAt ? (
        <small>
          Aprovação server-side temporária vinculada a esta operação. Alterar
          ação, recurso, dados ou senha invalida a prévia.
        </small>
      ) : null}
      <button
        className="button primary"
        type="submit"
        disabled={busy || Boolean(requiredPreview && !approvalToken)}
      >
        {busy ? "Confirmando…" : "Reautenticar e confirmar"}
      </button>
      {status ? <p role="status">{status}</p> : null}
    </form>
  );
}
