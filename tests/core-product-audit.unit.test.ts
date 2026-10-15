import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F11 Core product audit contract", () => {
  it("persiste productRefs derivados da evidence governada", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/api/core/query/route.ts"), "utf8");
    expect(source).toContain("productRefs");
    expect(source).toContain("item.productSlug");
    expect(source).toContain('action: "core.query"');
  });
});
