import { describe, expect, it } from "vitest";
import {
  rotuloEstadoOcorrencia,
  rotuloEstadoRegraAlerta,
  rotuloMetrica,
  rotuloNivelRiscoAcao,
  rotuloOperadorAlerta,
  rotuloSeveridadeAlerta,
} from "@/presentation/pt-br";

describe("rótulos pt-BR de alertas", () => {
  it("traduz métrica, operador, severidade e estados sem alterar os identificadores internos", () => {
    expect(rotuloMetrica("usage.engagement.events")).toBe("Eventos de engajamento");
    expect(rotuloOperadorAlerta("gt")).toBe("Maior que");
    expect(rotuloOperadorAlerta("gte")).toBe("Maior ou igual a");
    expect(rotuloSeveridadeAlerta("critical")).toBe("Crítica");
    expect(rotuloSeveridadeAlerta("warning")).toBe("Atenção");
    expect(rotuloEstadoRegraAlerta(true, false)).toBe("Ativa");
    expect(rotuloEstadoRegraAlerta(false, false)).toBe("Desativada");
    expect(rotuloEstadoRegraAlerta(false, true)).toBe("Arquivada");
    expect(rotuloEstadoOcorrencia("acknowledged")).toBe("Reconhecida");
    expect(rotuloNivelRiscoAcao("low")).toBe("Baixo risco");
    expect(rotuloNivelRiscoAcao("medium")).toBe("Risco médio");
    expect(rotuloNivelRiscoAcao("high")).toBe("Alto risco");
  });
});
