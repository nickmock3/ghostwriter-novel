import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.GHOSTWRITER_E2E_PORT ?? "5173";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: `bun run e2e/support/start-server.ts --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
