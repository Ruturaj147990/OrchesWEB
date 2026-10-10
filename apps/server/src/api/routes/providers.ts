import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { reasoningRegistry } from "../../providers/reasoning/registry.js";
import { config } from "../../config/env.js";

const SelectProviderSchema = z.object({
  providerId: z.enum(["openai", "openai-compatible-local"]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export const providerRoutes: FastifyPluginAsync = async (fastify) => {
  // Get available reasoning providers and active provider
  fastify.get("/providers/reasoning", async () => {
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
      providers: allProviders,
    };
  });

  // Switch or configure active reasoning provider
  fastify.post<{ Body: unknown }>("/providers/reasoning/select", async (request, reply) => {
    const parsed = SelectProviderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const { providerId, apiKey, model } = parsed.data;

    if (providerId === "openai") {
      if (apiKey && apiKey.trim()) {
        config.openaiApiKey = apiKey.trim();
        reasoningRegistry.configureOpenAI(config.openaiApiKey, model || "gpt-4o-mini");
      } else if (!config.openaiApiKey) {
        return reply.status(400).send({
          error: "OpenAI API Key is required to switch to OpenAI Cloud reasoning.",
        });
      }

      reasoningRegistry.setDefault("openai");
    } else {
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
    });
  });
};
