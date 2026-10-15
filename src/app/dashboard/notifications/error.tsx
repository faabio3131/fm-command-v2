"use client";

export default function NotificationsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="dashboard-shell">
      <section className="panel" role="alert">
        <strong>Não foi possível carregar as notificações.</strong>
        <p>Nenhuma notificação fictícia será exibida.</p>
        <button className="button" type="button" onClick={() => reset()}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
