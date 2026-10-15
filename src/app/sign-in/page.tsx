"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { APPROVED_COMMAND_ARTWORK_SRC } from "@/presentation/command-approved-artwork";

const benefits = [
  ["Mais controle", "Visão executiva governada da operação."],
  ["Mais eficiência", "Menos dispersão entre produtos e fontes."],
  ["Mais resultados", "Decisões apoiadas por evidência rastreável."],
  ["Mais segurança", "Escopo, permissões e auditoria por padrão."],
] as const;

export default function SignInPage() {
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
          mode === "sign-in"
            ? "Não foi possível entrar. Verifique suas credenciais."
            : "Não foi possível criar a conta.",
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
          <p>Inteligência, controle e crescimento para o seu negócio.</p>
        </header>

        <div className="command-auth-layout">
          <section className="command-auth-hero">
            <div className="command-auth-copy">
              <span className="eyebrow">Central executiva governada</span>
              <h1 id="command-auth-title">
                Comande sua operação com
                <em> inteligência governada.</em>
              </h1>
              <p>
                Dados, operações e crescimento em um só lugar, com o poder do Core Executivo
                e o controle que o seu negócio precisa.
              </p>
              <div className="command-auth-proof" aria-label="Princípios do FM Command">
                <span>Dados governados</span>
                <span>Decisões rastreáveis</span>
                <span>Operação multi-produto</span>
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
            <span className="command-auth-card-kicker">{isSignIn ? "Acesso seguro" : "Nova conta"}</span>
            <h2 id="command-auth-card-title">{isSignIn ? "Acesse sua conta" : "Criar conta"}</h2>
            <p>
              {isSignIn
                ? "Entre no FM Command e continue sua gestão executiva."
                : "Crie sua conta e configure a primeira organização do FM Command."}
            </p>

            <form className="command-auth-form" onSubmit={submit}>
              {!isSignIn ? (
                <label>
                  Nome
                  <div className="command-auth-field">
                    <span aria-hidden="true">ID</span>
                    <input
                      name="name"
                      required
                      minLength={2}
                      autoComplete="name"
                      placeholder="Seu nome"
                    />
                  </div>
                </label>
              ) : null}

              <label>
                E-mail
                <div className="command-auth-field">
                  <span aria-hidden="true">@</span>
                  <input
                    name="email"
                    required
                    type="email"
                    autoComplete="email"
                    placeholder="seu@empresa.com"
                  />
                </div>
              </label>

              <label>
                Senha
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
                    placeholder="Sua senha"
                  />
                  <button
                    className="command-password-toggle"
                    type="button"
                    aria-label={showPassword ? "Ocultar caracteres" : "Mostrar caracteres"}
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
                {isSignIn
                  ? "Use a senha da sua conta."
                  : "A senha deve ter de 8 a 128 caracteres. Maiúsculas, números e símbolos não são obrigatórios, mas recomendamos combinar esses elementos e não reutilizar senhas."}
              </small>

              <button className="button primary command-auth-submit" disabled={busy} type="submit">
                {busy ? "Processando…" : isSignIn ? "Entrar" : "Criar conta"}
                <span aria-hidden="true">→</span>
              </button>
            </form>

            {message ? <p role="alert" className="error command-auth-feedback">{message}</p> : null}

            <div className="command-auth-switch">
              <span>{isSignIn ? "Primeiro acesso ao Command?" : "Já possui uma conta?"}</span>
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  setMode(isSignIn ? "sign-up" : "sign-in");
                  setMessage(null);
                }}
              >
                {isSignIn ? "Criar uma conta" : "Já tenho uma conta"}
              </button>
            </div>

            <div className="command-auth-security">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Ambiente governado</strong>
                <small>Autenticação e escopo da organização são validados no servidor.</small>
              </div>
            </div>
          </section>
        </div>

        <footer className="command-auth-benefits" aria-label="Benefícios do FM Command">
          {benefits.map(([title, description], index) => (
            <article key={title}>
              <span aria-hidden="true">0{index + 1}</span>
              <div>
                <strong>{title}</strong>
                <small>{description}</small>
              </div>
            </article>
          ))}
        </footer>
      </section>
    </main>
  );
}
