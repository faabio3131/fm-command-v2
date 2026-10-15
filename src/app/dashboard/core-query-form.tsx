"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { rotuloAutoridadeFonte, rotuloMetrica } from "@/presentation/pt-br";
import { APPROVED_COMMAND_ARTWORK_SRC } from "@/presentation/command-approved-artwork";

type State = {
  status: "idle" | "loading" | "success" | "error";
  answer?: string;
  evidence?: Array<{ ref: string; sourceAuthority?: string }>;
};

type CoreQueryFormProps = {
  readonly productContext?: {
    readonly slug: string;
    readonly name: string;
  };
  readonly domainContext?: {
    readonly label: string;
    readonly promptPrefix: string;
  };
};

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

function speechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function cognitiveErrorMessage(code?: string): string {
  if (code === "core.cognitive_model_unavailable") {
    return "Provedor cognitivo indisponível. Verifique a configuração, a credencial ou a conectividade do modelo.";
  }
  if (code === "core.cognitive_model_contract_invalid") {
    return "O provedor respondeu, mas a resposta não passou pelo contrato cognitivo governado.";
  }
  return "Não foi possível consultar o Core.";
}

function voiceErrorMessage(code?: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Permissão do microfone não concedida.";
  }
  if (code === "no-speech") {
    return "Nenhuma fala foi detectada. Tente novamente.";
  }
  return "Não foi possível reconhecer a fala neste momento.";
}

export function CoreQueryForm({
  productContext,
  domainContext,
}: CoreQueryFormProps = {}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [question, setQuestion] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef("");
  const contextLabel = domainContext?.label ?? productContext?.name;
  const suggestions = contextLabel
    ? [
        `O que precisa da minha atenção em ${contextLabel}?`,
        `Explique as principais variações de ${contextLabel}.`,
        `Quais são os principais riscos em ${contextLabel}?`,
      ]
    : [
        "O que precisa da minha atenção?",
        "Explique as principais variações da empresa.",
        "Quais são os principais riscos?",
      ];

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Constructor = speechRecognitionConstructor();
    if (!Constructor) {
      setVoiceMessage("Reconhecimento de voz não disponível neste navegador.");
      return;
    }

    const recognition = new Constructor();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = true;
    voiceBaseRef.current = question.trim();

    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index]?.[0]?.transcript?.trim();
        if (transcript) parts.push(transcript);
      }

      const spokenText = parts.join(" ").trim();
      const combined = [voiceBaseRef.current, spokenText].filter(Boolean).join(" ").trim();
      setQuestion(combined);
      setVoiceMessage(spokenText ? "Transcrição recebida." : "Ouvindo…");
    };

    recognition.onerror = (event) => {
      setVoiceMessage(voiceErrorMessage(event.error));
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setVoiceMessage("Ouvindo…");
    setListening(true);

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setVoiceMessage("Não foi possível iniciar o microfone.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;
    const scopedQuestion = domainContext
      ? `${domainContext.promptPrefix}\n\n${normalizedQuestion}`
      : normalizedQuestion;

    const activeRecognition = recognitionRef.current;
    if (activeRecognition) {
      activeRecognition.onresult = null;
      activeRecognition.onerror = null;
      activeRecognition.onend = null;
      activeRecognition.abort();
      recognitionRef.current = null;
      setListening(false);
    }

    setQuestion("");
    setVoiceMessage("");
    setState({ status: "loading" });

    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: scopedQuestion }),
      };
      if (productContext) {
        requestInit.body = JSON.stringify({
          question: scopedQuestion,
          productSlugs: [productContext.slug],
        });
      }
      const response = await fetch("/api/core/query", requestInit);

      const payload = await response.json() as {
        answer?: string;
        evidence?: Array<{ ref: string; sourceAuthority?: string }>;
        error?: string;
      };

      if (!response.ok) {
        setState({ status: "error", answer: cognitiveErrorMessage(payload.error) });
        return;
      }

      if (typeof payload.answer !== "string" || !payload.answer.trim()) {
        setState({ status: "error", answer: cognitiveErrorMessage() });
        return;
      }

      setState({ status: "success", answer: payload.answer, evidence: payload.evidence });
    } catch {
      setState({ status: "error", answer: cognitiveErrorMessage() });
    }
  }

  return (
    <section className="core-panel" aria-labelledby="core-title">
      <div className="core-panel-head">
        <div className="core-panel-copy">
          <span className="eyebrow">INTELIGÊNCIA COGNITIVA VERTICAL</span>
          <h2 id="core-title">FM COMMAND CORE</h2>
          <p>A inteligência cognitiva que entende sua operação, conecta informações e transforma contexto em decisões mais precisas.</p>
          <p className="core-supporting-copy">Analisa, contextualiza, recomenda e coordena capacidades com governança e rastreabilidade.</p>
          {productContext ? (
            <p className="core-context">
              Contexto governado: <strong>{productContext.name}</strong> ·{" "}
              <code>{productContext.slug}</code>
            </p>
          ) : domainContext ? (
            <p className="core-context">
              Contexto governado: <strong>{domainContext.label}</strong>
            </p>
          ) : null}
        </div>
        <div className="core-orb-stage core-approved-artwork-stage" aria-label="FM Command Core">
          <Image
            className="command-approved-artwork core-approved-artwork"
            src={APPROVED_COMMAND_ARTWORK_SRC}
            alt="FM Command"
            width={650}
            height={650}
            priority
            unoptimized
          />
        </div>
      </div>

      <form onSubmit={submit} className="core-form">
        <label htmlFor="core-question">Pergunta executiva</label>
        <div className="core-suggestions" aria-label="Perguntas sugeridas">
          {suggestions.map((suggestion) => (
            <button
              className="core-suggestion"
              type="button"
              key={suggestion}
              onClick={() => setQuestion(suggestion)}
              disabled={state.status === "loading"}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className="core-input-row">
          <input
            id="core-question"
            name="question"
            maxLength={4000}
            placeholder={
              productContext
                ? `Ex.: Quanto o ${productContext.name} faturou no período?`
                : domainContext
                  ? `Pergunte ao Core sobre ${domainContext.label}...`
                  : "Pergunte ao Core sobre faturamento, trials, churn ou operação..."
            }
            autoComplete="off"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            className="button core-voice-button"
            type="button"
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={listening ? "Parar reconhecimento de voz" : "Falar a pergunta"}
            title={listening ? "Parar reconhecimento de voz" : "Falar a pergunta"}
          >
            <span aria-hidden="true">🎙️</span> {listening ? "Parar" : "Falar"}
          </button>
          <button className="button core-submit-button" type="submit" disabled={state.status === "loading" || !question.trim()}>
            {state.status === "loading" ? "Consultando…" : "Consultar"}
          </button>
        </div>
        {voiceMessage ? <small className="core-voice-status" aria-live="polite">{voiceMessage}</small> : null}
      </form>

      {state.answer && (
        <div className={state.status === "error" ? "core-answer error" : "core-answer"} role="status" aria-live="polite">
          <strong>{state.status === "error" ? "Indisponível" : "Resposta"}</strong>
          <p>{state.answer}</p>
          {state.evidence?.length ? (
            <small className="core-evidence">
              Proveniência: {state.evidence
                .map((item) => `${rotuloMetrica(item.ref)} · ${rotuloAutoridadeFonte(item.sourceAuthority)}`)
                .join(", ")}
            </small>
          ) : null}
        </div>
      )}
    </section>
  );
}
