import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

const testDataDir = path.join(os.tmpdir(), "orchestrator-vitest-data");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    env: {
      ORCHESTRATOR_DATA_DIR: testDataDir,
      NODE_ENV: "test",
    },
    testTimeout: 20000,
  },
});
