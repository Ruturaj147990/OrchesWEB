import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult, CodingAgentAvailability } from "../adapter.js";

export interface ScriptedAttempt {
  files?: Array<{ path: string; content: string }>;
  deletes?: string[];
  fail?: string;
  delayMs?: number;
}

/**
 * Deterministic coding mechanism for automated tests and UI demos. It is only
 * registered when injected by a test or when ORCHESTRATOR_ENABLE_MOCK_AGENT=1,
 * and every run records it by name, so it can never pass for a real agent.
 */
export class MockAgentAdapter implements CodingAgentAdapter {
  public id = "mock";
  public displayName = "Scripted test agent";
  public description = "Writes pre-scripted files (testing only). No model is involved.";
  public usesReasoningProvider = false;
  public calls: AgentExecutionInput[] = [];

  constructor(private script: ScriptedAttempt[] = [{ files: [{ path: "mock-output.txt", content: "written by the scripted test agent\n" }] }]) {}

  public async detect(): Promise<CodingAgentAvailability> {
    return { available: true, detail: "Scripted test agent (no model)." };
  }

  public async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.calls.push(input);
    const step = this.script[Math.min(input.attemptNumber - 1, this.script.length - 1)] ?? {};
    if (step.delayMs) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, step.delayMs);
        input.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    const result: AgentExecutionResult = { status: "failed", summary: "", filesWritten: [], filesDeleted: [], rejectedWrites: [], warnings: [] };
    if (input.signal?.aborted) {
      result.error = "cancelled";
      return result;
    }
    if (step.fail) {
      result.error = step.fail;
      return result;
    }
    for (const f of step.files ?? []) {
      const abs = path.join(input.workspacePath, f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, "utf8");
      result.filesWritten.push(f.path);
      input.onLog(`[mock] wrote ${f.path}`);
    }
    for (const d of step.deletes ?? []) {
      fs.rmSync(path.join(input.workspacePath, d), { force: true });
      result.filesDeleted.push(d);
    }
    result.status = "completed";
    result.summary = `Scripted attempt ${input.attemptNumber}`;
    return result;
  }
}
