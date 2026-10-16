import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.FMCC_E2E_PORT ?? "3000";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- -H 127.0.0.1 -p ${e2ePort}`,
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Provedor de canais simulado: o e2e prova a tela sem enviar nada a ninguém.
    env: { FMCC_CHANNEL_SIMULATED: "1", FMCC_CHANNEL_ALLOW_SIMULATED: "1" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
