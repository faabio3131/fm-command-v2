import { describe, expect, it } from "vitest";
import {
  authorizedAvatarUrl,
  initialsFromName,
} from "@/domain/security/dashboard-identity";
import {
  deploymentEnvironmentLabel,
  type DeploymentIdentity,
} from "@/application/deployment/deployment-identity";
import { rotuloPapelFmcc } from "@/presentation/pt-br";

describe("CME-07 dashboard identity", () => {
  it("gera iniciais reais sem inventar nome", () => {
    expect(initialsFromName("Fabio Aluizio da Silva")).toBe("FS");
    expect(initialsFromName("Ana")).toBe("A");
    expect(initialsFromName("   ")).toBeNull();
    expect(initialsFromName(null)).toBeNull();
  });

  it("aceita avatar somente de URL web autorizável", () => {
    expect(authorizedAvatarUrl("https://cdn.example.test/avatar.png")).toBe(
      "https://cdn.example.test/avatar.png",
    );
    expect(authorizedAvatarUrl("http://localhost/avatar.png")).toBe(
      "http://localhost/avatar.png",
    );
    expect(authorizedAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(authorizedAvatarUrl("not-a-url")).toBeNull();
  });

  it("traduz somente papéis canônicos", () => {
    expect(rotuloPapelFmcc("owner")).toBe("Proprietário");
    expect(rotuloPapelFmcc("admin")).toBe("Administrador");
    expect(rotuloPapelFmcc("analyst")).toBe("Analista");
    expect(rotuloPapelFmcc("viewer")).toBe("Visualizador");
    expect(rotuloPapelFmcc("member")).toBe("Membro");
    expect(rotuloPapelFmcc("invented")).toBe("Papel não identificado");
  });

  it("não chama ambiente desconhecido de produção", () => {
    const unknown: DeploymentIdentity = {
      service: "fm-control-center",
      environment: "unknown",
      gitCommit: null,
      gitBranch: null,
    };
    const render: DeploymentIdentity = {
      service: "fm-control-center",
      environment: "render",
      gitCommit: "abc123",
      gitBranch: "preview/cme07",
    };
    expect(deploymentEnvironmentLabel(unknown)).toBe(
      "Ambiente não identificado",
    );
    expect(deploymentEnvironmentLabel(render)).toBe(
      "Render · preview/cme07",
    );
  });
});
