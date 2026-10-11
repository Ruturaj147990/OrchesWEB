import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";

export type ProviderId = "openai-compatible-local" | "openai";

export interface PersistedSettings {
  activeProviderId: ProviderId;
  openaiApiKey?: string;
  openaiModel: string;
  localBaseUrl: string;
  localModel: string;
  localTimeoutMs: number;
  localContextTokens: number;
  codingAgentId: string;
  maxAttempts: number;
}

const DEFAULTS = (): PersistedSettings => ({
  activeProviderId: "openai-compatible-local",
  openaiModel: "gpt-4o-mini",
  localBaseUrl: config.localReasoningBaseUrl,
  localModel: config.localReasoningModel,
  localTimeoutMs: 300_000,
  localContextTokens: 16_384,
  codingAgentId: "builtin",
  maxAttempts: 3,
});

/**
 * Settings persisted as JSON in the orchestrator data directory (never inside a
 * project workspace). The OpenAI key may also come from OPENAI_API_KEY.
 */
export class SettingsManager {
  private static customDataDir: string | null = null;

  public static setDataDir(dir: string | null): void {
    this.customDataDir = dir;
  }

  public static reset(): void {
    this.customDataDir = null;
  }

  public static getDataDir(): string {
    return this.customDataDir || config.dataDir;
  }

  private static filePath(): string {
    const dir = this.getDataDir();
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "settings.json");
  }

  public static loadSettings(): PersistedSettings {
    const settings = DEFAULTS();
    const file = this.filePath();
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        // Older builds used defaultProviderId/defaultModel/localTimeoutMs naming.
        const providerId = (raw.activeProviderId ?? raw.defaultProviderId) as string | undefined;
        if (providerId === "openai" || providerId === "openai-compatible-local") settings.activeProviderId = providerId;
        if (typeof raw.openaiApiKey === "string" && raw.openaiApiKey.trim()) settings.openaiApiKey = raw.openaiApiKey.trim();
        const openaiModel = (raw.openaiModel ?? raw.defaultModel) as string | undefined;
        if (typeof openaiModel === "string" && openaiModel.trim()) settings.openaiModel = openaiModel.trim();
        if (typeof raw.localBaseUrl === "string" && raw.localBaseUrl.trim()) settings.localBaseUrl = raw.localBaseUrl.trim();
        if (typeof raw.localModel === "string" && raw.localModel.trim()) settings.localModel = raw.localModel.trim();
        if (typeof raw.localTimeoutMs === "number" && raw.localTimeoutMs > 0) settings.localTimeoutMs = raw.localTimeoutMs;
        if (typeof raw.localContextTokens === "number" && raw.localContextTokens > 0) settings.localContextTokens = raw.localContextTokens;
        if (typeof raw.codingAgentId === "string" && raw.codingAgentId) settings.codingAgentId = raw.codingAgentId;
        if (typeof raw.maxAttempts === "number" && raw.maxAttempts >= 1 && raw.maxAttempts <= 8) settings.maxAttempts = Math.round(raw.maxAttempts);
      } catch (err) {
        console.error(`[settings] Ignoring unreadable ${file}: ${(err as Error).message}`);
      }
    }
    const envKey = process.env.OPENAI_API_KEY;
    if (!settings.openaiApiKey && envKey && envKey.trim() && !this.customDataDir) {
      settings.openaiApiKey = envKey.trim();
    }
    return settings;
  }

  public static saveSettings(updates: Partial<PersistedSettings>): PersistedSettings {
    const merged = { ...this.loadSettings(), ...updates };
    const file = this.filePath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return merged;
  }

  public static clearOpenAiKey(): PersistedSettings {
    const current = this.loadSettings();
    delete current.openaiApiKey;
    const file = this.filePath();
    fs.writeFileSync(file, JSON.stringify(current, null, 2), "utf8");
    return current;
  }

  public static maskApiKey(key?: string): string {
    if (!key) return "";
    const clean = key.trim();
    if (clean.length <= 10) return "••••••••";
    return `${clean.slice(0, 3)}…${clean.slice(-4)}`;
  }
}
