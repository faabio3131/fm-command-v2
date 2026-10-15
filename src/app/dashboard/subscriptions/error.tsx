"use client";

export default function SubscriptionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <section className="panel" role="alert">
        <strong>Não foi possível carregar Assinaturas.</strong>
        <p>Nenhuma receita, churn ou assinatura será inferida sem autoridade governada.</p>
        <button className="button" type="button" onClick={() => reset()}>Tentar novamente</button>
      </section>
    </main>
  );
}
