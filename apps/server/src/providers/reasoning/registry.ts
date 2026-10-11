import { ReasoningProvider } from "./provider.js";
import { OpenAIProvider } from "./openai/openai-provider.js";
import { OpenAICompatibleLocalProvider } from "./openai-compatible/local-provider.js";
import { config } from "../../config/env.js";

export class ReasoningRegistry {
  private providers: Map<string, ReasoningProvider> = new Map();
  private defaultProviderId: string = "openai-compatible-local";

  constructor() {
    // Register local provider
    const local = new OpenAICompatibleLocalProvider({
      baseUrl: config.localReasoningBaseUrl,
      model: config.localReasoningModel,
    });
    this.register(local);

    // Register OpenAI cloud provider
    const cloud = new OpenAIProvider({
      apiKey: config.openaiApiKey,
    });
    this.register(cloud);
  }

  public register(provider: ReasoningProvider): void {
    this.providers.set(provider.id, provider);
  }

  public get(id: string): ReasoningProvider | undefined {
    return this.providers.get(id);
  }

  public list(): ReasoningProvider[] {
    return Array.from(this.providers.values());
  }

  public getDefaultId(): string {
    return this.defaultProviderId;
  }

  public getDefault(): ReasoningProvider {
    return this.providers.get(this.defaultProviderId) || Array.from(this.providers.values())[0];
  }

  public setDefault(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.defaultProviderId = id;
  }

  public configureOpenAI(apiKey: string, model?: string): void {
    const cloud = new OpenAIProvider({
      apiKey,
      model: model || "gpt-4o-mini",
    });
    this.register(cloud);
  }

  public configureLocal(baseUrl?: string, model?: string, apiKey?: string, timeoutMs?: number): void {
    const local = new OpenAICompatibleLocalProvider({
      baseUrl: baseUrl || config.localReasoningBaseUrl,
      model: model || config.localReasoningModel,
      apiKey: apiKey || "local",
      timeoutMs,
    });
    this.register(local);
  }

  public resetDefaults(): void {
    this.defaultProviderId = "openai-compatible-local";
  }
}

export const reasoningRegistry = new ReasoningRegistry();
