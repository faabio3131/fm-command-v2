export default function NotificationsLoading() {
  return (
    <main className="dashboard-shell" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Carregando notificações governadas…</strong>
        <p>Consultando somente eventos permitidos da organização ativa.</p>
      </section>
    </main>
  );
}
