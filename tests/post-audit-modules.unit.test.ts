import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

const source = (path: string) => readUiSource(path);

describe("post-audit executive modules", () => {
  it("constrói Trials sobre MetricService sem inventar conversão", () => {
    const page = source("src/app/dashboard/trials/page.tsx");
    expect(page).toContain("createMetricService().overview(");
    expect(page).toContain("selectedProduct?.id");
    expect(page).toContain("trial.starts.count");
    expect(page).toContain("trial.active.count");
    expect(page).toContain("trial.conversion.rate");
    expect(page).toContain("Semântica pendente");
  });

  it("constrói Assinaturas com separação financeira explícita", () => {
    const page = source("src/app/dashboard/subscriptions/page.tsx");
    expect(page).toContain("subscription.active.count");
    expect(page).toContain("revenue.mrr");
    expect(page).toContain("receivable.delinquent_amount");
    expect(page).toContain("faturamento emitido e caixa recebido permanecem métricas distintas");
  });

  it("centraliza Configurações sem duplicar as autoridades existentes", () => {
    const page = source("src/app/dashboard/settings/page.tsx");
    expect(page).toContain("roleHasPermission");
    expect(page).toContain("/dashboard/sources");
    expect(page).toContain("/dashboard/alerts");
  });
});
