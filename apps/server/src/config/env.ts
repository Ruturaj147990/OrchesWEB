import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  env: "development" | "production" | "test";
  dataDir: string;
  allowedOrigins: string[];
  localReasoningBaseUrl: string;
  localReasoningModel: string;
}

/** Repository root of this orchestrator installation (src/ and dist/ are both three levels deep). */
export const ORCHESTRATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const defaultDataDir = path.join(
  process.env.APPDATA ||
    (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config")),
  "AutonomousDevOrchestrator"
);

export const config: AppConfig = {
  host: process.env.ORCHESTRATOR_HOST || "127.0.0.1",
  port: parseInt(process.env.ORCHESTRATOR_PORT || "4317", 10),
  env: (process.env.NODE_ENV as AppConfig["env"]) || "development",
  dataDir: process.env.ORCHESTRATOR_DATA_DIR || defaultDataDir,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4317,http://127.0.0.1:4317")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  localReasoningBaseUrl: process.env.LOCAL_REASONING_BASE_URL || "http://127.0.0.1:11434",
  localReasoningModel: process.env.LOCAL_REASONING_MODEL || "llama3.1:8b",
};
