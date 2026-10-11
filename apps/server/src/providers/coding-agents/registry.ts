import { CodingAgentAdapter } from "./adapter.js";
import { BuiltinCoderAdapter } from "./builtin/builtin-coder.js";
import { MockAgentAdapter } from "./mock/mock-adapter.js";
import { ReasoningProvider } from "../reasoning/provider.js";

export function mockAgentEnabled(): boolean {
  return process.env.ORCHESTRATOR_ENABLE_MOCK_AGENT === "1";
}

/** Coding mechanisms that can actually execute in this installation. */
export function listCodingAgents(provider: ReasoningProvider): CodingAgentAdapter[] {
  const agents: CodingAgentAdapter[] = [new BuiltinCoderAdapter(provider)];
  if (mockAgentEnabled()) agents.push(new MockAgentAdapter());
  return agents;
}

export function resolveCodingAgent(id: string, provider: ReasoningProvider): CodingAgentAdapter {
  const agent = listCodingAgents(provider).find((a) => a.id === id);
  if (!agent) {
    throw new Error(`Coding mechanism '${id}' is not available. Available: ${listCodingAgents(provider).map((a) => a.id).join(", ")}.`);
  }
  return agent;
}
