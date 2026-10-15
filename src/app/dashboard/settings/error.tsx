"use client";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <section className="panel" role="alert">
        <strong>Não foi possível carregar Configurações.</strong>
        <p>Nenhuma permissão ou identidade será presumida.</p>
        <button className="button" type="button" onClick={() => reset()}>Tentar novamente</button>
      </section>
    </main>
  );
}
