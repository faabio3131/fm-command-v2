import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { buildProductReceivablesService } from "@/application/finance/product-receivables-composition";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import type {
  ReceivableReconciliationStatus,
  ReceivableTransactionStatus,
  ReceivableTransactionType,
} from "@/domain/finance/receivables";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

function transactionStatusLabel(status: ReceivableTransactionStatus): string {
  if (status === "pending") return "Pendente";
  if (status === "succeeded") return "Confirmada";
  if (status === "failed") return "Falhou";
  return "Estornada";
}

function transactionTypeLabel(type: ReceivableTransactionType): string {
  return type === "payment" ? "Pagamento" : "Estorno";
}

function reconciliationLabel(
  status: ReceivableReconciliationStatus,
): string {
  if (status === "in_sync") return "Conciliada";
  if (status === "repaired") return "Reparada";
  if (status === "failed") return "Falha de conciliação";
  return "Ainda não conciliada";
}

function amountLabel(amount: string | null, currency: string | null): string {
  if (amount === null || currency === null) return "Valor indisponível";
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

function dateLabel(value: string | null): string {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export default async function ProductReceivablesPage({
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

  if (!roleHasPermission(context.role, "receivable:read")) {
    redirect("/dashboard");
  }

  const { productId } = await params;
  let overview;
  try {
    overview = await buildProductReceivablesService().overview(
      context,
      productId,
    );
  } catch (error) {
    if (error instanceof ProductNotFoundError) notFound();
    throw error;
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">R7 · Receivables governado</span>
          <h1>Recebimentos e contas a receber · {overview.product.name}</h1>
          <p>
            Transações e sinais de atraso vêm da autoridade comercial do produto.
            Fatura, vencimento e saldo em aberto não são inferidos.
          </p>
        </div>
        <Link
          className="button"
          href={`/dashboard/products/${overview.product.id}`}
        >
          Voltar ao produto
        </Link>
      </header>

      {overview.status === "unavailable" ? (
        <section className="panel">
          <h2>Receivables indisponível</h2>
          <p>
            {overview.reason === "source_not_configured"
              ? "Nenhuma fonte comercial canônica foi atribuída a este produto."
              : "A fonte canônica de recebimentos não respondeu. Nenhum valor foi presumido."}
          </p>
          <p>{overview.coverage.note}</p>
        </section>
      ) : (
        <>
          <section
            className="metric-grid"
            aria-label="Resumo de recebimentos do produto"
          >
            <article className="metric-card">
              <span className="metric-label">Transações canônicas</span>
              <strong>{overview.counts.transactions}</strong>
              <small>
                Pagamentos e estornos vinculados a cliente, produto e assinatura.
              </small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Pagamentos confirmados</span>
              <strong>{overview.counts.succeededPayments}</strong>
              <small>
                Confirmação de pagamento não é sinônimo de faturamento emitido.
              </small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Falhas de pagamento</span>
              <strong>{overview.counts.failedPayments}</strong>
              <small>
                Falha é sinal operacional; não é convertida em valor inadimplente.
              </small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Assinaturas em atraso</span>
              <strong>{overview.counts.pastDueSubscriptions}</strong>
              <small>
                Estado <code>past_due</code> canônico, sem estimar saldo devedor.
              </small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Pagamentos pendentes</span>
              <strong>{overview.counts.pendingPayments}</strong>
              <small>Eventos ainda não confirmados pelo provider.</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Conciliação requer atenção</span>
              <strong>{overview.counts.reconciliationAttention}</strong>
              <small>Transações não verificadas ou com falha de conciliação.</small>
            </article>
          </section>

          <section className="executive-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Cobertura financeira</span>
                <h2>O que a fonte permite afirmar</h2>
              </div>
              <p>
                Atualizado em {dateLabel(overview.asOf)} · fonte{" "}
                {overview.sourceAuthority ?? "indisponível"}.
              </p>
            </div>
            <div className="foundation-grid">
              <article>
                <strong>Faturas</strong>
                <span>Indisponível</span>
                <p>
                  O contrato atual não publica uma entidade canônica de invoice.
                </p>
              </article>
              <article>
                <strong>Saldo em aberto</strong>
                <span>Indisponível</span>
                <p>Não é derivado de preço contratado nem de falha de pagamento.</p>
              </article>
              <article>
                <strong>Data de vencimento da fatura</strong>
                <span>Indisponível</span>
                <p>
                  Fim do período da assinatura não é tratado como vencimento de
                  fatura.
                </p>
              </article>
              <article>
                <strong>Valor inadimplente</strong>
                <span>
                  {overview.coverage.delinquencyAmount === "pending_semantics"
                    ? "Semântica pendente"
                    : "Indisponível"}
                </span>
                <p>{overview.coverage.note}</p>
              </article>
            </div>
          </section>

          <section className="executive-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Assinaturas</span>
                <h2>Contas com estado past_due</h2>
              </div>
              <p>
                O valor contratado é mostrado apenas como contexto contratual; não
                representa saldo aberto ou dívida.
              </p>
            </div>
            <div className="product-grid">
              {overview.pastDueSubscriptions.length ? (
                overview.pastDueSubscriptions.map((subscription) => (
                  <article
                    className="product-card"
                    key={subscription.subscriptionId}
                  >
                    <span className="eyebrow">{subscription.planCode}</span>
                    <strong>{subscription.customerDisplayName}</strong>
                    <small>
                      Valor contratado:{" "}
                      {amountLabel(
                        subscription.contractedAmount,
                        subscription.currency,
                      )}
                    </small>
                    <small>
                      Fim do período atual:{" "}
                      {dateLabel(subscription.currentPeriodEnd)}
                    </small>
                    <small>
                      Assinatura: <code>{subscription.subscriptionId}</code>
                    </small>
                  </article>
                ))
              ) : (
                <article className="product-card">
                  <strong>Nenhuma assinatura past_due na leitura atual.</strong>
                  <small>
                    Isso não substitui um ledger de faturas ou saldo em aberto.
                  </small>
                </article>
              )}
            </div>
          </section>

          <section className="executive-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Billing Ledger</span>
                <h2>Transações por cliente e assinatura</h2>
              </div>
              <p>
                INTERNAL_TEST é excluído dos indicadores comerciais. Transações sem
                identidade canônica não entram nesta superfície.
              </p>
            </div>
            <div className="product-grid">
              {overview.transactions.length ? (
                overview.transactions.map((transaction) => (
                  <article
                    className="product-card"
                    key={transaction.billingTransactionId}
                  >
                    <span className="eyebrow">
                      {transactionTypeLabel(transaction.transactionType)} ·{" "}
                      {transactionStatusLabel(transaction.status)}
                    </span>
                    <strong>{transaction.customerDisplayName}</strong>
                    <small>
                      {amountLabel(transaction.amount, transaction.currency)}
                    </small>
                    <small>
                      Conciliação:{" "}
                      {reconciliationLabel(transaction.reconciliationStatus)}
                    </small>
                    <small>
                      Provider: {transaction.providerCode} ·{" "}
                      {dateLabel(transaction.providerOccurredAt)}
                    </small>
                    <small>
                      Assinatura: <code>{transaction.subscriptionId}</code>
                    </small>
                  </article>
                ))
              ) : (
                <article className="product-card">
                  <strong>Nenhuma transação comercial vinculada.</strong>
                  <small>Nenhum valor é presumido.</small>
                </article>
              )}
            </div>
          </section>

          {(overview.counts.excludedInternalTestTransactions > 0 ||
            overview.counts.excludedUnboundTransactions > 0) && (
            <section className="panel">
              <h2>Qualidade e exclusões</h2>
              <p>
                INTERNAL_TEST excluídas:{" "}
                {overview.counts.excludedInternalTestTransactions}. Transações sem
                identidade canônica completa excluídas:{" "}
                {overview.counts.excludedUnboundTransactions}.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
