import { CodingAgentAdapter } from "./adapter.js";
import { AntigravityAdapter } from "./antigravity/antigravity-adapter.js";
import { VisibleIdeAdapter } from "./antigravity/visible-ide-adapter.js";
import { MockAgentAdapter } from "./mock/mock-adapter.js";
import { ReasoningCodingAgentAdapter } from "./reasoning/reasoning-coding-adapter.js";
import { IdeBridge } from "../../platform/ide/ide-bridge.js";
import { reasoningRegistry } from "../reasoning/registry.js";

export class AgentRegistry {
  private adapters: Map<string, CodingAgentAdapter> = new Map();
  private defaultAdapterId = "reasoning-coding-agent";

  constructor(ideBridge?: IdeBridge, includeMock = false) {
    const bridge = ideBridge || new IdeBridge();
    this.register(new ReasoningCodingAgentAdapter(reasoningRegistry.getDefault()));
    this.register(new VisibleIdeAdapter(bridge));
    this.register(new AntigravityAdapter());
    if (includeMock || process.env.NODE_ENV === "test") {
      this.register(new MockAgentAdapter());
    }
  }

  public register(adapter: CodingAgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public get(id: string): CodingAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  public list(): CodingAgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  public getDefault(): CodingAgentAdapter {
    return this.adapters.get(this.defaultAdapterId) || Array.from(this.adapters.values())[0];
  }

  public setDefault(id: string): void {
    if (!this.adapters.has(id)) {
      throw new Error(`Agent adapter '${id}' is not registered`);
    }
    this.defaultAdapterId = id;
  }
}
