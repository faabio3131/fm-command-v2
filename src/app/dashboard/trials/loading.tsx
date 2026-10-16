export default function TrialsLoading() {
  return (
    <main className="dashboard-shell dashboard-shell-compact" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Carregando Trials governados…</strong>
        <p>Consultando métricas e escopo autorizados da organização ativa.</p>
      </section>
    </main>
  );
}
