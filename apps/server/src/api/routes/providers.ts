import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { reasoningRegistry } from "../../providers/reasoning/registry.js";
import { config } from "../../config/env.js";
import { SettingsManager } from "../../platform/settings-manager.js";
import { OpenAICompatibleLocalProvider } from "../../providers/reasoning/openai-compatible/local-provider.js";

import { ReasoningUsageLedger } from "../../domain/budgets/usage-ledger.js";

const SelectProviderSchema = z.object({
  providerId: z.enum(["openai", "openai-compatible-local"]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

const VerifyKeySchema = z.object({
  apiKey: z.string().min(1),
});

const ProbeLocalSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const TestGenerationSchema = z.object({
  providerId: z.enum(["openai", "openai-compatible-local"]).optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
});

export const providerRoutes: FastifyPluginAsync = async (fastify) => {
  // Initialize from persisted settings on first route load
  const persisted = SettingsManager.loadSettings();
  if (persisted.openaiApiKey && !config.openaiApiKey) {
    config.openaiApiKey = persisted.openaiApiKey;
    reasoningRegistry.configureOpenAI(config.openaiApiKey, persisted.defaultModel || "gpt-4o-mini");
  }
  if (persisted.localBaseUrl || persisted.localModel) {
    reasoningRegistry.configureLocal(
      persisted.localBaseUrl,
      persisted.localModel,
      "local",
      persisted.localTimeoutMs
    );
  }
  if (persisted.defaultProviderId === "openai" && config.openaiApiKey) {
    try {
      reasoningRegistry.setDefault("openai");
    } catch {}
  }

  // Get available reasoning providers and active provider with live probe
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

    // Probe live health of active provider
    let activeHealth: any = null;
    try {
      activeHealth = await active.healthCheck();
    } catch (err: unknown) {
      activeHealth = {
        ok: false,
        status: "server_unreachable",
        message: (err as Error).message,
      };
    }

    return {
      activeProviderId: activeId,
      activeProvider: {
        id: active.id,
        displayName: active.displayName,
        privacyClass: active.privacyClass,
      },
      activeHealth,
      hasOpenAiKey: Boolean(config.openaiApiKey),
      maskedApiKey: SettingsManager.maskApiKey(config.openaiApiKey),
      savedModel: currentPersisted.defaultModel || "gpt-4o-mini",
      localConfig: {
        baseUrl: currentPersisted.localBaseUrl || config.localReasoningBaseUrl,
        model: currentPersisted.localModel || config.localReasoningModel,
        timeoutMs: currentPersisted.localTimeoutMs || 180000,
      },
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

  // Probe local Ollama / OpenAI-compatible endpoint
  fastify.post<{ Body: unknown }>("/providers/reasoning/probe-local", async (request, reply) => {
    const parsed = ProbeLocalSchema.safeParse(request.body || {});
    const currentPersisted = SettingsManager.loadSettings();
    const targetBaseUrl = parsed.success && parsed.data.baseUrl
      ? parsed.data.baseUrl
      : currentPersisted.localBaseUrl || config.localReasoningBaseUrl;
    const targetModel = parsed.success && parsed.data.model
      ? parsed.data.model
      : currentPersisted.localModel || config.localReasoningModel;

    const probe = new OpenAICompatibleLocalProvider({
      baseUrl: targetBaseUrl,
      model: targetModel,
    });

    const health = await probe.healthCheck();
    return reply.status(200).send(health);
  });

  // Send Test Generation: minimal controlled inference request proving live reasoning
  fastify.post<{ Body: unknown }>("/providers/reasoning/test-generation", async (request, reply) => {
    const parsed = TestGenerationSchema.safeParse(request.body || {});
    const currentPersisted = SettingsManager.loadSettings();
    const targetProviderId = (parsed.success && parsed.data.providerId)
      ? parsed.data.providerId
      : reasoningRegistry.getDefaultId();

    const promptText = (parsed.success && parsed.data.prompt) || "Reply with 'PONG' and a brief 3-word greeting.";

    try {
      if (targetProviderId === "openai") {
        const key = config.openaiApiKey || currentPersisted.openaiApiKey;
        if (!key) {
          return reply.status(400).send({
            ok: false,
            error: "OpenAI API Key is not configured. Please configure an API key to test OpenAI Cloud inference.",
          });
        }
        const openAiProvider = reasoningRegistry.get("openai");
        if (!openAiProvider) {
          return reply.status(400).send({ ok: false, error: "OpenAI provider is not registered." });
        }
        const result = await openAiProvider.generate({
          operation: "project_analysis",
          systemInstruction: "You are a concise test assistant. Keep response under 15 words.",
          messages: [{ role: "user", content: promptText }],
          maxOutputTokens: 30,
          dataClassification: "internal",
          projectId: "test-probe",
        });

        return reply.status(200).send({
          ok: true,
          providerId: "openai",
          modelId: result.modelId,
          output: result.text.trim(),
          usage: result.usage,
          durationMs: result.durationMs,
        });
      } else {
        const localProvider = reasoningRegistry.get("openai-compatible-local");
        if (!localProvider) {
          return reply.status(400).send({ ok: false, error: "Local provider is not registered." });
        }
        const result = await localProvider.generate({
          operation: "project_analysis",
          systemInstruction: "You are a concise test assistant. Keep response under 15 words.",
          messages: [{ role: "user", content: promptText }],
          maxOutputTokens: 30,
          dataClassification: "internal",
          projectId: "test-probe",
        });

        return reply.status(200).send({
          ok: true,
          providerId: "openai-compatible-local",
          modelId: result.modelId,
          output: result.text.trim(),
          usage: result.usage,
          durationMs: result.durationMs,
        });
      }
    } catch (err: unknown) {
      return reply.status(500).send({
        ok: false,
        error: (err as Error).message,
      });
    }
  });

  // Get Reasoning Usage Ledger Summary & Recent Requests
  fastify.get<{ Querystring: { projectId?: string } }>("/providers/usage", async (request) => {
    return ReasoningUsageLedger.getShared().getSummary(request.query?.projectId);
  });

  // Switch or configure active reasoning provider
  fastify.post<{ Body: unknown }>("/providers/reasoning/select", async (request, reply) => {
    const parsed = SelectProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const { providerId, apiKey, model, baseUrl, timeoutMs } = parsed.data;
    const currentPersisted = SettingsManager.loadSettings();

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
          defaultModel: model || currentPersisted.defaultModel || "gpt-4o-mini",
        });
        reasoningRegistry.configureOpenAI(candidateKey, model || currentPersisted.defaultModel || "gpt-4o-mini");
      } else if (!keyToUse) {
        return reply.status(400).send({
          error: "OpenAI API Key is required to switch to OpenAI Cloud reasoning.",
        });
      } else {
        // Update model and active provider preference
        SettingsManager.saveSettings({
          defaultProviderId: "openai",
          defaultModel: model || currentPersisted.defaultModel || "gpt-4o-mini",
        });
        reasoningRegistry.configureOpenAI(keyToUse, model || currentPersisted.defaultModel || "gpt-4o-mini");
      }

      reasoningRegistry.setDefault("openai");
    } else {
      const resolvedBaseUrl = baseUrl || currentPersisted.localBaseUrl || config.localReasoningBaseUrl;
      const resolvedModel = model || currentPersisted.localModel || config.localReasoningModel;
      const resolvedTimeout = timeoutMs || currentPersisted.localTimeoutMs || 180000;

      SettingsManager.saveSettings({
        defaultProviderId: "openai-compatible-local",
        localBaseUrl: resolvedBaseUrl,
        localModel: resolvedModel,
        localTimeoutMs: resolvedTimeout,
      });

      reasoningRegistry.configureLocal(
        resolvedBaseUrl,
        resolvedModel,
        "local",
        resolvedTimeout
      );
      reasoningRegistry.setDefault("openai-compatible-local");
    }

    const newActive = reasoningRegistry.getDefault();
    const updatedSettings = SettingsManager.loadSettings();

    return reply.status(200).send({
      success: true,
      activeProviderId: reasoningRegistry.getDefaultId(),
      activeProvider: {
        id: newActive.id,
        displayName: newActive.displayName,
        privacyClass: newActive.privacyClass,
      },
      hasOpenAiKey: Boolean(config.openaiApiKey),
      maskedApiKey: SettingsManager.maskApiKey(config.openaiApiKey),
      localConfig: {
        baseUrl: updatedSettings.localBaseUrl || config.localReasoningBaseUrl,
        model: updatedSettings.localModel || config.localReasoningModel,
        timeoutMs: updatedSettings.localTimeoutMs || 180000,
      },
    });
  });
};
