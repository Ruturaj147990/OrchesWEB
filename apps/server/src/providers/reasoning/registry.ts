import { ReasoningProvider } from "./provider.js";
import { ChatGPTWebProvider } from "./chatgpt-web/chatgpt-web-provider.js";
import { SettingsManager, PersistedSettings, ProviderId } from "../../platform/settings-manager.js";

export const PROVIDER_IDS: ProviderId[] = ["chatgpt-web"];

export function buildProvider(
  id: ProviderId = "chatgpt-web",
  settings: PersistedSettings = SettingsManager.loadSettings()
): ReasoningProvider {
  return new ChatGPTWebProvider({
    headless: settings.chatgptWebHeadless,
    profileDir: settings.chatgptWebProfileDir,
    timeoutMs: settings.chatgptWebTimeoutMs,
  });
}

export function getActiveProvider(): ReasoningProvider {
  const settings = SettingsManager.loadSettings();
  return buildProvider(settings.activeProviderId, settings);
}
