import { CodingAgentAdapter } from "./adapter.js";
import { AntigravityAdapter } from "./antigravity/antigravity-adapter.js";
import { MockAgentAdapter } from "./mock/mock-adapter.js";

export class AgentRegistry {
  private adapters: Map<string, CodingAgentAdapter> = new Map();
  private defaultAdapterId = "antigravity";

  constructor(includeMock = false) {
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
