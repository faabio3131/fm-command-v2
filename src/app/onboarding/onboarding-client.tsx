"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { ORGANIZATION_SLUG_PATTERN } from "@/domain/organization/slug";

export default function OnboardingPage() {
  const router = useRouter();
  const { data: organizations } = authClient.useListOrganizations();
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create");
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim().toLowerCase();

    try {
      const result = await authClient.organization.create({
        name,
        slug,
        keepCurrentActiveOrganization: false,
      });

      if (result.error) {
        setMessage("Não foi possível criar a organização.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function enterOrganization(organizationId: string) {
    setBusyAction(organizationId);
    setMessage(null);

    try {
      const result = await authClient.organization.setActive({ organizationId });

      if (result.error) {
        setMessage("Não foi possível entrar na organização.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  const availableOrganizations = organizations ?? [];

  return (
    <main className="shell">
      <section className="card auth-card">
        <span className="eyebrow">Organização</span>
        <h1>Organização</h1>
        <p>A organização autenticada é a raiz de isolamento de dados do FM Command.</p>

        <section aria-labelledby="existing-orgs-title">
          <h2 id="existing-orgs-title">Entrar em organização existente</h2>
          {availableOrganizations.length > 0 ? (
            <div className="organization-list">
              {availableOrganizations.map((organization) => (
                <article className="organization-option" key={organization.id}>
                  <div>
                    <strong>{organization.name}</strong>
                    <span>{organization.slug}</span>
                  </div>
                  <button
                    className="button"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => enterOrganization(organization.id)}
                  >
                    {busyAction === organization.id ? "Entrando…" : "Entrar"}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p>Nenhuma organização existente está vinculada a este usuário.</p>
          )}
        </section>

        <div className="section-divider" role="separator" />

        <section aria-labelledby="create-org-title">
          <h2 id="create-org-title">Criar nova organização</h2>
          <form onSubmit={createOrganization}>
            <label>
              Nome da organização
              <input name="name" required minLength={2} autoComplete="organization" />
            </label>
            <label>
              Identificador
              <input name="slug" required pattern={ORGANIZATION_SLUG_PATTERN} autoComplete="off" />
            </label>
            <button className="button primary" disabled={busyAction !== null} type="submit">
              {busyAction === "create" ? "Criando…" : "Criar organização"}
            </button>
          </form>
        </section>

        {message ? <p role="alert" className="error">{message}</p> : null}
      </section>
    </main>
  );
}
