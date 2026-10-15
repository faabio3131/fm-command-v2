import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F10 Executive Command Center contract", () => {
  it("uses governed MetricService and explicitly renders unavailable data", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    expect(source).toContain("new MetricService(new PostgresMetricStore())");
    expect(source).toContain("Ausência de fonte é exibida como indisponível");
    expect(source).toContain("Fonte ainda não conectada");
    expect(source).not.toContain("Math.random");
  });

  it("renders canonical metric labels instead of widening their meaning in the UI", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    const registry = readFileSync(resolve(process.cwd(), "src/domain/metrics/registry.ts"), "utf8");
    expect(dashboard).toContain("{target.displayName}");
    expect(dashboard).toContain("Identificador técnico: ${target.metricId}");
    expect(registry).toContain('metricId: "revenue.cash_collected"');
    expect(registry).toContain('displayName: "Caixa recebido"');
    expect(registry).toContain('metricId: "usage.active_users.dau"');
    expect(registry).toContain('displayName: "Usuários ativos diários (DAU)"');
    expect(registry).toContain('metricId: "trial.starts.count"');
    expect(registry).toContain('displayName: "Testes gratuitos iniciados"');
  });

  it("keeps Core query behind the governed API boundary", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/core-query-form.tsx"), "utf8");
    expect(source).toContain('fetch("/api/core/query"');
    expect(source).toContain("Provedor cognitivo indisponível");
    expect(source).toContain("contrato cognitivo governado");
    expect(source).not.toContain("Core canônico ainda não está conectado neste ambiente");
  });

  it("limpa a pergunta após o envio e mantém a resposta fora do campo", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/core-query-form.tsx"), "utf8");
    expect(source).toContain('const [question, setQuestion] = useState("")');
    expect(source).toContain("const normalizedQuestion = question.trim()");
    expect(source).toContain('setQuestion("")');
    expect(source).toContain("value={question}");
    expect(source).toContain("const scopedQuestion = domainContext");
    expect(source).toContain("body: JSON.stringify({ question: scopedQuestion })");
  });

  it("oferece ditado por microfone em português sem substituir a digitação", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/core-query-form.tsx"), "utf8");
    expect(source).toContain("webkitSpeechRecognition");
    expect(source).toContain('recognition.lang = "pt-BR"');
    expect(source).toContain('aria-label={listening ? "Parar reconhecimento de voz" : "Falar a pergunta"}');
    expect(source).toContain('voiceErrorMessage');
    expect(source).toContain('Reconhecimento de voz não disponível neste navegador.');
    expect(source).toContain("activeRecognition.abort()");
  });

  it("recovers from transport or invalid-response failures instead of remaining in loading", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/core-query-form.tsx"), "utf8");
    expect(source).toContain("try {");
    expect(source).toContain("catch {");
    expect(source).toContain('setState({ status: "error", answer: cognitiveErrorMessage() })');
    expect(source).toContain('typeof payload.answer !== "string"');
  });
});
