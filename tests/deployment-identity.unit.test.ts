import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/version/route";

const original = {
  RENDER: process.env.RENDER,
  RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
  RENDER_GIT_BRANCH: process.env.RENDER_GIT_BRANCH,
};

afterEach(() => {
  if (original.RENDER === undefined) delete process.env.RENDER;
  else process.env.RENDER = original.RENDER;

  if (original.RENDER_GIT_COMMIT === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = original.RENDER_GIT_COMMIT;

  if (original.RENDER_GIT_BRANCH === undefined) delete process.env.RENDER_GIT_BRANCH;
  else process.env.RENDER_GIT_BRANCH = original.RENDER_GIT_BRANCH;
});

describe("deployment identity endpoint", () => {
  it("exposes only non-sensitive Render deployment identity", async () => {
    process.env.RENDER = "true";
    process.env.RENDER_GIT_COMMIT = "abc123";
    process.env.RENDER_GIT_BRANCH = "main";

    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "fm-control-center",
      environment: "render",
      gitCommit: "abc123",
      gitBranch: "main",
    });
  });

  it("fails informationally closed when deployment metadata is absent", async () => {
    delete process.env.RENDER;
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.RENDER_GIT_BRANCH;

    const response = GET();
    await expect(response.json()).resolves.toEqual({
      service: "fm-control-center",
      environment: "unknown",
      gitCommit: null,
      gitBranch: null,
    });
  });
});
