import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F14 operations UI", () => {
  it("não apresenta uptime artificial e usa a autoridade operacional governada", () => {
    const source = readUiSource("src/app/dashboard/operations/page.tsx");
    expect(source).toContain("Health pontual não é uptime");
    expect(source).toContain("Disponibilidade só aparece");
    expect(source).toContain("OperationalHealthService");
    expect(source).toContain("PostgresOperationalHealthRepository");
    expect(source).toContain("Status dos Serviços");
    expect(source).toContain("Stale é tratado como desconhecido");
    expect(source).toContain("Nenhum serviço monitorado.");
    expect(source).not.toContain("99.9%");
    expect(source).not.toContain("Math.random");
  });
});
