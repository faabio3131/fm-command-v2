import { FMCC_IRON_PRODUCT_SLUG } from "@/domain/billing/iron-product-identity";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { ProductNotFoundError, ProductRegistryService } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { KORDENA_COMMERCIAL_SOURCE_TYPE } from "@/infrastructure/integration/kordena-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { KordenaBillingControlService } from "@/application/integration/kordena-billing-control-service";
import { BillingControlPanel } from "./billing-control-panel";
import { IronPayerEnrollmentPanel } from "./iron-payer-enrollment-panel";
import { IronCommercialConnector, IRON_COMMERCIAL_SOURCE_TYPE, IRON_COMMERCIAL_SECRET_REF, environmentIronControlTenantId } from "@/infrastructure/integration/iron-commercial-connector";

export default async function ProductBillingPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "billing:read")) {
    redirect("/dashboard");
  }

  const { productId } = await params;
  const products = new PostgresProductRepository();
  const productService = new ProductRegistryService(products);
  let product;
  try {
    product = await productService.get(context, productId);
  } catch (error) {
    if (error instanceof ProductNotFoundError) notFound();
    throw error;
  }

  const sourceService = new SourceRegistryService(
    new PostgresSourceRepository(),
    products,
  );
  const sources = await sourceService.list(context);
  const source = sources.find(
    (item) =>
      item.productId === product.id &&
      item.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
  );

  const isIron = product.slug === FMCC_IRON_PRODUCT_SLUG;
  const ironSources = isIron ? sources.filter(item =>
    item.productId===product.id && item.name==="IRON FIT CORE Commercial" &&
    item.sourceType===IRON_COMMERCIAL_SOURCE_TYPE &&
    item.secretRef===IRON_COMMERCIAL_SECRET_REF &&
    item.authoritativeDomain==="commercial" &&
    context.tenantId===environmentIronControlTenantId(),
  ) : [];
  let ironAcademies: {id:string;name:string}[] = [];
  let ironUnavailable = false;
  if(isIron && ironSources.length===1){
    try{
      const snapshot=await new IronCommercialConnector().snapshot({
        tenantId:context.tenantId,correlationId:context.correlationId,timeoutMs:8000,
      },ironSources[0]);
      const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      ironAcademies=snapshot.customers.filter(row=>
        typeof row.tenant_id==="string" && idPattern.test(row.tenant_id) &&
        typeof row.name==="string" && row.name.length>0 && row.active===true,
      ).map(row=>({id:String(row.tenant_id),name:String(row.name)}));
      if(new Set(ironAcademies.map(gym=>gym.id)).size!==ironAcademies.length){
        ironUnavailable=true;ironAcademies=[];
      }
    }catch{ironUnavailable=true;}
  }

  let overview = null;
  let upstreamError: string | null = null;
  if (source) {
    try {
      overview = await new KordenaBillingControlService().overview(
        context,
        source.id,
      );
    } catch {
      upstreamError =
        "A fonte comercial do produto existe, mas o control plane de billing ainda não respondeu.";
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Command · Billing SaaS</span>
          <h1>Billing e Recebimentos · {product.name}</h1>
          <p>
            Configure a conta recebedora da FM por produto. Credenciais permanecem
            protegidas e não são exibidas nesta interface.
          </p>
        </div>
        <Link className="button" href={`/dashboard/products/${product.id}`}>
          Voltar ao produto
        </Link>
      </header>

      <section className="foundation-grid" aria-label="Princípios do billing SaaS">
        <article>
          <strong>Segregação</strong>
          <span>Recebimentos isolados por produto e cliente</span>
        </article>
        <article>
          <strong>Titular</strong>
          <span>Pessoa Física ou Pessoa Jurídica configurável</span>
        </article>
        <article>
          <strong>Segredos</strong>
          <span>Somente Vault; nunca exibidos novamente</span>
        </article>
        <article>
          <strong>Produção</strong>
          <span>Ativação somente após teste de conexão válido</span>
        </article>
      </section>

      {isIron ? (
        ironSources.length!==1 || ironUnavailable ? (
          <section className="panel">
            <h2>Cadastro financeiro indisponível</h2>
            <p>O vínculo canônico com o IRON precisa estar disponível e ser único. Nenhum pagador será cadastrado sem essa verificação.</p>
          </section>
        ) : (
          <IronPayerEnrollmentPanel
            productId={product.id}
            academies={ironAcademies}
            canWrite={roleHasPermission(context.role,"billing:write") &&
              (context.role==="owner"||context.role==="admin")}
            enabled={process.env.FMCC_IRON_ASAAS_PAYER_ENROLLMENT_ENABLED==="YES"}
          />
        )
      ) : !source ? (
        <section className="panel">
          <h2>Fonte comercial não conectada</h2>
          <p>
            Conecte primeiro a fonte comercial deste produto em Fontes e
            Integrações. Nenhuma configuração financeira será presumida.
          </p>
          <Link className="button" href="/dashboard/sources">
            Abrir Fontes e Integrações
          </Link>
        </section>
      ) : overview ? (
        <BillingControlPanel
          sourceId={source.id}
          productCode={product.slug.toUpperCase()}
          initialOverview={overview}
          canWrite={roleHasPermission(context.role, "billing:write")}
        />
      ) : (
        <section className="panel">
          <h2>Billing indisponível</h2>
          <p>{upstreamError}</p>
        </section>
      )}
    </main>
  );
}
