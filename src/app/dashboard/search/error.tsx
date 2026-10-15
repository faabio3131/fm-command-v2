"use client";

export default function SearchError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="dashboard-shell">
      <section className="panel" role="alert">
        <strong>Não foi possível concluir a busca.</strong>
        <p>Nenhum escopo adicional foi consultado. Tente novamente.</p>
        <button className="button" type="button" onClick={() => reset()}>
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
