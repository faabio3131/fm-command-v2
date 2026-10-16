import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F11 Product Intelligence UI/API contract", () => {
  it("dashboard expõe produtos e comparação sem criar score mágico", () => {
    const source = readUiSource("src/app/dashboard/page.tsx");
    expect(source).toContain("Inteligência por produto");
    expect(source).toContain("Comparação governada");
    expect(source).toContain("ProductCreateForm");
    expect(source).not.toContain("product.performance.score");
  });

  it("visão individual explicita semântica pendente e provenance", () => {
    const source = readUiSource("src/app/dashboard/products/[productId]/page.tsx");
    expect(source).toContain("Semântica pendente");
    expect(source).toContain("Sem proveniência factual disponível");
    expect(source).toContain("Nenhum índice composto é produzido");
  });

  it("cadastro preserva o form antes da fronteira assíncrona e trata resposta não-JSON", () => {
    const source = readUiSource("src/app/dashboard/product-create-form.tsx");
    expect(source).toContain("const formElement = event.currentTarget");
    expect(source).toContain("const form = new FormData(formElement)");
    expect(source).toContain("formElement.reset()");
    expect(source).not.toContain("event.currentTarget.reset()");
    expect(source).toContain("async function responsePayload");
    expect(source).toContain("catch {");
  });

  it("API de comparação usa productIds explícitos", () => {
    const source = readUiSource("src/app/api/products/compare/route.ts");
    expect(source).toContain('getAll("productId")');
    expect(source).toContain("ProductIntelligenceService");
  });
});
