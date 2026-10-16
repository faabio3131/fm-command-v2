import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { loadTenantIntegrationFeatures } from "@/application/integration/tenant-integration-features";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { normalizeRole, roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { member, organization, user } from "@/infrastructure/db/auth-schema";
import { rotuloPapelFmcc } from "@/presentation/pt-br";
import { SettingsIdentityAdmin } from "./settings-identity-admin";

export default async function SettingsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const canReadSources = roleHasPermission(context.role, "source:read");
  const canReadIntegrations = roleHasPermission(context.role, "integration:read");
  const canManageTenant = roleHasPermission(context.role, "tenant:manage");
  const canManageMembers = roleHasPermission(context.role, "member:manage");
  const canReadCommercial = roleHasPermission(context.role, "commercial:read");

  const [organizationRows, memberRows, integrationFeatures] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.id, context.tenantId))
      .limit(1),
    canManageMembers
      ? db
          .select({
            id: member.id,
            userId: member.userId,
            role: member.role,
            name: user.name,
            email: user.email,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.organizationId, context.tenantId))
      : Promise.resolve([]),
    loadTenantIntegrationFeatures(context).catch(() => ({
      kordenaCommercial: false,
    })),
  ]);

  const activeOrganization = organizationRows[0];
  if (!activeOrganization) redirect("/onboarding");

  return (
    <main className="dashboard-shell dashboard-shell-compact settings-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Configurações</span>
          <h1>Governança do FM Command</h1>
          <p>
            Organização, permissões, produtos, integrações e capacidades
            preservando as autoridades canônicas.
          </p>
        </div>
        <Link href="/dashboard">Voltar</Link>
      </header>

      {canManageTenant || canManageMembers ? (
        <SettingsIdentityAdmin
          organization={activeOrganization}
          members={memberRows.map((row) => ({
            ...row,
            role: normalizeRole(row.role),
          }))}
          currentUserId={context.userId}
          canManageTenant={canManageTenant}
          canManageMembers={canManageMembers}
        />
      ) : (
        <section className="panel">
          <h2>Organização</h2>
          <p>
            <strong>{activeOrganization.name}</strong>. Seu papel atual possui
            acesso somente ao contexto autorizado e não à administração de membros.
          </p>
        </section>
      )}

      <section className="executive-section" aria-labelledby="settings-authorities-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Autoridades existentes</span>
            <h2 id="settings-authorities-title">Produtos, integrações e operação</h2>
          </div>
          <p>
            Configurações orquestra os módulos canônicos; não replica Source
            Registry, Product Registry, Alert Service ou Core.
          </p>
        </div>
        <div className="foundation-grid command-action-grid">
          <Link href="/dashboard#product-intelligence-title">
            <strong>Produtos</strong>
            <span>Administrar portfólio conforme permissão</span>
          </Link>
          {canReadSources ? (
            <Link href="/dashboard/sources">
              <strong>Fontes e integrações</strong>
              <span>Conectividade, health e sincronização</span>
            </Link>
          ) : null}
          {canReadIntegrations ? (
            <Link href="/dashboard/settings/platform-integrations">
              <strong>Infraestrutura & APIs</strong>
              <span>OpenAI, Gemini e Maps gerenciados pela FM</span>
            </Link>
          ) : null}
          {canReadCommercial && integrationFeatures.kordenaCommercial ? (
            <Link href="/dashboard/commercial/kordena">
              <strong>Kordena</strong>
              <span>Plano de controle comercial governado</span>
            </Link>
          ) : null}
          <Link href="/dashboard/alerts">
            <strong>Alertas</strong>
            <span>Regras, ocorrências e ações governadas</span>
          </Link>
          <Link href="/dashboard/intelligence">
            <strong>Core</strong>
            <span>Inteligência executiva e proveniência</span>
          </Link>
          <Link href="/dashboard/customers">
            <strong>Clientes e suporte</strong>
            <span>Uso, engajamento e atendimento</span>
          </Link>
          <Link href="/dashboard/operations">
            <strong>Runtime e saúde</strong>
            <span>Status governado dos serviços monitorados</span>
          </Link>
        </div>
      </section>

      <section className="panel">
        <h2>Escopo ativo</h2>
        <p>
          Organização: <strong>{activeOrganization.name}</strong>. Papel atual:{" "}
          <strong>{rotuloPapelFmcc(context.role)}</strong>. Identificadores
          técnicos permanecem fora da UX principal.
        </p>
      </section>
    </main>
  );
}
