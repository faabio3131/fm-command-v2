import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";
import { ptBR } from "../src/i18n/messages/pt-BR";

describe("F10 Executive Command Center contract", () => {
  it("uses governed MetricService and explicitly renders unavailable data", () => {
    const source = readUiSource("src/app/dashboard/page.tsx");
    expect(source).toContain("createMetricService()");
    expect(source).toContain("Ausência de fonte é exibida como indisponível");
    expect(source).toContain("Fonte ainda não conectada");
    expect(source).not.toContain("Math.random");
  });

  it("renders canonical metric labels instead of widening their meaning in the UI", () => {
    const dashboard = readUiSource("src/app/dashboard/page.tsx");
    const registry = readUiSource("src/domain/metrics/registry.ts");
    expect(dashboard).toContain("labels.metricName(target.metricId, target.displayName)");
    expect(dashboard).toContain("home.metric.technicalId");
    expect(ptBR["home.metric.technicalId"]).toContain("Identificador técnico: {id}");
    expect(registry).toContain('metricId: "revenue.cash_collected"');
    expect(registry).toContain('displayName: "Caixa recebido"');
    expect(registry).toContain('metricId: "usage.active_users.dau"');
    expect(registry).toContain('displayName: "Usuários ativos diários (DAU)"');
    expect(registry).toContain('metricId: "trial.starts.count"');
    expect(registry).toContain('displayName: "Testes gratuitos iniciados"');
  });

  it("keeps Core query behind the governed API boundary", () => {
    const source = readUiSource("src/app/dashboard/core-query-form.tsx");
    expect(source).toContain('fetch("/api/core/query"');
    expect(source).toContain("Provedor cognitivo indisponível");
    expect(source).toContain("contrato cognitivo governado");
    expect(source).not.toContain("Core canônico ainda não está conectado neste ambiente");
  });

  it("limpa a pergunta após o envio e mantém a resposta fora do campo", () => {
    const source = readUiSource("src/app/dashboard/core-query-form.tsx");
    expect(source).toContain('const [question, setQuestion] = useState("")');
    expect(source).toContain("const normalizedQuestion = question.trim()");
    expect(source).toContain('setQuestion("")');
    expect(source).toContain("value={question}");
    expect(source).toContain("const scopedQuestion = domainContext");
    expect(source).toContain("body: JSON.stringify({ question: scopedQuestion })");
  });

  it("oferece ditado por microfone no idioma da tela (pt-BR por padrão) sem substituir a digitação", () => {
    const source = readUiSource("src/app/dashboard/core-query-form.tsx");
    expect(source).toContain("webkitSpeechRecognition");
    expect(source).toContain("recognition.lang = locale");
    expect(source).toContain('t("core.form.stopVoice")');
    expect(source).toContain('t("core.form.speak")');
    expect(ptBR["core.form.stopVoice"]).toBe("Parar reconhecimento de voz");
    expect(ptBR["core.form.speak"]).toBe("Falar a pergunta");
    expect(source).toContain('voiceErrorMessage');
    expect(source).toContain('Reconhecimento de voz não disponível neste navegador.');
    expect(source).toContain("activeRecognition.abort()");
  });

  it("recovers from transport or invalid-response failures instead of remaining in loading", () => {
    const source = readUiSource("src/app/dashboard/core-query-form.tsx");
    expect(source).toContain("try {");
    expect(source).toContain("catch {");
    expect(source).toContain('setState({ status: "error", answer: cognitiveErrorMessage(t) })');
    expect(source).toContain('typeof payload.answer !== "string"');
  });
});
