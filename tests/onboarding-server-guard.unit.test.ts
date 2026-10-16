import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("onboarding server-side guard", () => {
  it("exige sessao no servidor antes de renderizar o client", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/onboarding/page.tsx"),
      "utf8",
    );
    expect(source).toContain("auth.api.getSession");
    expect(source).toContain('redirect("/sign-in")');
    expect(source).toContain("<OnboardingClient");
  });
});
