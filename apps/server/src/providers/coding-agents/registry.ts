import { CodingAgentAdapter } from "./adapter.js";
import { BuiltinCoderAdapter } from "./builtin/builtin-coder.js";
import { AntigravityAgentAdapter } from "./antigravity/antigravity-agent-adapter.js";
import { ReasoningProvider } from "../reasoning/provider.js";

/**
 * Coding mechanisms:
 * - builtin: the reasoning provider writes files directly (single model does everything).
 * - antigravity: closed loop — the reasoning provider instructs the native Antigravity Agent, which does
 *   the coding in the IDE; requires the Orches Bridge extension and the project folder open in Antigravity.
 * Test doubles are injected by tests, never registered here.
 */
export function listCodingAgents(provider: ReasoningProvider): CodingAgentAdapter[] {
  return [new BuiltinCoderAdapter(provider), new AntigravityAgentAdapter()];
}

export function resolveCodingAgent(id: string, provider: ReasoningProvider): CodingAgentAdapter {
  const agents = listCodingAgents(provider);
  return agents.find((a) => a.id === id) ?? agents[0];
}
