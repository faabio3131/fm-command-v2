export default function SearchLoading() {
  return (
    <main className="dashboard-shell" aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>Buscando no FM Command…</strong>
        <p>Consultando somente autoridades permitidas para a organização ativa.</p>
      </section>
    </main>
  );
}
