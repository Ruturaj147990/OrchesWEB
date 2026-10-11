import { OpenAI } from "openai";
import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";
import { ReasoningUsageLedger } from "../../../domain/budgets/usage-ledger.js";

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
  private hasKey: boolean = false;

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model || "gpt-4o-mini";
    if (config.apiKey && config.apiKey.trim()) {
      this.client = new OpenAI({ apiKey: config.apiKey.trim() });
      this.hasKey = true;
    }
  }

  public getModel(): string {
    return this.model;
  }

  public isConfigured(): boolean {
    return this.hasKey;
  }

  public async healthCheck(): Promise<ProviderHealth> {
    if (!this.client || !this.hasKey) {
      return {
        ok: false,
        status: "not_detected",
        message: "OpenAI API key is not configured in backend settings.",
      };
    }
    const start = Date.now();
    try {
      const models = await this.client.models.list();
      const modelIds = models.data.map((m) => m.id);
      const latency = Date.now() - start;
      return {
        ok: true,
        status: "ready",
        latencyMs: latency,
        discoveredModels: modelIds.slice(0, 10),
        message: `Valid OpenAI API credential verified (${latency}ms). Connected to OpenAI API.`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: "request_failed",
        latencyMs: Date.now() - start,
        message: `OpenAI connection test failed: ${(err as Error).message}`,
      };
    }
  }

  public async listModels(): Promise<string[]> {
    if (!this.client || !this.hasKey) return [];
    try {
      const models = await this.client.models.list();
      return models.data.map((m) => m.id);
    } catch {
      return [];
    }
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (!this.client || !this.hasKey) {
      throw new Error("OpenAI API key is not configured. Cloud reasoning unavailable.");
    }

    const start = Date.now();
    const messages = [
      { role: "system" as const, content: request.systemInstruction },
      ...request.messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
    ];

    try {
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
      const durationMs = Date.now() - start;

      // Persist real paid reasoning usage to ledger
      ReasoningUsageLedger.getShared().record({
        providerId: this.id,
        modelId: this.model,
        requestType: request.operation === "task_planning" ? "planner" : request.operation === "result_review" ? "critic" : "planner",
        projectId: request.projectId,
        taskId: request.taskId,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        durationMs,
        success: true,
      });

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
        durationMs,
        warnings: [],
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      ReasoningUsageLedger.getShared().record({
        providerId: this.id,
        modelId: this.model,
        requestType: request.operation === "task_planning" ? "planner" : request.operation === "result_review" ? "critic" : "planner",
        projectId: request.projectId,
        taskId: request.taskId,
        promptTokens: 0,
        completionTokens: 0,
        durationMs,
        success: false,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }
}
