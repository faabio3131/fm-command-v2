import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { KordenaPlatformIntegrationControlService } from "@/application/integration/kordena-platform-integration-control-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { KORDENA_COMMERCIAL_SOURCE_TYPE } from "@/infrastructure/integration/kordena-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { PlatformIntegrationsControlPanel } from "./platform-integrations-control-panel";

export default async function PlatformIntegrationsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "integration:read")) {
    redirect("/dashboard");
  }

  const sourceService = new SourceRegistryService(
    new PostgresSourceRepository(),
    new PostgresProductRepository(),
  );
  const sources = await sourceService.list(context);
  const source = sources.find(
    (item) => item.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
  );

  let overview = null;
  let upstreamError: string | null = null;
  if (source) {
    try {
      overview = await new KordenaPlatformIntegrationControlService().overview(
        context,
        source.id,
      );
    } catch {
      upstreamError =
        "O Kordena está conectado ao Command, mas o control plane de APIs de plataforma não respondeu.";
    }
  }

  const canWrite =
    roleHasPermission(context.role, "integration:write") &&
    (context.role === "owner" || context.role === "admin");

  return (
    <main className="dashboard-shell dashboard-shell-compact settings-compact" style={{ paddingTop: 10 }}>
      <header className="dashboard-header" style={{ marginBottom: 8, paddingBottom: 8 }}>
        <div>
          <span className="eyebrow">Command · Control Center</span>
          <h1>Infraestrutura & APIs</h1>
          <p>
            Credenciais e modelos operados pela FM Tecnologia. Segredos são
            enviados somente ao backend, armazenados no Vault canônico do produto
            e nunca são exibidos novamente.
          </p>
        </div>
        <Link href="/dashboard/settings">Voltar às configurações</Link>
      </header>

      <section className="foundation-grid" aria-label="Princípios do control plane" style={{ marginBottom: 8, gap: 6 }}>
        <article>
          <strong>Autoridade FM</strong>
          <span>OpenAI, Gemini e Maps são platform-managed</span>
        </article>
        <article>
          <strong>Segredos</strong>
          <span>Vault canônico; nunca em repositório ou interface do cliente</span>
        </article>
        <article>
          <strong>Homologação</strong>
          <span>Configurar → healthcheck real → evidência → homologar</span>
        </article>
        <article>
          <strong>Escopo</strong>
          <span>Consumo continua medido por tenant e unidade do produto</span>
        </article>
      </section>

      {!source ? (
        <section className="panel">
          <h2>Kordena não conectado</h2>
          <p>
            A fonte comercial Kordena precisa estar conectada antes de administrar
            as APIs de plataforma. Nenhuma credencial será criada fora do control
            plane canônico.
          </p>
        </section>
      ) : overview ? (
        <PlatformIntegrationsControlPanel
          sourceId={source.id}
          initialOverview={overview}
          canWrite={canWrite}
        />
      ) : (
        <section className="panel">
          <h2>Control plane indisponível</h2>
          <p>{upstreamError}</p>
        </section>
      )}
    </main>
  );
}
