"use client";

export default function TrialsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <section className="panel" role="alert">
        <strong>Não foi possível carregar Trials.</strong>
        <p>Nenhum valor será presumido enquanto a fonte governada estiver indisponível.</p>
        <button className="button" type="button" onClick={() => reset()}>Tentar novamente</button>
      </section>
    </main>
  );
}
