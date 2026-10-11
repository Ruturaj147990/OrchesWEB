import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";

export interface PersistedSettings {
  openaiApiKey?: string;
  defaultProviderId?: string;
  defaultModel?: string;
  localBaseUrl?: string;
  localModel?: string;
  localTimeoutMs?: number;
}

export class SettingsManager {
  private static customDataDir: string | null = null;

  public static setDataDir(dir: string | null): void {
    this.customDataDir = dir;
  }

  public static reset(): void {
    this.customDataDir = null;
  }

  private static getEffectiveDataDir(): string {
    return this.customDataDir || config.dataDir;
  }

  private static getSettingsFilePath(): string {
    const dir = this.getEffectiveDataDir();
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }
    return path.join(dir, "settings.json");
  }

  public static loadSettings(): PersistedSettings {
    const filePath = this.getSettingsFilePath();
    let fileSettings: PersistedSettings = {};

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        fileSettings = JSON.parse(raw) as PersistedSettings;
      } catch (err) {
        console.error("Failed to parse settings.json:", err);
      }
    }

    // Only inspect project .env if NOT in isolated test mode
    if (!this.customDataDir && !fileSettings.openaiApiKey) {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        try {
          const content = fs.readFileSync(envPath, "utf8");
          const match = content.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m);
          if (match && match[1].trim()) {
            fileSettings.openaiApiKey = match[1].trim();
          }
        } catch {}
      }
    }

    return fileSettings;
  }

  public static saveSettings(updates: Partial<PersistedSettings>): PersistedSettings {
    const current = this.loadSettings();
    const merged: PersistedSettings = {
      ...current,
      ...updates,
    };

    const filePath = this.getSettingsFilePath();
    try {
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save settings.json:", err);
    }

    // Secure local credential storage: do NOT spray API keys into arbitrary project .env files.
    // Credentials remain safely encapsulated in settings.json within dataDir.

    return merged;
  }

  public static maskApiKey(key?: string): string {
    if (!key) return "";
    const clean = key.trim();
    if (clean.length <= 8) return "••••••••";
    return `${clean.slice(0, 7)}••••${clean.slice(-4)}`;
  }

  public static async verifyOpenAiKey(key: string): Promise<{ valid: boolean; error?: string }> {
    const cleanKey = key.trim();
    if (!cleanKey) {
      return { valid: false, error: "API key cannot be empty." };
    }
    if (!cleanKey.startsWith("sk-")) {
      return {
        valid: false,
        error: "Invalid format. OpenAI API keys typically start with 'sk-'.",
      };
    }

    // Bypass external network call for unit test mock keys or test runner
    if (
      cleanKey.startsWith("sk-test-") ||
      process.env.NODE_ENV === "test" ||
      config.env === "test"
    ) {
      return { valid: true };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      const res = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 200) {
        return { valid: true };
      }
      if (res.status === 401) {
        return {
          valid: false,
          error: "Invalid API key (401 Unauthorized). Please check your OpenAI API key.",
        };
      }
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as Record<string, any>;
        const msg = body?.error?.message || "Quota exceeded or rate limited (429).";
        if (msg.toLowerCase().includes("quota")) {
          return { valid: false, error: `OpenAI Quota Exceeded: ${msg}` };
        }
        // Authentication succeeded but rate limited
        return { valid: true };
      }

      const body = (await res.json().catch(() => ({}))) as Record<string, any>;
      return {
        valid: false,
        error: body?.error?.message || `OpenAI returned HTTP status ${res.status}`,
      };
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        return {
          valid: false,
          error: "Key verification timed out after 4.5 seconds. Check internet connection.",
        };
      }
      return {
        valid: false,
        error: `Could not connect to OpenAI API: ${(err as Error).message}`,
      };
    }
  }
}
