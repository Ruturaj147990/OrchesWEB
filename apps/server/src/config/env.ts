import path from "node:path";
import os from "node:os";

export interface AppConfig {
  host: string;
  port: number;
  env: "development" | "production" | "test";
  dataDir: string;
  allowedOrigins: string[];
  openaiApiKey?: string;
  localReasoningBaseUrl: string;
  localReasoningModel: string;
  agyCliPath?: string;
}

const defaultDataDir = path.join(
  process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : path.join(os.homedir(), ".config")),
  "AutonomousDevOrchestrator"
);

export const config: AppConfig = {
  host: process.env.ORCHESTRATOR_HOST || "127.0.0.1",
  port: parseInt(process.env.ORCHESTRATOR_PORT || "4317", 10),
  env: (process.env.NODE_ENV as AppConfig["env"]) || "development",
  dataDir: process.env.ORCHESTRATOR_DATA_DIR || defaultDataDir,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4317,http://127.0.0.1:4317")
    .split(",")
    .map((s) => s.trim()),
  openaiApiKey: process.env.OPENAI_API_KEY,
  localReasoningBaseUrl: process.env.LOCAL_REASONING_BASE_URL || "http://127.0.0.1:11434/v1",
  localReasoningModel: process.env.LOCAL_REASONING_MODEL || "llama3.1:8b",
  agyCliPath: process.env.AGY_CLI_PATH,
};
