import { OpenAI } from "openai";
import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth, wantsJson, ledgerRequestType } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";
import { ReasoningUsageLedger } from "../../../domain/budgets/usage-ledger.js";

export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
  /** Override the API endpoint (tests point this at a local OpenAI-compatible server). */
  baseURL?: string;
  timeoutMs?: number;
}

export class OpenAIProvider implements ReasoningProvider {
  public id = "openai";
  public displayName = "OpenAI API";
  public privacyClass: PrivacyClass = "cloud";
  private client: OpenAI | null = null;
  private model: string;
  private customEndpoint: boolean;
  private timeoutMs: number;

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model || "gpt-4o-mini";
    this.customEndpoint = Boolean(config.baseURL);
    this.timeoutMs = config.timeoutMs || 180_000;
    if (config.apiKey && config.apiKey.trim()) {
      this.client = new OpenAI({ apiKey: config.apiKey.trim(), baseURL: config.baseURL, maxRetries: 1, timeout: this.timeoutMs });
    }
  }

  public getModel(): string {
    return this.model;
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  public async healthCheck(): Promise<ProviderHealth> {
    if (!this.client) {
      return { ok: false, status: "not_detected", message: "No OpenAI API key is configured." };
    }
    const start = Date.now();
    try {
      const models = await this.client.models.list();
      const ids = models.data.map((m) => m.id);
      const latencyMs = Date.now() - start;
      const hasModel = ids.includes(this.model);
      return {
        ok: hasModel,
        status: hasModel ? "ready" : "model_unavailable",
        latencyMs,
        discoveredModels: ids.filter((id) => /^(gpt|o\d)/.test(id)).slice(0, 30),
        message: hasModel
          ? `API key accepted; model '${this.model}' is available.`
          : `API key accepted, but model '${this.model}' is not available to this key.`,
      };
    } catch (err) {
      return { ok: false, status: "request_failed", latencyMs: Date.now() - start, message: `OpenAI API check failed: ${(err as Error).message}` };
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
    if (!this.client) throw new Error("OpenAI API key is not configured.");
    const start = Date.now();
    const messages = [
      { role: "system" as const, content: request.systemInstruction },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const maxTokens = request.maxOutputTokens || 4096;
    const record = (success: boolean, promptTokens: number, completionTokens: number, errorMessage?: string) =>
      ReasoningUsageLedger.getShared().record({
        providerId: this.id,
        modelId: this.model,
        requestType: ledgerRequestType(request.operation),
        projectId: request.projectId,
        runId: request.runId,
        taskId: request.taskId,
        promptTokens,
        completionTokens,
        durationMs: Date.now() - start,
        success,
        errorMessage,
      });

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          ...(wantsJson(request) ? { response_format: { type: "json_object" as const } } : {}),
          // OpenAI's current models expect max_completion_tokens; generic compatible servers expect max_tokens.
          ...(this.customEndpoint ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
        },
        { signal, timeout: request.timeoutMs ?? this.timeoutMs }
      );
      const text = response.choices[0]?.message?.content || "";
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      record(true, inputTokens, outputTokens);
      let parsed: unknown = undefined;
      if (wantsJson(request) && text) {
        try {
          parsed = JSON.parse(text);
        } catch {}
      }
      return {
        text,
        parsed,
        providerId: this.id,
        modelId: this.model,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        durationMs: Date.now() - start,
        warnings: response.choices[0]?.finish_reason === "length" ? ["Response was cut off at the output token limit."] : [],
      };
    } catch (err) {
      const message = signal?.aborted ? "Request cancelled." : `OpenAI request failed: ${(err as Error).message}`;
      record(false, 0, 0, message);
      throw new Error(message);
    }
  }
}
