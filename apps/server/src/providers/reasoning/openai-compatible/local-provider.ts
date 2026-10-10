import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";

export interface LocalProviderConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export class OpenAICompatibleLocalProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Local LLM (OpenAI-Compatible)";
  public privacyClass: PrivacyClass = "local";
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: LocalProviderConfig = {}) {
    this.baseUrl = (config.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
    this.model = config.model || "llama3.1:8b";
    this.apiKey = config.apiKey || "local";
  }

  public async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          message: `Local endpoint responded with HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const modelList = data.data?.map((m) => m.id) || [];

      return {
        ok: true,
        latencyMs: Date.now() - start,
        discoveredModels: modelList,
        message: `Connected to ${this.baseUrl}. Models available: ${modelList.length}`,
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
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return data.data?.map((m) => m.id) || [];
    } catch {
      return [];
    }
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

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      throw new Error(
        `[Local-Only Policy Enforcement] Local reasoning endpoint unreachable at ${this.baseUrl}. Task halted without cloud fallback: ${(err as Error).message}`
      );
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
