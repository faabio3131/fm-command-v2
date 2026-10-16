import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AlertRuleNotFoundError,
} from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { formatDateTime } from "@/i18n/format";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { rotuloMetrica, rotuloOperadorAlerta, rotuloSeveridadeAlerta } from "@/presentation/pt-br";
import { ArchivedRuleActions } from "./archived-rule-actions";

const LIFECYCLE_KEY: Record<"created" | "disabled" | "archived", MessageKey> = {
  created: "rule.life.created",
  disabled: "rule.life.disabled",
  archived: "rule.life.archived",
};

const COMPARISON_KEY: Record<"triggered" | "clear" | "unavailable" | "incompatible", MessageKey> = {
  triggered: "rule.cmp.triggered",
  clear: "rule.cmp.clear",
  incompatible: "rule.cmp.incompatible",
  unavailable: "rule.cmp.unavailable",
};

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
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const formatDate = (value: Date) => formatDateTime(value, locale, timeZone);
  const state = t(rule.archived ? "rule.life.archived" : rule.enabled ? "rule.state.active" : "rule.life.disabled");
  const limitText = `${rotuloOperadorAlerta(rule.operator)} ${rule.threshold}`;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("rule.eyebrow")}</span>
          <h1>{rotuloMetrica(rule.metricId)}</h1>
          <p>
            {t("rule.lead", { id: rule.metricId })}
          </p>
        </div>
        <Link className="button" href="/dashboard/alerts">{t("rule.backToAlerts")}</Link>
      </header>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("rule.def.eyebrow")}</span>
            <h2>{t("rule.def.title")}</h2>
          </div>
          <p>{t("rule.def.note")}</p>
        </div>

        <div className="metric-grid">
          <article className="metric-card">
            <span className="metric-label">{t("rule.card.state")}</span>
            <strong>{state}</strong>
            <small className="metric-provenance">{t("rule.card.id", { id: rule.id })}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">{t("rule.card.metric")}</span>
            <strong>{rotuloMetrica(rule.metricId)}</strong>
            <small className="metric-provenance">{t("rule.card.scope", { scope: rule.productId ?? t("rule.card.global"), id: rule.metricId })}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">{t("rule.card.condition")}</span>
            <strong>{limitText}</strong>
            <small className="metric-provenance">{t("rule.card.severity", { value: rotuloSeveridadeAlerta(rule.severity) })}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">{t("rule.card.createdAt")}</span>
            <strong>{formatDate(rule.createdAt)}</strong>
            <small className="metric-provenance">{t("rule.card.actor", { value: rule.createdBy })}</small>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("rule.cmp.eyebrow")}</span>
            <h2>{t("rule.cmp.title")}</h2>
          </div>
          <p>{t("rule.cmp.note")}</p>
        </div>
        <div className="comparison-panel">
          <div>
            <strong>{t(COMPARISON_KEY[comparison.status])}</strong>
            <p>
              {t("rule.cmp.value", { value: currentMetric?.value ?? t("rule.cmp.unavailableValue"), limit: limitText })}
            </p>
          </div>
          <small className="metric-provenance">
            {currentMetric
              ? t("rule.cmp.source", { source: currentMetric.sourceAuthority, count: currentMetric.provenanceRefs.length })
              : t("rule.cmp.noProvenance")}
          </small>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("rule.tl.eyebrow")}</span>
            <h2>{t("rule.tl.title")}</h2>
          </div>
          <p>{t("rule.tl.note")}</p>
        </div>
        <div className="archive-timeline">
          {lifecycle.length ? lifecycle.map((event, index) => (
            <article className="alert-item" key={`${event.action}-${event.occurredAt.toISOString()}-${index}`}>
              <div>
                <strong>{t(LIFECYCLE_KEY[event.action])}</strong>
                <span>{t("rule.tl.entry", { date: formatDate(event.occurredAt), actor: event.actorId })}</span>
              </div>
              <code>{event.correlationId}</code>
            </article>
          )) : <div className="empty-state">{t("rule.tl.empty")}</div>}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("rule.occ.eyebrow")}</span>
            <h2>{t("rule.occ.title")}</h2>
          </div>
          <p>{t("rule.occ.note")}</p>
        </div>
        <div className="alert-list">
          {occurrences.length ? occurrences.map((occurrence) => (
            <article className="alert-item" key={occurrence.id}>
              <div>
                <strong>{rotuloMetrica(occurrence.metricId)} · {rotuloSeveridadeAlerta(occurrence.severity)}</strong>
                <span>
                  {t("rule.occ.detail", {
                    value: occurrence.observedValue,
                    limit: `${rotuloOperadorAlerta(occurrence.operator)} ${occurrence.threshold}`,
                    status: occurrence.status === "acknowledged" ? t("rule.occ.acknowledged") : t("rule.state.active"),
                  })}
                </span>
              </div>
              <small>{t("rule.occ.when", { date: formatDate(occurrence.occurredAt), count: occurrence.evidenceRefs.length })}</small>
            </article>
          )) : (
            <div className="empty-state">
              <strong>{t("rule.occ.emptyTitle")}</strong>
              <p>{t("rule.occ.emptyText")}</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("rule.reuse.eyebrow")}</span>
            <h2>{t("rule.reuse.title")}</h2>
          </div>
          <p>
            {t("rule.reuse.note")}
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
