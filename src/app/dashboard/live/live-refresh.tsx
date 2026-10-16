"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nextDelayMs, shouldRefresh } from "@/domain/live/pulse";
import { useTranslator } from "@/i18n/react/i18n-provider";

type LiveState = "live" | "paused" | "reconnecting";

/**
 * Atualiza a tela sozinha quando algo visível para a pessoa muda (etapa 10).
 * Consulta uma marca curta de mudança; só quando ela muda pede ao servidor para redesenhar (os formulários abertos não perdem o que foi digitado).
 * Fica parado com a aba escondida, volta e confere na hora ao reaparecer, e espaça as tentativas quando o servidor falha.
 */
export function LiveRefresh() {
  const router = useRouter();
  const { t } = useTranslator();
  const [state, setState] = useState<LiveState>("live");
  const lastToken = useRef<string | null>(null);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;

    async function tick() {
      if (stopped || inFlight) return;
      if (document.visibilityState === "hidden") { setState("paused"); return; }
      inFlight = true;
      try {
        const response = await fetch("/api/live/pulse", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401 || response.status === 403) {
          // Sessão acabou ou perdeu acesso: deixa o servidor decidir para onde ir, sem insistir.
          router.refresh();
          setState("paused");
          inFlight = false;
          return;
        }
        if (!response.ok) throw new Error(`live.${response.status}`);
        const { token } = (await response.json()) as { token: string };
        failures.current = 0;
        setState("live");
        if (shouldRefresh(lastToken.current, token)) router.refresh();
        lastToken.current = token;
      } catch {
        failures.current += 1;
        setState("reconnecting");
      }
      inFlight = false;
      if (!stopped) timer.current = setTimeout(tick, nextDelayMs(failures.current));
    }

    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void tick();
    }

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [router]);

  // Sem role="status"/aria-live de propósito: a cada consulta o leitor de tela anunciaria o texto à toa.
  // A mudança que importa (o número ou o alerta novo) já é lida na própria região atualizada.
  const label = t(`live.status.${state}`);
  return (
    <span className="live-status" data-state={state} title={label}>
      <span aria-hidden="true">●</span>
      <span className="live-status-text">{label}</span>
    </span>
  );
}
