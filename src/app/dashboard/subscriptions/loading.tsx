export default function SubscriptionsLoading() {
  return (
    <main className="dashboard-shell dashboard-shell-compact" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Carregando Assinaturas governadas…</strong>
        <p>Consultando somente métricas e escopo autorizados da organização ativa.</p>
      </section>
    </main>
  );
}
