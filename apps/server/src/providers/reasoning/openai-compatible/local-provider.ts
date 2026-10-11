import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";
import { ReasoningUsageLedger } from "../../../domain/budgets/usage-ledger.js";

export interface LocalProviderConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
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
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `http://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    let origin = `${parsed.protocol}//${parsed.host}`;
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/v1")) {
      pathname = pathname.slice(0, -3);
    } else if (pathname.endsWith("/api")) {
      pathname = pathname.slice(0, -4);
    }
    const basePath = pathname ? `${origin}${pathname}` : origin;

    return {
      serverOrigin: basePath,
      nativeVersionUrl: `${basePath}/api/version`,
      nativeTagsUrl: `${basePath}/api/tags`,
      nativeChatUrl: `${basePath}/api/chat`,
      openAiBaseUrl: `${basePath}/v1`,
      openAiModelsUrl: `${basePath}/v1/models`,
      chatCompletionsUrl: `${basePath}/v1/chat/completions`,
    };
  } catch {
    const stripped = cleaned.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    return {
      serverOrigin: stripped,
      nativeVersionUrl: `${stripped}/api/version`,
      nativeTagsUrl: `${stripped}/api/tags`,
      nativeChatUrl: `${stripped}/api/chat`,
      openAiBaseUrl: `${stripped}/v1`,
      openAiModelsUrl: `${stripped}/v1/models`,
      chatCompletionsUrl: `${stripped}/v1/chat/completions`,
    };
  }
}

export class OpenAICompatibleLocalProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Local LLM (OpenAI-Compatible)";
  public privacyClass: PrivacyClass = "local";
  private baseUrl: string;
  private endpoints: OllamaNormalizedEndpoints;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: LocalProviderConfig = {}) {
    this.baseUrl = config.baseUrl || "http://127.0.0.1:11434";
    this.endpoints = normalizeOllamaEndpoint(this.baseUrl);
    this.model = config.model || "llama3.1:8b";
    this.apiKey = config.apiKey || "local";
    // Default 3-minute cold start allowance (180,000ms), configurable up to 300,000ms
    this.timeoutMs = Math.min(Math.max(config.timeoutMs || 180000, 10000), 300000);
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

  private getNormalizedChatUrl(): string {
    return this.endpoints.chatCompletionsUrl;
  }

  public async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    const origin = this.endpoints.serverOrigin;

    // 1. First probe native Ollama /api/version
    let serverVersion: string | undefined = undefined;
    try {
      const vRes = await fetch(this.endpoints.nativeVersionUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (vRes.ok) {
        const vData = (await vRes.json()) as { version?: string };
        serverVersion = vData.version;
      }
    } catch {}

    // 2. Discover installed models via native /api/tags or OpenAI-compatible /v1/models
    try {
      const models = await this.listModels();
      const latency = Date.now() - start;

      if (models.length > 0 || serverVersion) {
        const hasSelectedModel = models.some(
          (m) => m === this.model || m.startsWith(`${this.model}:`) || `${m}:latest` === this.model
        );

        if (hasSelectedModel) {
          return {
            ok: true,
            status: "ready",
            latencyMs: latency,
            serverVersion,
            discoveredModels: models,
            normalizedOrigin: origin,
            message: `Connected to Ollama${serverVersion ? ` v${serverVersion}` : ""} (${latency}ms). Model '${this.model}' is installed and ready for reasoning.`,
          };
        } else {
          return {
            ok: false,
            status: "model_unavailable",
            latencyMs: latency,
            serverVersion,
            discoveredModels: models,
            normalizedOrigin: origin,
            installCommand: `ollama pull ${this.model}`,
            message: `Ollama${serverVersion ? ` v${serverVersion}` : ""} server online (${latency}ms), but model '${this.model}' is not in installed list (${models.join(", ")}). Run 'ollama pull ${this.model}' to install.`,
          };
        }
      }

      // 3. Fallback: probe OpenAI-compatible /v1/models directly
      const probeRes = await fetch(this.endpoints.openAiModelsUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });

      if (probeRes.ok) {
        return {
          ok: true,
          status: "ready",
          latencyMs: Date.now() - start,
          discoveredModels: [],
          normalizedOrigin: origin,
          message: `Connected to local OpenAI-compatible endpoint at ${origin} (${Date.now() - start}ms).`,
        };
      }

      return {
        ok: false,
        status: "server_unreachable",
        latencyMs: Date.now() - start,
        normalizedOrigin: origin,
        message: `Local endpoint responded with HTTP ${probeRes.status}: ${probeRes.statusText}`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: "server_unreachable",
        latencyMs: Date.now() - start,
        normalizedOrigin: origin,
        message: `Failed to connect to local Ollama server at ${origin}: ${(err as Error).message}. Ensure Ollama is running (e.g. 'ollama run ${this.model}'). Local-only mode strictly forbids falling back to cloud.`,
      };
    }
  }

  public async listModels(): Promise<string[]> {
    // 1. Try native Ollama endpoint /api/tags
    try {
      const res = await fetch(this.endpoints.nativeTagsUrl, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        if (Array.isArray(data.models) && data.models.length > 0) {
          return data.models.map((m) => m.name);
        }
      }
    } catch {}

    // 2. Try OpenAI-compatible /v1/models endpoint
    try {
      const res = await fetch(this.endpoints.openAiModelsUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
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
    const durationMs = Date.now() - start;

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
  }
}

