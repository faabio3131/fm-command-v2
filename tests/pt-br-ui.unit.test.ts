import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mensagemEstadoComparacao,
  rotuloAtualidade,
  rotuloCategoriaProduto,
  rotuloDirecaoCrescimento,
  rotuloEstadoComparacao,
  rotuloQualidade,
  rotuloStatusDefinicao,
  rotuloStatusProduto,
} from "@/presentation/pt-br";

describe("interface pt-BR", () => {
  it("traduz estados técnicos antes de apresentar ao usuário", () => {
    expect(rotuloStatusProduto("active")).toBe("Ativo");
    expect(rotuloStatusProduto("inactive")).toBe("Inativo");
    expect(rotuloEstadoComparacao("unavailable")).toBe("Indisponível");
    expect(rotuloEstadoComparacao("pending_semantics")).toBe("Semântica pendente");
    expect(rotuloEstadoComparacao("incompatible_currency")).toBe("Moedas incompatíveis");
    expect(rotuloEstadoComparacao("incompatible_period")).toBe("Períodos incompatíveis");
    expect(rotuloAtualidade("fresh")).toBe("Atual");
    expect(rotuloQualidade("verified")).toBe("Verificada");
    expect(rotuloStatusDefinicao("implemented")).toBe("Implementada");
    expect(rotuloCategoriaProduto("acquisition")).toBe("Aquisição");
    expect(rotuloDirecaoCrescimento("increased")).toBe("Aumentou");
    expect(mensagemEstadoComparacao("unavailable")).toContain("dados governados");
  });

  it("não renderiza status internos diretamente na comparação", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/product-comparison-form.tsx"), "utf8");
    expect(source).not.toContain("Estado: {result.status}");
    expect(source).toContain("rotuloEstadoComparacao(result.status)");
    expect(source).toContain("mensagemEstadoComparacao(result.status)");
    expect(source).toContain("Testes gratuitos iniciados");
  });

  it("não renderiza status de produto nem categorias internas diretamente", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    const product = readFileSync(resolve(process.cwd(), "src/app/dashboard/products/[productId]/page.tsx"), "utf8");

    expect(dashboard).not.toContain("{product.status}</span>");
    expect(dashboard).toContain("rotuloStatusProduto(product.status)");
    expect(dashboard).toContain("F11 · Inteligência por Produto");
    expect(dashboard).toContain("Portfólio");
    expect(dashboard).toContain("Atualidade:");

    expect(product).not.toContain("{target.category} ·");
    expect(product).not.toContain("Freshness:");
    expect(product).not.toContain("Growth");
    expect(product).not.toContain("score composto");
    expect(product).toContain("rotuloCategoriaProduto(target.category)");
    expect(product).toContain("Crescimento");
    expect(product).toContain("Sem proveniência factual disponível");
  });

  it("mantém autenticação e onboarding sem mensagens brutas do provedor", () => {
    const signIn = readFileSync(resolve(process.cwd(), "src/app/sign-in/page.tsx"), "utf8");
    const onboarding = readFileSync(resolve(process.cwd(), "src/app/onboarding/page.tsx"), "utf8");
    expect(signIn).not.toContain("result.error.message");
    expect(onboarding).not.toContain("result.error.message");
    expect(onboarding).not.toContain('>Tenant<');
  });
});
