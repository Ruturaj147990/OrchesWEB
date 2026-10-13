import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SettingsManager, ProviderId } from "../../platform/settings-manager.js";
import { buildProvider, PROVIDER_IDS } from "../../providers/reasoning/registry.js";
import { listCodingAgents } from "../../providers/coding-agents/registry.js";
import { ReasoningUsageLedger } from "../../domain/budgets/usage-ledger.js";
import { BrowserManager } from "../../providers/reasoning/chatgpt-web/browser-manager.js";

const UpdateSettingsSchema = z.object({
  activeProviderId: z.literal("chatgpt-web").optional(),
  chatgptWebHeadless: z.boolean().optional(),
  chatgptWebProfileDir: z.string().trim().optional(),
  chatgptWebTimeoutMs: z.number().int().min(10_000).max(900_000).optional(),
  reviewDiffChunkBudget: z.number().int().min(2_000).max(100_000).optional(),
  codingAgentId: z.string().trim().min(1).optional(),
  maxAttempts: z.number().int().min(1).optional(),
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
    chatgptWeb: {
      headless: s.chatgptWebHeadless,
      profileDir: s.chatgptWebProfileDir || BrowserManager.getShared().getProfileDir(),
      timeoutMs: s.chatgptWebTimeoutMs,
      browserState: BrowserManager.getShared().getState(),
    },
    reviewDiffChunkBudget: s.reviewDiffChunkBudget,
    codingAgentId: agents.some((a) => a.id === s.codingAgentId) ? s.codingAgentId : "builtin",
    codingAgents: agents,
    maxAttempts: s.maxAttempts,
  };
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings", async () => settingsView());

  fastify.put<{ Body: unknown }>("/settings", async (request, reply) => {
    const parsed = UpdateSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    const updates = parsed.data;
    if (updates.codingAgentId) {
      const ids = listCodingAgents(buildProvider("chatgpt-web")).map((a) => a.id);
      if (!ids.includes(updates.codingAgentId)) {
        return reply.status(400).send({ error: `Unknown coding mechanism '${updates.codingAgentId}'.` });
      }
    }
    SettingsManager.saveSettings(updates);
    return settingsView();
  });

  // Browser check / launch
  fastify.post("/settings/browser/open", async () => {
    const bm = BrowserManager.getShared();
    const page = await bm.ensureChatGPTPage();
    return {
      ok: true,
      url: page.url(),
      state: bm.getState(),
      profileDir: bm.getProfileDir(),
    };
  });

  // Connectivity check for ChatGPT Web
  fastify.post<{ Params: { providerId: string } }>("/settings/providers/:providerId/check", async (request, reply) => {
    const id = request.params.providerId as ProviderId;
    if (!PROVIDER_IDS.includes(id)) return reply.status(404).send({ error: "Unknown provider" });
    return buildProvider(id).healthCheck();
  });

  // Real generation test
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

  fastify.get<{ Querystring: { projectId?: string } }>("/usage", async (request) =>
    ReasoningUsageLedger.getShared().getSummary(request.query.projectId)
  );
};
