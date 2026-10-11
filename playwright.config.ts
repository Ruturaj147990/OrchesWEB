import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// The e2e server gets its own port and a throwaway data directory, so it never touches
// the user's real orchestrator settings, database or a server they already have running.
export const E2E_PORT = 4318;
// The config is evaluated by the runner and again by workers; create the directory once.
if (!process.env.ORCHES_E2E_DATA_DIR) {
  process.env.ORCHES_E2E_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "orches-e2e-data-"));
}
export const E2E_DATA_DIR = process.env.ORCHES_E2E_DATA_DIR;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Builds the real UI and serves it from the real server (no dev proxy, no mocks).
    command: "npm run build:packages && npm run build --workspace=apps/web && npx tsx apps/server/src/server.ts",
    url: `http://127.0.0.1:${E2E_PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ORCHESTRATOR_PORT: String(E2E_PORT),
      ORCHESTRATOR_DATA_DIR: E2E_DATA_DIR,
      OPENAI_API_KEY: "",
    },
  },
});
