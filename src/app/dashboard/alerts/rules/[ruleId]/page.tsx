import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AlertRuleNotFoundError,
} from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { rotuloMetrica, rotuloOperadorAlerta, rotuloSeveridadeAlerta } from "@/presentation/pt-br";
import { ArchivedRuleActions } from "./archived-rule-actions";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

function lifecycleLabel(action: "created" | "disabled" | "archived") {
  if (action === "created") return "Criada";
  if (action === "disabled") return "Desativada";
  return "Arquivada";
}

function comparisonLabel(status: "triggered" | "clear" | "unavailable" | "incompatible") {
  if (status === "triggered") return "A condição seria atingida com o valor atual";
  if (status === "clear") return "A condição não seria atingida com o valor atual";
  if (status === "incompatible") return "Valor atual incompatível com o limite";
  return "Comparação indisponível por ausência/atualidade da evidência";
}

export default async function ArchivedRulePage({ params }: { params: Promise<{ ruleId: string }> }) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const { ruleId } = await params;
  let detail;
  try {
    detail = await buildAlertService().ruleDetail(context, ruleId);
  } catch (error) {
    if (error instanceof AlertRuleNotFoundError) notFound();
    throw error;
  }

  const { rule, lifecycle, occurrences, currentMetric, comparison } = detail;
  const state = rule.archived ? "Arquivada" : rule.enabled ? "Ativa" : "Desativada";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Arquivo governado de regra</span>
          <h1>{rotuloMetrica(rule.metricId)}</h1>
          <p>
            Registro preservado em modo somente leitura. Arquivar não apaga histórico
            e esta tela não gera ocorrências. Identificador técnico: <code>{rule.metricId}</code>.
          </p>
        </div>
        <Link className="button" href="/dashboard/alerts">Voltar para alertas</Link>
      </header>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Definição preservada</span>
            <h2>Regra</h2>
          </div>
          <p>O registro original permanece imutável para auditoria e comparação.</p>
        </div>

        <div className="metric-grid">
          <article className="metric-card">
            <span className="metric-label">Estado</span>
            <strong>{state}</strong>
            <small className="metric-provenance">ID: {rule.id}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">Métrica</span>
            <strong>{rotuloMetrica(rule.metricId)}</strong>
            <small className="metric-provenance">Escopo: {rule.productId ?? "Global"} · identificador técnico: {rule.metricId}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">Condição</span>
            <strong>{rotuloOperadorAlerta(rule.operator)} {rule.threshold}</strong>
            <small className="metric-provenance">Severidade: {rotuloSeveridadeAlerta(rule.severity)}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">Criada em</span>
            <strong>{formatDate(rule.createdAt)}</strong>
            <small className="metric-provenance">Ator: {rule.createdBy}</small>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Comparação atual</span>
            <h2>Somente leitura</h2>
          </div>
          <p>Nenhum alerta é criado por esta comparação do arquivo.</p>
        </div>
        <div className="comparison-panel">
          <div>
            <strong>{comparisonLabel(comparison.status)}</strong>
            <p>
              Valor governado atual: {currentMetric?.value ?? "Indisponível"} ·
              limite arquivado: {rotuloOperadorAlerta(rule.operator)} {rule.threshold}
            </p>
          </div>
          <small className="metric-provenance">
            {currentMetric
              ? `Fonte: ${currentMetric.sourceAuthority} · referências: ${currentMetric.provenanceRefs.length}`
              : "Sem proveniência factual atual disponível"}
          </small>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Linha do tempo</span>
            <h2>Auditoria da regra</h2>
          </div>
          <p>Eventos persistidos no Registro de Auditoria para esta regra.</p>
        </div>
        <div className="archive-timeline">
          {lifecycle.length ? lifecycle.map((event, index) => (
            <article className="alert-item" key={`${event.action}-${event.occurredAt.toISOString()}-${index}`}>
              <div>
                <strong>{lifecycleLabel(event.action)}</strong>
                <span>{formatDate(event.occurredAt)} · ator {event.actorId}</span>
              </div>
              <code>{event.correlationId}</code>
            </article>
          )) : <div className="empty-state">Nenhum evento do ciclo de vida encontrado.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Histórico operacional</span>
            <h2>Ocorrências vinculadas</h2>
          </div>
          <p>Somente ocorrências realmente persistidas para esta regra são exibidas.</p>
        </div>
        <div className="alert-list">
          {occurrences.length ? occurrences.map((occurrence) => (
            <article className="alert-item" key={occurrence.id}>
              <div>
                <strong>{rotuloMetrica(occurrence.metricId)} · {rotuloSeveridadeAlerta(occurrence.severity)}</strong>
                <span>
                  Valor observado {occurrence.observedValue} · limite {rotuloOperadorAlerta(occurrence.operator)} {occurrence.threshold}
                  · {occurrence.status === "acknowledged" ? "Reconhecida" : "Ativa"}
                </span>
              </div>
              <small>{formatDate(occurrence.occurredAt)} · evidências {occurrence.evidenceRefs.length}</small>
            </article>
          )) : (
            <div className="empty-state">
              <strong>Nenhuma ocorrência histórica.</strong>
              <p>A regra pode ter sido arquivada sem nunca ter produzido um alerta real.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Reutilização governada</span>
            <h2>Usar como modelo</h2>
          </div>
          <p>
            O arquivo permanece imutável. Se esta configuração voltar a ser necessária,
            uma nova regra é criada e auditada separadamente.
          </p>
        </div>
        <ArchivedRuleActions
          metricId={rule.metricId}
          productId={rule.productId}
          operator={rule.operator}
          threshold={rule.threshold}
          severity={rule.severity}
        />
      </section>
    </main>
  );
}
