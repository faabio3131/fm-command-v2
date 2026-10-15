import { describe, expect, it } from "vitest";
import { startupMigrationsEnabled } from "@/config/startup-migrations";

describe("startup migration gate", () => {
  it("habilita apenas com valor literal true", () => {
    expect(startupMigrationsEnabled("true")).toBe(true);
    expect(startupMigrationsEnabled("false")).toBe(false);
    expect(startupMigrationsEnabled("TRUE")).toBe(false);
    expect(startupMigrationsEnabled(undefined)).toBe(false);
  });
});
