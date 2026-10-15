import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false }
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname }
  }
});
