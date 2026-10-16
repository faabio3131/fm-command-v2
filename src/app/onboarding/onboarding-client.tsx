"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { ORGANIZATION_SLUG_PATTERN } from "@/domain/organization/slug";

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useTranslator();
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
        setMessage(t("onboarding.createFailed"));
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
        setMessage(t("onboarding.enterFailed"));
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
        <span className="eyebrow">{t("onboarding.eyebrow")}</span>
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.lead")}</p>

        <section aria-labelledby="existing-orgs-title">
          <h2 id="existing-orgs-title">{t("onboarding.existing")}</h2>
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
                    {busyAction === organization.id ? t("onboarding.entering") : t("onboarding.enter")}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p>{t("onboarding.none")}</p>
          )}
        </section>

        <div className="section-divider" role="separator" />

        <section aria-labelledby="create-org-title">
          <h2 id="create-org-title">{t("onboarding.createTitle")}</h2>
          <form onSubmit={createOrganization}>
            <label>
              {t("onboarding.name")}
              <input name="name" required minLength={2} autoComplete="organization" />
            </label>
            <label>
              {t("onboarding.slug")}
              <input name="slug" required pattern={ORGANIZATION_SLUG_PATTERN} autoComplete="off" />
            </label>
            <button className="button primary" disabled={busyAction !== null} type="submit">
              {busyAction === "create" ? t("onboarding.creating") : t("onboarding.create")}
            </button>
          </form>
        </section>

        {message ? <p role="alert" className="error">{message}</p> : null}
      </section>
    </main>
  );
}
