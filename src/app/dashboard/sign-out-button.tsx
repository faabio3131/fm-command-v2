"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { useTranslator } from "@/i18n/react/i18n-provider";

export function SignOutButton() {
  const { t } = useTranslator();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSignOut() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setMessage(result.error.message ?? t("auth.signOut.error"));
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setMessage(t("auth.signOut.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button" type="button" onClick={handleSignOut} disabled={busy}>
        {busy ? t("auth.signOut.busy") : t("auth.signOut.button")}
      </button>
      {message ? <p role="alert" className="error">{message}</p> : null}
    </>
  );
}
