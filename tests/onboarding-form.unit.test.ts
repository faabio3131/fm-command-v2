import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("onboarding form metadata", () => {
  it("declara autocomplete explícito nos campos de organização", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/onboarding/onboarding-client.tsx"),
      "utf8",
    );
    expect(source).toContain('autoComplete="organization"');
    expect(source).toContain('autoComplete="off"');
  });
});
