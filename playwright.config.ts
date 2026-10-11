import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDataDir = path.join(os.tmpdir(), "orchestrator-e2e-data");
if (fs.existsSync(testDataDir)) {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:4317/api/v1/health",
      reuseExistingServer: true,
      timeout: 15000,
      env: {
        ORCHESTRATOR_DATA_DIR: path.join(os.tmpdir(), "orchestrator-e2e-data"),
        NODE_ENV: "test",
      },
    },
    {
      command: "npm run dev:web",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
