export default function SettingsLoading() {
  return (
    <main className="dashboard-shell dashboard-shell-compact" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Carregando configurações governadas…</strong>
        <p>Consultando somente autoridades e permissões da organização ativa.</p>
      </section>
    </main>
  );
}
