import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import {
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { SourceControlPanel } from "./source-control-panel";

export default async function SourcesPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }
    if (error instanceof TenantScopeRequiredError) {
      redirect("/onboarding");
    }
    throw error;
  }

  if (!roleHasPermission(context.role, "source:read")) {
    redirect("/dashboard");
  }

  const sourceRepository = new PostgresSourceRepository();
  const sourceService = new SourceRegistryService(
    sourceRepository,
    new PostgresProductRepository(),
  );
  const productService = new ProductRegistryService(
    new PostgresProductRepository(),
  );
  const syncRepository = new PostgresSyncRepository();

  const [sources, products] = await Promise.all([
    sourceService.list(context),
    productService.list(context),
  ]);

  const operationalStates = new Map(
    await Promise.all(
      sources.map(async (source) => [
        source.id,
        await syncRepository.operationalState(
          context.tenantId,
          source.id,
        ),
      ] as const),
    ),
  );

  const safeSources = sources.map((source) => {
    const operational = operationalStates.get(source.id);
    return {
      id: source.id,
      productId: source.productId,
      name: source.name,
      sourceType: source.sourceType,
      authoritativeDomain: source.authoritativeDomain,
      status: source.status,
      syncMode: source.syncMode,
      freshnessSeconds: source.freshnessSeconds,
      hasSecretReference: Boolean(source.secretRef),
      baseUrl:
        typeof source.config.baseUrl === "string"
          ? source.config.baseUrl
          : undefined,
      lastAttemptAt: operational?.lastAttemptAt?.toISOString(),
      lastAttemptStatus: operational?.lastAttemptStatus,
      lastSuccessfulSyncAt:
        operational?.lastSuccessfulAt?.toISOString(),
    };
  });

  const activeProducts = products
    .filter((product) => product.status === "active")
    .map(({ id, name, slug }) => ({
      id,
      name,
      slug,
    }));

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Malha de Integrações</span>
          <h1>Fontes e Integrações</h1>
          <p>
            Cadastro, teste de saúde e sincronização de fontes
            governadas. Nenhuma fonte é considerada conectada apenas
            por estar cadastrada.
          </p>
        </div>
        <Link className="button" href="/dashboard">
          Voltar
        </Link>
      </header>

      <section
        className="foundation-grid"
        aria-label="Princípios das integrações"
      >
        <article>
          <strong>Segredos</strong>
          <span>Somente por referência no servidor</span>
        </article>
        <article>
          <strong>Isolamento</strong>
          <span>Organização validada antes de acessar a fonte</span>
        </article>
        <article>
          <strong>Ingestão</strong>
          <span>Fatos canônicos com idempotência</span>
        </article>
        <article>
          <strong>Ausência</strong>
          <span>Nunca convertida em zero</span>
        </article>
      </section>

      <SourceControlPanel
        products={activeProducts}
        sources={safeSources}
        canWrite={roleHasPermission(context.role, "source:write")}
      />
    </main>
  );
}
