import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { reasoningRegistry } from "../../providers/reasoning/registry.js";
import { config } from "../../config/env.js";
import { SettingsManager } from "../../platform/settings-manager.js";

const SelectProviderSchema = z.object({
  providerId: z.enum(["openai", "openai-compatible-local"]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

const VerifyKeySchema = z.object({
  apiKey: z.string().min(1),
});

export const providerRoutes: FastifyPluginAsync = async (fastify) => {
  // Initialize from persisted settings on first route load
  const persisted = SettingsManager.loadSettings();
  if (persisted.openaiApiKey && !config.openaiApiKey) {
    config.openaiApiKey = persisted.openaiApiKey;
    reasoningRegistry.configureOpenAI(config.openaiApiKey, persisted.defaultModel || "gpt-4o-mini");
  }
  if (persisted.defaultProviderId === "openai" && config.openaiApiKey) {
    try {
      reasoningRegistry.setDefault("openai");
    } catch {}
  }

  // Get available reasoning providers and active provider
  fastify.get("/providers/reasoning", async () => {
    const currentPersisted = SettingsManager.loadSettings();
    if (currentPersisted.openaiApiKey && !config.openaiApiKey) {
      config.openaiApiKey = currentPersisted.openaiApiKey;
      reasoningRegistry.configureOpenAI(config.openaiApiKey, currentPersisted.defaultModel || "gpt-4o-mini");
    }

    const active = reasoningRegistry.getDefault();
    const activeId = reasoningRegistry.getDefaultId();
    const allProviders = reasoningRegistry.list().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      privacyClass: p.privacyClass,
      configured: p.id === "openai" ? Boolean(config.openaiApiKey) : true,
    }));

    return {
      activeProviderId: activeId,
      activeProvider: {
        id: active.id,
        displayName: active.displayName,
        privacyClass: active.privacyClass,
      },
      hasOpenAiKey: Boolean(config.openaiApiKey),
      savedApiKey: config.openaiApiKey || "",
      savedModel: currentPersisted.defaultModel || "gpt-4o-mini",
      providers: allProviders,
    };
  });

  // Fast verify OpenAI API key without switching providers
  fastify.post<{ Body: unknown }>("/providers/reasoning/verify-key", async (request, reply) => {
    const parsed = VerifyKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ valid: false, error: "Please enter an OpenAI API key to verify." });
    }

    const result = await SettingsManager.verifyOpenAiKey(parsed.data.apiKey);
    if (!result.valid) {
      return reply.status(400).send(result);
    }
    return reply.status(200).send(result);
  });

  // Switch or configure active reasoning provider
  fastify.post<{ Body: unknown }>("/providers/reasoning/select", async (request, reply) => {
    const parsed = SelectProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const { providerId, apiKey, model } = parsed.data;

    if (providerId === "openai") {
      let keyToUse = config.openaiApiKey;

      if (apiKey && apiKey.trim()) {
        const candidateKey = apiKey.trim();
        // Fast verify candidate key
        const check = await SettingsManager.verifyOpenAiKey(candidateKey);
        if (!check.valid) {
          return reply.status(400).send({
            error: check.error || "OpenAI API key verification failed.",
          });
        }

        keyToUse = candidateKey;
        config.openaiApiKey = candidateKey;
        SettingsManager.saveSettings({
          openaiApiKey: candidateKey,
          defaultProviderId: "openai",
          defaultModel: model || "gpt-4o-mini",
        });
        reasoningRegistry.configureOpenAI(candidateKey, model || "gpt-4o-mini");
      } else if (!keyToUse) {
        return reply.status(400).send({
          error: "OpenAI API Key is required to switch to OpenAI Cloud reasoning.",
        });
      } else {
        // Update model and active provider preference
        SettingsManager.saveSettings({
          defaultProviderId: "openai",
          defaultModel: model || "gpt-4o-mini",
        });
        reasoningRegistry.configureOpenAI(keyToUse, model || "gpt-4o-mini");
      }

      reasoningRegistry.setDefault("openai");
    } else {
      SettingsManager.saveSettings({
        defaultProviderId: "openai-compatible-local",
      });
      reasoningRegistry.setDefault("openai-compatible-local");
    }

    const newActive = reasoningRegistry.getDefault();
    return reply.status(200).send({
      success: true,
      activeProviderId: reasoningRegistry.getDefaultId(),
      activeProvider: {
        id: newActive.id,
        displayName: newActive.displayName,
        privacyClass: newActive.privacyClass,
      },
      hasOpenAiKey: Boolean(config.openaiApiKey),
      savedApiKey: config.openaiApiKey || "",
    });
  });
};
