"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { LanguageSelector } from "@/i18n/react/language-selector";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { APPROVED_COMMAND_ARTWORK_SRC } from "@/presentation/command-approved-artwork";

const benefits = [
  ["auth.benefit.control.title", "auth.benefit.control.description"],
  ["auth.benefit.efficiency.title", "auth.benefit.efficiency.description"],
  ["auth.benefit.results.title", "auth.benefit.results.description"],
  ["auth.benefit.security.title", "auth.benefit.security.description"],
] as const;

export default function SignInPage() {
  const { t } = useTranslator();
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ name, email, password })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        setMessage(
          mode === "sign-in" ? t("auth.error.signIn") : t("auth.error.signUp"),
        );
        return;
      }

      router.push(mode === "sign-up" ? "/onboarding" : "/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const isSignIn = mode === "sign-in";

  return (
    <main className="command-auth-shell">
      <section className="command-auth-experience" aria-labelledby="command-auth-title">
        <header className="command-auth-brandbar">
          <div className="command-auth-brand-lockup" aria-label="FM Tecnologia · FM Command">
            <strong>FM</strong>
            <span>FM Tecnologia</span>
            <i aria-hidden="true" />
            <b>COMMAND</b>
          </div>
          <p>{t("shell.brand.tagline")}</p>
          <LanguageSelector />
        </header>

        <div className="command-auth-layout">
          <section className="command-auth-hero">
            <div className="command-auth-copy">
              <span className="eyebrow">{t("auth.eyebrow")}</span>
              <h1 id="command-auth-title">
                {t("auth.title.lead")}
                <em>{t("auth.title.emphasis")}</em>
              </h1>
              <p>{t("auth.lead")}</p>
              <div className="command-auth-proof" aria-label={t("auth.proof.aria")}>
                <span>{t("auth.proof.governedData")}</span>
                <span>{t("auth.proof.traceableDecisions")}</span>
                <span>{t("auth.proof.multiProduct")}</span>
              </div>
            </div>

            <div className="command-auth-core-stage">
              <Image
                className="command-approved-artwork"
                src={APPROVED_COMMAND_ARTWORK_SRC}
                alt="FM Command"
                width={650}
                height={650}
                priority
                unoptimized
              />
            </div>
          </section>

          <section className="command-auth-card" aria-labelledby="command-auth-card-title">
            <span className="command-auth-card-kicker">{isSignIn ? t("auth.card.kicker.signIn") : t("auth.card.kicker.signUp")}</span>
            <h2 id="command-auth-card-title">{isSignIn ? t("auth.card.title.signIn") : t("auth.card.title.signUp")}</h2>
            <p>
              {isSignIn ? t("auth.card.subtitle.signIn") : t("auth.card.subtitle.signUp")}
            </p>

            <form className="command-auth-form" onSubmit={submit}>
              {!isSignIn ? (
                <label>
                  {t("auth.field.name")}
                  <div className="command-auth-field">
                    <span aria-hidden="true">ID</span>
                    <input
                      name="name"
                      required
                      minLength={2}
                      autoComplete="name"
                      placeholder={t("auth.field.namePlaceholder")}
                    />
                  </div>
                </label>
              ) : null}

              <label>
                {t("auth.field.email")}
                <div className="command-auth-field">
                  <span aria-hidden="true">@</span>
                  <input
                    name="email"
                    required
                    type="email"
                    autoComplete="email"
                    placeholder={t("auth.field.emailPlaceholder")}
                  />
                </div>
              </label>

              <label>
                {t("auth.field.password")}
                <div className="command-auth-field">
                  <span aria-hidden="true">••</span>
                  <input
                    name="password"
                    required
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    maxLength={128}
                    aria-describedby="command-password-help"
                    autoComplete={isSignIn ? "current-password" : "new-password"}
                    placeholder={t("auth.field.passwordPlaceholder")}
                  />
                  <button
                    className="command-password-toggle"
                    type="button"
                    aria-label={showPassword ? t("auth.password.hide") : t("auth.password.show")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {showPassword ? (
                        <>
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                          <path d="M9.9 4.2A10.7 10.7 0 0112 4c5.5 0 9 8 9 8a18 18 0 01-2.1 3.2" />
                          <path d="M6.2 6.2C3.8 8 3 12 3 12s3.5 8 9 8a9.8 9.8 0 004.2-.9" />
                        </>
                      ) : (
                        <>
                          <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                          <circle cx="12" cy="12" r="2.7" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </label>
              <small id="command-password-help">
                {isSignIn ? t("auth.password.help.signIn") : t("auth.password.help.signUp")}
              </small>

              <button className="button primary command-auth-submit" disabled={busy} type="submit">
                {busy ? t("auth.submit.busy") : isSignIn ? t("auth.submit.signIn") : t("auth.submit.signUp")}
                <span aria-hidden="true">→</span>
              </button>
            </form>

            {message ? <p role="alert" className="error command-auth-feedback">{message}</p> : null}

            <div className="command-auth-switch">
              <span>{isSignIn ? t("auth.switch.toSignUpPrompt") : t("auth.switch.toSignInPrompt")}</span>
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  setMode(isSignIn ? "sign-up" : "sign-in");
                  setMessage(null);
                }}
              >
                {isSignIn ? t("auth.switch.toSignUp") : t("auth.switch.toSignIn")}
              </button>
            </div>

            <div className="command-auth-security">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{t("auth.security.title")}</strong>
                <small>{t("auth.security.description")}</small>
              </div>
            </div>
          </section>
        </div>

        <footer className="command-auth-benefits" aria-label={t("auth.benefits.aria")}>
          {benefits.map(([title, description], index) => (
            <article key={title}>
              <span aria-hidden="true">0{index + 1}</span>
              <div>
                <strong>{t(title)}</strong>
                <small>{t(description)}</small>
              </div>
            </article>
          ))}
        </footer>
      </section>
    </main>
  );
}
