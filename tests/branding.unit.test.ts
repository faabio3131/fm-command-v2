import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

function source(path: string) {
  return readUiSource(path);
}

describe("FM Command commercial naming", () => {
  it("apresenta FM Command nas superfícies comerciais principais", () => {
    expect(source("src/app/layout.tsx")).toContain('title: "FM Command | FM Tecnologia IA"');
    expect(source("src/app/page.tsx")).toContain("<h1>FM Command</h1>");
    expect(source("src/app/page.tsx")).toContain("Abrir FM Command");
    expect(source("src/app/dashboard/page.tsx")).toContain("<h1>FM Command</h1>");
    expect(source("src/app/onboarding/onboarding-client.tsx")).toContain("dados do FM Command");
  });

  it("preserva o namespace técnico FMCC sem rename destrutivo", () => {
    expect(source("package.json")).toContain('"name": "fm-control-center"');
    expect(
      source("src/application/deployment/deployment-identity.ts"),
    ).toContain('service: "fm-control-center"');
    expect(source("src/app/api/version/route.ts")).toContain(
      "readDeploymentIdentity()",
    );
    expect(source("README.md")).toContain("FM Control Center / FMCC");
    expect(source("README.md")).toContain("fmcommand.com.br");
  });

  it("registra a decisão arquitetural de nomenclatura", () => {
    const adr = source("docs/architecture/adr/ADR-014-fm-command-commercial-naming.md");
    expect(adr).toContain("**Status:** ACCEPTED");
    expect(adr).toContain("**Produto:** FM Command");
    expect(adr).toContain("**Domínio oficial:** `fmcommand.com.br`");
    expect(adr).toContain("Não haverá renomeação destrutiva apenas por branding.");
  });
});
