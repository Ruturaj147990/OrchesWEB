import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth, wantsJson, ledgerRequestType } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";
import { ReasoningUsageLedger } from "../../../domain/budgets/usage-ledger.js";

export interface LocalProviderConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Context window requested from Ollama (ignored by other OpenAI-compatible servers). */
  contextTokens?: number;
}

export interface OllamaNormalizedEndpoints {
  serverOrigin: string;
  nativeVersionUrl: string;
  nativeTagsUrl: string;
  nativeChatUrl: string;
  openAiBaseUrl: string;
  openAiModelsUrl: string;
  chatCompletionsUrl: string;
}

export function normalizeOllamaEndpoint(rawUrl: string): OllamaNormalizedEndpoints {
  let cleaned = (rawUrl || "http://127.0.0.1:11434").trim();
  if (!/^https?:\/\//i.test(cleaned)) cleaned = `http://${cleaned}`;
  let base: string;
  try {
    const parsed = new URL(cleaned);
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/v1")) pathname = pathname.slice(0, -3);
    else if (pathname.endsWith("/api")) pathname = pathname.slice(0, -4);
    base = `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    base = cleaned.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  }
  return {
    serverOrigin: base,
    nativeVersionUrl: `${base}/api/version`,
    nativeTagsUrl: `${base}/api/tags`,
    nativeChatUrl: `${base}/api/chat`,
    openAiBaseUrl: `${base}/v1`,
    openAiModelsUrl: `${base}/v1/models`,
    chatCompletionsUrl: `${base}/v1/chat/completions`,
  };
}

function modelMatches(installed: string, wanted: string): boolean {
  return installed === wanted || installed === `${wanted}:latest` || `${installed}:latest` === wanted;
}

/**
 * Local reasoning through Ollama (native API, so the context window can be set)
 * or any OpenAI-compatible server. Never falls back to a cloud provider.
 */
export class OpenAICompatibleLocalProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Local model (Ollama / OpenAI-compatible)";
  public privacyClass: PrivacyClass = "local";
  private endpoints: OllamaNormalizedEndpoints;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private contextTokens: number;
  private isOllama: boolean | null = null;

  constructor(config: LocalProviderConfig = {}) {
    this.endpoints = normalizeOllamaEndpoint(config.baseUrl || "http://127.0.0.1:11434");
    this.model = config.model || "qwen3:30b";
    this.apiKey = config.apiKey || "local";
    this.timeoutMs = Math.min(Math.max(config.timeoutMs || 300_000, 10_000), 900_000);
    this.contextTokens = Math.min(Math.max(config.contextTokens || 16_384, 2048), 131_072);
  }

  public getBaseUrl(): string {
    return this.endpoints.serverOrigin;
  }

  public getEndpoints(): OllamaNormalizedEndpoints {
    return { ...this.endpoints };
  }

  public getModel(): string {
    return this.model;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  private async detectOllama(): Promise<{ isOllama: boolean; version?: string }> {
    try {
      const res = await fetch(this.endpoints.nativeVersionUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        this.isOllama = typeof data.version === "string";
        return { isOllama: this.isOllama, version: data.version };
      }
    } catch {}
    this.isOllama = false;
    return { isOllama: false };
  }

  public async listModels(): Promise<string[]> {
    try {
      const res = await fetch(this.endpoints.nativeTagsUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        if (Array.isArray(data.models)) return data.models.map((m) => m.name);
      }
    } catch {}
    try {
      const res = await fetch(this.endpoints.openAiModelsUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        if (Array.isArray(data.data)) return data.data.map((m) => m.id);
      }
    } catch {}
    return [];
  }

  public async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    const origin = this.endpoints.serverOrigin;
    const { version } = await this.detectOllama();
    const models = await this.listModels();
    const latencyMs = Date.now() - start;

    if (!version && models.length === 0) {
      return {
        ok: false,
        status: "server_unreachable",
        latencyMs,
        normalizedOrigin: origin,
        message: `No local model server answered at ${origin}. Start Ollama (or your OpenAI-compatible server) and try again.`,
      };
    }
    if (models.length > 0 && !models.some((m) => modelMatches(m, this.model))) {
      return {
        ok: false,
        status: "model_unavailable",
        latencyMs,
        serverVersion: version,
        discoveredModels: models,
        normalizedOrigin: origin,
        installCommand: `ollama pull ${this.model}`,
        message: `Server is running${version ? ` (Ollama ${version})` : ""} but model '${this.model}' is not installed. Installed: ${models.join(", ")}.`,
      };
    }
    return {
      ok: true,
      status: "ready",
      latencyMs,
      serverVersion: version,
      discoveredModels: models,
      normalizedOrigin: origin,
      message: `${version ? `Ollama ${version}` : "Local server"} is running and model '${this.model}' is available.`,
    };
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (signal?.aborted) throw new Error("Request cancelled before it was sent.");
    if (this.isOllama === null) await this.detectOllama();

    const start = Date.now();
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => controller.abort(new Error("cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });

    const messages = [{ role: "system", content: request.systemInstruction }, ...request.messages];
    const json = wantsJson(request);
    const maxTokens = request.maxOutputTokens || 4096;

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const url = this.isOllama ? this.endpoints.nativeChatUrl : this.endpoints.chatCompletionsUrl;
    try {
      const body = this.isOllama
        ? {
            model: this.model,
            messages,
            stream: false,
            ...(json ? { format: "json" } : {}),
            options: { num_ctx: this.contextTokens, num_predict: maxTokens, temperature: request.temperature ?? 0.2 },
          }
        : {
            model: this.model,
            messages,
            max_tokens: maxTokens,
            temperature: request.temperature ?? 0.2,
            ...(json ? { response_format: { type: "json_object" } } : {}),
          };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errText = (await response.text()).slice(0, 500);
        if (response.status === 404) {
          throw new Error(`Local model server returned HTTP 404: model '${this.model}' not found. Run 'ollama pull ${this.model}' or configure an available model.`);
        }
        throw new Error(`Local model server returned HTTP ${response.status}: ${errText}`);
      }
      if (this.isOllama) {
        const data = (await response.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; done_reason?: string };
        text = data.message?.content || "";
        inputTokens = data.prompt_eval_count || 0;
        outputTokens = data.eval_count || 0;
      } else {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        text = data.choices?.[0]?.message?.content || "";
        inputTokens = data.usage?.prompt_tokens || 0;
        outputTokens = data.usage?.completion_tokens || 0;
      }
    } catch (err) {
      const reason = (controller.signal.reason as Error | undefined)?.message;
      const message =
        reason === "timeout"
          ? `Local model '${this.model}' did not answer within ${Math.round(timeoutMs / 1000)}s.`
          : reason === "cancelled"
            ? "Request cancelled."
            : `Local model request to ${url} failed: ${(err as Error).message}`;
      ReasoningUsageLedger.getShared().record({
        providerId: this.id,
        modelId: this.model,
        requestType: ledgerRequestType(request.operation),
        projectId: request.projectId,
        runId: request.runId,
        taskId: request.taskId,
        promptTokens: 0,
        completionTokens: 0,
        durationMs: Date.now() - start,
        success: false,
        errorMessage: message,
      });
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    const durationMs = Date.now() - start;
    ReasoningUsageLedger.getShared().record({
      providerId: this.id,
      modelId: this.model,
      requestType: ledgerRequestType(request.operation),
      projectId: request.projectId,
      runId: request.runId,
      taskId: request.taskId,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      durationMs,
      success: true,
    });

    const warnings: string[] = [];
    if (inputTokens >= this.contextTokens - 32) {
      warnings.push(`Prompt filled the ${this.contextTokens}-token context window; earlier content may have been truncated by the server.`);
    }
    let parsed: unknown = undefined;
    if (json && text) {
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
      durationMs,
      warnings,
    };
  }
}
