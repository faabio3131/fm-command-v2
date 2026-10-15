"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSignOut() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setMessage(result.error.message ?? "Não foi possível encerrar a sessão.");
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setMessage("Não foi possível encerrar a sessão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={handleSignOut} disabled={busy}>
        {busy ? "Saindo…" : "Sair"}
      </button>
      {message ? <p role="alert" className="error">{message}</p> : null}
    </>
  );
}
