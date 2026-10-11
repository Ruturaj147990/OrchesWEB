import { ReasoningProvider } from "./provider.js";
import { OpenAIProvider } from "./openai/openai-provider.js";
import { OpenAICompatibleLocalProvider } from "./openai-compatible/local-provider.js";
import { SettingsManager, PersistedSettings, ProviderId } from "../../platform/settings-manager.js";

export const PROVIDER_IDS: ProviderId[] = ["openai-compatible-local", "openai"];

/** Build a provider from persisted settings. Providers are cheap and stateless, so
 *  every run resolves a fresh one and the selection always matches what is saved. */
export function buildProvider(id: ProviderId, settings: PersistedSettings = SettingsManager.loadSettings()): ReasoningProvider {
  if (id === "openai") {
    return new OpenAIProvider({ apiKey: settings.openaiApiKey, model: settings.openaiModel });
  }
  return new OpenAICompatibleLocalProvider({
    baseUrl: settings.localBaseUrl,
    model: settings.localModel,
    timeoutMs: settings.localTimeoutMs,
    contextTokens: settings.localContextTokens,
  });
}

export function getActiveProvider(): ReasoningProvider {
  const settings = SettingsManager.loadSettings();
  return buildProvider(settings.activeProviderId, settings);
}
