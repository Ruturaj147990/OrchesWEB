import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";

export interface LocalProviderConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class OpenAICompatibleLocalProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Local LLM (OpenAI-Compatible)";
  public privacyClass: PrivacyClass = "local";
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: LocalProviderConfig = {}) {
    this.baseUrl = (config.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
    this.model = config.model || "llama3.1:8b";
    this.apiKey = config.apiKey || "local";
    // Default 3-minute cold start allowance (180,000ms), configurable up to 300,000ms
    this.timeoutMs = Math.min(Math.max(config.timeoutMs || 180000, 10000), 300000);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getModel(): string {
    return this.model;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  private getNormalizedChatUrl(): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    if (base.endsWith("/v1")) {
      return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
  }

  public async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      const latency = Date.now() - start;

      if (models.length > 0) {
        const hasSelectedModel = models.some(
          (m) => m === this.model || m.startsWith(`${this.model}:`) || `${m}:latest` === this.model
        );
        return {
          ok: true,
          latencyMs: latency,
          discoveredModels: models,
          message: hasSelectedModel
            ? `Connected to local server (${latency}ms). Model '${this.model}' is ready.`
            : `Connected to local server (${latency}ms). Warning: '${this.model}' not in installed list (${models.join(", ")}).`,
        };
      }

      // If listModels returned empty, probe /models or /v1/models directly
      const controller = new AbortController();
      const probeTimeout = setTimeout(() => controller.abort(), 4000);

      const probeUrl = this.baseUrl.endsWith("/v1")
        ? `${this.baseUrl}/models`
        : `${this.baseUrl}/v1/models`;

      const res = await fetch(probeUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(probeTimeout);

      if (res.ok) {
        return {
          ok: true,
          latencyMs: Date.now() - start,
          discoveredModels: [],
          message: `Connected to ${this.baseUrl} (${Date.now() - start}ms).`,
        };
      }

      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: `Local endpoint responded with HTTP ${res.status}: ${res.statusText}`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: `Failed to connect to local reasoning endpoint at ${this.baseUrl}: ${(err as Error).message}. Local-only mode strictly forbids falling back to cloud.`,
      };
    }
  }

  public async listModels(): Promise<string[]> {
    const base = this.baseUrl.replace(/\/+$/, "");

    // 1. Try native Ollama endpoint /api/tags
    try {
      const nativeHost = base.replace(/\/v1$/, "");
      const res = await fetch(`${nativeHost}/api/tags`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        if (Array.isArray(data.models) && data.models.length > 0) {
          return data.models.map((m) => m.name);
        }
      }
    } catch {}

    // 2. Try OpenAI-compatible /models endpoint
    try {
      const modelsUrl = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        if (Array.isArray(data.data) && data.data.length > 0) {
          return data.data.map((m) => m.id);
        }
      }
    } catch {}

    return [];
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    const start = Date.now();
    const messages = [
      { role: "system", content: request.systemInstruction },
      ...request.messages,
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: request.maxOutputTokens || 4096,
    };

    if (request.responseSchema) {
      body.response_format = { type: "json_object" };
    }

    // Configure combined timeout controller supporting cold-start allowance
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Local model request timed out after ${this.timeoutMs}ms (cold start allowance reached)`));
    }, this.timeoutMs);

    // Link caller signal if provided
    const onCallerAbort = () => {
      timeoutController.abort(signal?.reason || new Error("Task execution cancelled"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new Error("Task execution was cancelled before model dispatch.");
      }
      signal.addEventListener("abort", onCallerAbort);
    }

    let response: Response;
    const chatUrl = this.getNormalizedChatUrl();

    try {
      response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onCallerAbort);

      const errMsg = (err as Error).message || String(err);
      if (errMsg.includes("cold start allowance reached") || (err as Error).name === "TimeoutError") {
        throw new Error(
          `[Local-Only Policy Enforcement] Request to local model '${this.model}' timed out after ${this.timeoutMs / 1000}s. Heavy models may require additional GPU/VRAM cold-start load time. You can adjust the timeout in Settings.`
        );
      }
      throw new Error(
        `[Local-Only Policy Enforcement] Local reasoning endpoint unreachable at ${chatUrl}. Task halted without cloud fallback: ${errMsg}`
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onCallerAbort);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `[Local-Only Policy Enforcement] Local provider returned HTTP ${response.status}: ${errText}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content || "";
    let parsed: unknown = undefined;
    if (request.responseSchema && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Raw text retained
      }
    }

    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;

    return {
      text,
      parsed,
      providerId: this.id,
      modelId: this.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      durationMs: Date.now() - start,
      warnings: [],
    };
  }
}

