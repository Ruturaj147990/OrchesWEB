import { CodingAgentAdapter } from "./adapter.js";
import { BuiltinCoderAdapter } from "./builtin/builtin-coder.js";
import { ReasoningProvider } from "../reasoning/provider.js";

/**
 * Coding mechanisms that can actually execute in this installation. Antigravity IDE is
 * reported separately (see platform/antigravity.ts) because its agent cannot be driven
 * by external programs. Test doubles are injected by tests, never registered here.
 */
export function listCodingAgents(provider: ReasoningProvider): CodingAgentAdapter[] {
  return [new BuiltinCoderAdapter(provider)];
}

export function resolveCodingAgent(id: string, provider: ReasoningProvider): CodingAgentAdapter {
  const agents = listCodingAgents(provider);
  return agents.find((a) => a.id === id) ?? agents[0];
}
