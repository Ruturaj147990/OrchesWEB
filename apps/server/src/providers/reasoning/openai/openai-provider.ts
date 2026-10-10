import { OpenAI } from "openai";
import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";

export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
}

export class OpenAIProvider implements ReasoningProvider {
  public id = "openai";
  public displayName = "OpenAI Cloud API";
  public privacyClass: PrivacyClass = "cloud";
  private client: OpenAI | null = null;
  private model: string;

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model || "gpt-4o-mini";
    if (config.apiKey) {
      this.client = new OpenAI({ apiKey: config.apiKey });
    }
  }

  public async healthCheck(): Promise<ProviderHealth> {
    if (!this.client) {
      return { ok: false, message: "OpenAI API key is not configured in backend settings" };
    }
    const start = Date.now();
    try {
      const models = await this.client.models.list();
      const modelIds = models.data.map((m) => m.id);
      return {
        ok: true,
        latencyMs: Date.now() - start,
        discoveredModels: modelIds.slice(0, 10),
      };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: (err as Error).message,
      };
    }
  }

  public async listModels(): Promise<string[]> {
    if (!this.client) return [];
    try {
      const models = await this.client.models.list();
      return models.data.map((m) => m.id);
    } catch {
      return [];
    }
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (!this.client) {
      throw new Error("OpenAI API key is not configured. Cloud reasoning unavailable.");
    }

    const start = Date.now();
    const messages = [
      { role: "system" as const, content: request.systemInstruction },
      ...request.messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
    ];

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        response_format: request.responseSchema ? { type: "json_object" } : undefined,
        max_tokens: request.maxOutputTokens || 4096,
      },
      { signal }
    );

    const text = response.choices[0]?.message?.content || "";
    let parsed: unknown = undefined;
    if (request.responseSchema && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Fallback: raw text retained
      }
    }

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;

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
