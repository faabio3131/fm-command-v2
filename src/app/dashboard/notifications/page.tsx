import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildNotificationService } from "@/application/notifications/notification-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "notification:use")) {
    redirect("/dashboard");
  }

  const inbox = await buildNotificationService().inbox(context, 50);

  return (
    <main className="dashboard-shell dashboard-shell-compact notifications-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">CME-06 · Central de Notificações</span>
          <h1>Notificações</h1>
          <p>
            Inbox derivada de alertas e eventos governados reais da organização
            ativa. Uma notificação nunca concede autoridade para executar ações.
          </p>
        </div>
        <Link className="button" href="/dashboard">
          Voltar à Visão Geral
        </Link>
      </header>

      <section className="metric-grid" aria-label="Resumo das notificações">
        <article className="metric-card">
          <span className="metric-label">Não lidas</span>
          <strong>{inbox.unreadCount}</strong>
          <small>Estado pessoal do usuário autenticado.</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Eventos elegíveis</span>
          <strong>{inbox.totalCount}</strong>
          <small>Somente fontes e eventos permitidos ao papel atual.</small>
        </article>
      </section>

      <section className="panel">
        <h2>Fronteira da inbox</h2>
        <p>{inbox.dataBoundary}</p>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Tenant + usuário</span>
            <h2>Caixa de entrada</h2>
          </div>
          <p>
            Reconhecimento de alerta continua no serviço de Alertas; marcar como
            lida altera somente o estado pessoal da notificação.
          </p>
        </div>
        <NotificationList items={inbox.items} />
      </section>
    </main>
  );
}
