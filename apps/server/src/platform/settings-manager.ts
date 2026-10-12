import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";

export type ProviderId = "chatgpt-web";

export interface PersistedSettings {
  activeProviderId: ProviderId;
  chatgptWebHeadless: boolean;
  chatgptWebProfileDir?: string;
  chatgptWebTimeoutMs: number;
  chatgptWebGenerationTimeoutMs: number;
  chatgptWebMaxRetries: number;
  codingAgentId: string;
  maxAttempts: number;
}

const DEFAULTS = (): PersistedSettings => ({
  activeProviderId: "chatgpt-web",
  chatgptWebHeadless: config.chatgptWebHeadless,
  chatgptWebProfileDir: config.chatgptWebProfileDir,
  chatgptWebTimeoutMs: config.chatgptWebTimeoutMs,
  chatgptWebGenerationTimeoutMs: 180_000,
  chatgptWebMaxRetries: 3,
  codingAgentId: "builtin",
  maxAttempts: 3,
});

/**
 * Settings persisted as JSON in the orchestrator data directory (never inside a
 * project workspace).
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
        settings.activeProviderId = "chatgpt-web";
        if (typeof raw.chatgptWebHeadless === "boolean") {
          settings.chatgptWebHeadless = raw.chatgptWebHeadless;
        }
        if (typeof raw.chatgptWebProfileDir === "string" && raw.chatgptWebProfileDir.trim()) {
          settings.chatgptWebProfileDir = raw.chatgptWebProfileDir.trim();
        }
        if (typeof raw.chatgptWebTimeoutMs === "number" && raw.chatgptWebTimeoutMs > 0) {
          settings.chatgptWebTimeoutMs = raw.chatgptWebTimeoutMs;
        }
        if (typeof raw.chatgptWebGenerationTimeoutMs === "number" && raw.chatgptWebGenerationTimeoutMs > 0) {
          settings.chatgptWebGenerationTimeoutMs = raw.chatgptWebGenerationTimeoutMs;
        }
        if (typeof raw.chatgptWebMaxRetries === "number" && raw.chatgptWebMaxRetries >= 1) {
          settings.chatgptWebMaxRetries = raw.chatgptWebMaxRetries;
        }
        if (typeof raw.codingAgentId === "string" && raw.codingAgentId) {
          settings.codingAgentId = raw.codingAgentId;
        }
        if (typeof raw.maxAttempts === "number" && raw.maxAttempts >= 1 && raw.maxAttempts <= 30) {
          settings.maxAttempts = Math.round(raw.maxAttempts);
        }
      } catch (err) {
        console.error(`[settings] Ignoring unreadable ${file}: ${(err as Error).message}`);
      }
    }
    return settings;
  }

  public static saveSettings(updates: Partial<PersistedSettings>): PersistedSettings {
    const merged = { ...this.loadSettings(), ...updates };
    merged.activeProviderId = "chatgpt-web";
    const file = this.filePath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return merged;
  }
}
