import fs from "node:fs";
import path from "node:path";
import { AgentReport, AgentReportSchema, PrivacyClass, Task } from "@orchestrator/shared-types";
import { CodingAgentAdapter, CodingAgentDetection } from "../adapter.js";

export interface MockBehavior {
  mode: "success" | "failing_tests" | "permission_denied" | "malformed" | "timeout";
  filesToModify?: Array<{ relativePath: string; content: string }>;
  claimedSummary?: string;
  delayMs?: number;
}

export class MockAgentAdapter implements CodingAgentAdapter {
  public id = "mock-agent";
  public displayName = "Deterministic Test Mock Agent";
  public privacyClass: PrivacyClass = "local";
  private behavior: MockBehavior;

  constructor(behavior: MockBehavior = { mode: "success" }) {
    this.behavior = behavior;
  }

  public setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  public async detectInstallation(): Promise<CodingAgentDetection> {
    return {
      installed: true,
      executablePath: "internal://mock-agent",
      version: "mock-1.0.0",
      capabilities: {
        headless: true,
        streaming: true,
        jsonOutput: true,
      },
    };
  }

  public async executeTask(
    task: Task,
    workspacePath: string,
    _contextPacket: string,
    signal?: AbortSignal,
    onLog?: (chunk: string) => void
  ): Promise<AgentReport> {
    if (this.behavior.delayMs) {
      await new Promise((res) => setTimeout(res, this.behavior.delayMs));
    }

    if (signal?.aborted) {
      throw new Error("Task execution cancelled by abort signal");
    }

    onLog?.(`[MockAgent] Starting execution for task ${task.id} in mode: ${this.behavior.mode}\n`);

    if (this.behavior.mode === "timeout") {
      await new Promise((_, rej) => {
        const timeout = setTimeout(() => rej(new Error("Execution timed out")), 2000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timeout);
          rej(new Error("Aborted"));
        });
      });
    }

    if (this.behavior.mode === "permission_denied") {
      onLog?.("[MockAgent] Soft denial: permission required for tool execution.\n");
      return AgentReportSchema.parse({
        schema_version: 1,
        task_id: task.id,
        attempt_id: task.currentAttemptId || "attempt-mock-1",
        status: "awaiting_permission",
        summary: "Permission requested for executing external command",
        files_changed: [],
        tests: [],
        blockers: ["Awaiting approval for privileged operation"],
        questions: [],
        suggestions: [],
        requires_human: true,
        agent_session_id: "mock-sess-perm",
      });
    }

    // Apply real file changes on disk if configured
    const modifiedFiles: string[] = [];
    if (this.behavior.filesToModify) {
      for (const item of this.behavior.filesToModify) {
        const fullPath = path.join(workspacePath, item.relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, item.content, "utf8");
        modifiedFiles.push(item.relativePath);
        onLog?.(`[MockAgent] Wrote file ${item.relativePath}\n`);
      }
    }

    const reportData = {
      schema_version: 1 as const,
      task_id: task.id,
      attempt_id: task.currentAttemptId || "attempt-mock-1",
      status: this.behavior.mode === "success" ? ("reported_complete" as const) : ("reported_failed" as const),
      summary: this.behavior.claimedSummary || (this.behavior.mode === "success" ? "All edits completed." : "Failed to fix test."),
      files_changed: modifiedFiles.length > 0 ? modifiedFiles : ["src/index.ts"],
      tests: [
        {
          command: task.verificationPlan[0] || "npm test",
          agent_claim: this.behavior.mode === "success" ? ("passed" as const) : ("failed" as const),
          claimed_exit_code: this.behavior.mode === "success" ? 0 : 1,
        },
      ],
      blockers: [],
      questions: [],
      suggestions: [],
      requires_human: false,
      agent_session_id: "mock-session-001",
    };

    return AgentReportSchema.parse(reportData);
  }
}
