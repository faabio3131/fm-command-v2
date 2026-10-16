export default function ActivityLoading() {
  return (
    <main className="dashboard-shell" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Carregando atividades governadas…</strong>
        <p>Consultando somente eventos autorizados da organização ativa.</p>
      </section>
    </main>
  );
}
