import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("KCA-12 commercial pt-BR UI contract", () => {
  it("mantém linguagem principal em português e ausência diferente de zero", () => {
    const page = readFileSync(
      new URL("../src/app/dashboard/commercial/kordena/page.tsx", import.meta.url),
      "utf8",
    );
    const form = readFileSync(
      new URL(
        "../src/app/dashboard/commercial/kordena/kordena-commercial-admin-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(page).toContain("Plano de controle comercial");
    expect(page).toContain("Testes gratuitos ativos");
    expect(page).toContain("Assinaturas vencidas ou em atraso");
    expect(page).toContain("Plataforma Comercial canônica");
    expect(page).not.toContain("Trials ativos");
    expect(page).not.toContain("Past due / vencimentos");
    expect(page).not.toContain("Commercial Platform");
    expect(page).not.toContain("?? 0");

    expect(form).toContain("Criar versão de plano");
    expect(form).toContain("Publicar preço");
    expect(form).toContain("Visualizar prévia antes de publicar");
    expect(form).toContain("Aprovação server-side temporária");
    expect(form).not.toContain(">plan_version.create<");
    expect(form).not.toContain("preview/diff");
    expect(form).toContain("send(requiredPreview, proposedPayload)");
    expect(form).not.toContain("approvalContext");
  });
});
