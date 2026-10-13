import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  env: "development" | "production" | "test";
  dataDir: string;
  allowedOrigins: string[];
  chatgptWebHeadless: boolean;
  chatgptWebProfileDir: string;
  chatgptWebTimeoutMs: number;
}

/** Repository root of this orchestrator installation (src/ and dist/ are both three levels deep). */
export const ORCHESTRATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "AutonomousDevOrchestrator"
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "AutonomousDevOrchestrator");
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || process.env.XDG_DATA_HOME || path.join(os.homedir(), ".config"),
    "AutonomousDevOrchestrator"
  );
}

const defaultDataDir = getDefaultDataDir();

export const config: AppConfig = {
  host: process.env.ORCHESTRATOR_HOST || "127.0.0.1",
  port: parseInt(process.env.ORCHESTRATOR_PORT || "4317", 10),
  env: (process.env.NODE_ENV as AppConfig["env"]) || "development",
  dataDir: process.env.ORCHESTRATOR_DATA_DIR || defaultDataDir,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4317,http://127.0.0.1:4317")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  chatgptWebHeadless: process.env.CHATGPT_WEB_HEADLESS === "true",
  chatgptWebProfileDir: process.env.CHATGPT_WEB_PROFILE_DIR || path.join(process.env.ORCHESTRATOR_DATA_DIR || defaultDataDir, "browser", "chatgpt"),
  chatgptWebTimeoutMs: parseInt(process.env.CHATGPT_WEB_TIMEOUT_MS || "300000", 10),
};
