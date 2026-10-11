import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SettingsManager, ProviderId } from "../../platform/settings-manager.js";
import { buildProvider, PROVIDER_IDS } from "../../providers/reasoning/registry.js";
import { listCodingAgents } from "../../providers/coding-agents/registry.js";
import { OpenAICompatibleLocalProvider } from "../../providers/reasoning/openai-compatible/local-provider.js";
import { ReasoningUsageLedger } from "../../domain/budgets/usage-ledger.js";

const UpdateSettingsSchema = z.object({
  activeProviderId: z.enum(["openai-compatible-local", "openai"]).optional(),
  localBaseUrl: z.string().trim().url().optional(),
  localModel: z.string().trim().min(1).max(200).optional(),
  localTimeoutMs: z.number().int().min(10_000).max(900_000).optional(),
  localContextTokens: z.number().int().min(2048).max(131_072).optional(),
  openaiApiKey: z.string().trim().min(20).max(400).optional(),
  clearOpenaiKey: z.boolean().optional(),
  openaiModel: z.string().trim().min(1).max(100).optional(),
  codingAgentId: z.string().trim().min(1).optional(),
  maxAttempts: z.number().int().min(1).max(8).optional(),
});

async function settingsView() {
  const s = SettingsManager.loadSettings();
  const active = buildProvider(s.activeProviderId, s);
  const agents = await Promise.all(
    listCodingAgents(active).map(async (a) => ({
      id: a.id,
      name: a.displayName,
      description: a.description,
      usesReasoningProvider: a.usesReasoningProvider,
      ...(await a.detect()),
    }))
  );
  return {
    activeProviderId: s.activeProviderId,
    activeModel: active.getModel(),
    local: {
      baseUrl: s.localBaseUrl,
      model: s.localModel,
      timeoutMs: s.localTimeoutMs,
      contextTokens: s.localContextTokens,
    },
    openai: {
      configured: Boolean(s.openaiApiKey),
      maskedKey: SettingsManager.maskApiKey(s.openaiApiKey),
      model: s.openaiModel,
      keySource: s.openaiApiKey ? (process.env.OPENAI_API_KEY?.trim() === s.openaiApiKey ? "environment" : "settings") : null,
    },
    codingAgentId: agents.some((a) => a.id === s.codingAgentId) ? s.codingAgentId : "builtin",
    codingAgents: agents,
    maxAttempts: s.maxAttempts,
  };
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings", async () => settingsView());

  fastify.put<{ Body: unknown }>("/settings", async (request, reply) => {
    const parsed = UpdateSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const { clearOpenaiKey, ...updates } = parsed.data;
    if (clearOpenaiKey) SettingsManager.clearOpenAiKey();
    if (updates.activeProviderId === "openai") {
      const key = updates.openaiApiKey ?? SettingsManager.loadSettings().openaiApiKey;
      if (!key) return reply.status(400).send({ error: "Add an OpenAI API key before selecting OpenAI." });
    }
    if (updates.codingAgentId) {
      const ids = listCodingAgents(buildProvider("openai-compatible-local")).map((a) => a.id);
      if (!ids.includes(updates.codingAgentId)) return reply.status(400).send({ error: `Unknown coding mechanism '${updates.codingAgentId}'.` });
    }
    SettingsManager.saveSettings(updates);
    return settingsView();
  });

  // Connectivity check (free: lists models; no generation).
  fastify.post<{ Params: { providerId: string } }>("/settings/providers/:providerId/check", async (request, reply) => {
    const id = request.params.providerId as ProviderId;
    if (!PROVIDER_IDS.includes(id)) return reply.status(404).send({ error: "Unknown provider" });
    return buildProvider(id).healthCheck();
  });

  // A tiny real generation proving the configuration works end to end (uses a few tokens).
  fastify.post<{ Params: { providerId: string } }>("/settings/providers/:providerId/test", async (request, reply) => {
    const id = request.params.providerId as ProviderId;
    if (!PROVIDER_IDS.includes(id)) return reply.status(404).send({ error: "Unknown provider" });
    const provider = buildProvider(id);
    try {
      const res = await provider.generate({
        operation: "project_analysis",
        systemInstruction: "Answer with a single word.",
        messages: [{ role: "user", content: "Reply with the word READY." }],
        maxOutputTokens: 10,
        temperature: 0,
        projectId: "settings-test",
        timeoutMs: 120_000,
      });
      return { ok: true, model: res.modelId, output: res.text.trim().slice(0, 200), durationMs: res.durationMs };
    } catch (err) {
      return reply.status(502).send({ ok: false, error: (err as Error).message });
    }
  });

  // Models installed on a local server (for the model picker); does not change settings.
  fastify.get<{ Querystring: { baseUrl?: string } }>("/settings/local-models", async (request) => {
    const s = SettingsManager.loadSettings();
    const probe = new OpenAICompatibleLocalProvider({ baseUrl: request.query.baseUrl || s.localBaseUrl, model: s.localModel });
    return { models: await probe.listModels() };
  });

  fastify.get<{ Querystring: { projectId?: string } }>("/usage", async (request) => ReasoningUsageLedger.getShared().getSummary(request.query.projectId));
};
