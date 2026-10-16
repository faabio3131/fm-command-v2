"use client";

export default function ActivityError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="dashboard-shell">
      <section className="panel" role="alert">
        <strong>Não foi possível carregar o Activity Feed.</strong>
        <p>Nenhum evento fictício será exibido. Tente novamente.</p>
        <button className="button" type="button" onClick={() => reset()}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
