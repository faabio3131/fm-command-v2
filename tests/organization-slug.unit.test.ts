import { describe, expect, it } from "vitest";
import { ORGANIZATION_SLUG_PATTERN, isValidOrganizationSlug } from "@/domain/organization/slug";

describe("organization slug validation", () => {
  it("compila com as semânticas RegExp v usadas pelo pattern HTML moderno", () => {
    expect(() => new RegExp(`^(?:${ORGANIZATION_SLUG_PATTERN})$`, "v")).not.toThrow();
  });

  it.each([
    "nova-fm-tecnologia",
    "empresa-teste-b",
    "tenant1",
    "abc123-def456",
  ])("aceita slug válido: %s", (slug) => {
    expect(isValidOrganizationSlug(slug)).toBe(true);
  });

  it.each([
    "-nova-fm",
    "nova-fm-",
    "nova--fm",
    "Nova-FM",
    "nova fm",
    "nova_fm",
  ])("rejeita slug inválido: %s", (slug) => {
    expect(isValidOrganizationSlug(slug)).toBe(false);
  });
});
