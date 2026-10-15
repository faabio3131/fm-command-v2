import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { AlertControlPanel } from "./alert-control-panel";

export default async function AlertsPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const [overview, products] = await Promise.all([
    buildAlertService().overview(context),
    new ProductRegistryService(new PostgresProductRepository()).list(context),
  ]);

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">F17 · Alertas e Automações Governadas</span>
          <h1>Central de atenção governada</h1>
          <p>Regras explícitas geram alertas determinísticos. Valor desconhecido nunca vira zero e a saída do Core nunca vira autorização.</p>
        </div>
        <Link href="/dashboard">Voltar</Link>
      </header>

      <section className="guardrail-grid" aria-label="Governança de alertas">
        <article><span className="eyebrow">Detecção</span><strong>Determinística</strong><p>Métrica governada + operador + limite configurado.</p></article>
        <article><span className="eyebrow">Idempotência</span><strong>Identificador único + bloqueio</strong><p>A mesma observação não gera ocorrência duplicada.</p></article>
        <article><span className="eyebrow">Ações</span><strong>Prévia somente</strong><p>Nenhum efeito externo crítico é executado na F17.</p></article>
        <article><span className="eyebrow">Auditoria</span><strong>Obrigatória</strong><p>Regra, ocorrência, reconhecimento e intenção ficam rastreáveis.</p></article>
      </section>

      <AlertControlPanel
        rules={overview.rules}
        occurrences={overview.occurrences}
        products={products.map(({ id, name }) => ({ id, name }))}
        metrics={METRIC_REGISTRY.map(({ metricId, displayName }) => ({ metricId, displayName }))}
        canWrite={roleHasPermission(context.role, "alert:write")}
        canPrepare={roleHasPermission(context.role, "action:prepare")}
      />
    </main>
  );
}
