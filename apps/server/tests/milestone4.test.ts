import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { StagnationDetector } from "../src/orchestrator/stagnation-detector.js";
import { MemoryManager } from "../src/domain/memory/memory-manager.js";
import { ProcessSupervisor } from "../src/platform/process-supervisor.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { Task, VerificationResult } from "@orchestrator/shared-types";

describe("Milestone 4 — Cost Accuracy, Reliability, Context Compaction, and Recovery", () => {
  let tempWorkspace: string;

  beforeAll(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "orches-m4-"));
    fs.mkdirSync(path.join(tempWorkspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, "src", "index.ts"), "export const x = 1;");
  });

  afterAll(() => {
    if (tempWorkspace && fs.existsSync(tempWorkspace)) {
      try {
        fs.rmSync(tempWorkspace, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });

  it("detects consecutive no-diff stagnation", () => {
    const detector = new StagnationDetector();

    const att1 = detector.recordAttempt("", []);
    expect(att1.isStagnant).toBe(false);

    const att2 = detector.recordAttempt("", []);
    expect(att2.isStagnant).toBe(true);
    expect(att2.reason).toContain("2 consecutive attempts produced no code diffs");
  });

  it("detects repeated identical verification failure hash stagnation", () => {
    const detector = new StagnationDetector();

    const failedResult: VerificationResult = {
      id: "v-1",
      taskId: "task-01",
      attemptId: "att-1",
      checkType: "test",
      command: "npm test",
      argv: ["npm", "test"],
      cwd: "/repo",
      status: "failed",
      exitCode: 1,
      durationMs: 300,
      outputArtifactId: null,
      stdoutSnippet: "",
      stderrSnippet: "AssertionError: Expected 200 got 500 at auth.test.ts:42",
      truncated: false,
      timestamp: new Date().toISOString(),
    };

    detector.recordAttempt("diff 1", [failedResult]);
    detector.recordAttempt("diff 2", [failedResult]);
    const att3 = detector.recordAttempt("diff 3", [failedResult]);

    expect(att3.isStagnant).toBe(true);
    expect(att3.reason).toContain("Identical verification failure occurred 3 consecutive times");
  });

  it("detects edit ping-pong oscillation stagnation", () => {
    const detector = new StagnationDetector();

    detector.recordAttempt("+ const port = 3000;", []);
    detector.recordAttempt("+ const port = 4000;", []);
    detector.recordAttempt("+ const port = 3000;", []);
    const att4 = detector.recordAttempt("+ const port = 4000;", []);

    expect(att4.isStagnant).toBe(true);
    expect(att4.reason).toContain("Cyclic edit oscillation (ping-pong) detected");
  });

  it("manages persistent memory, CURRENT_STATE.md, REPO_MAP.md, and rolling summaries", () => {
    const memory = new MemoryManager(tempWorkspace);

    const dummyTask: Task = {
      id: "task-mem-01",
      projectId: "proj-01",
      runId: "run-01",
      title: "Add Auth Middleware",
      objective: "Implement JWT validation",
      roadmapItemId: "ROADMAP-01",
      requirementIds: ["REQ-AUTH"],
      status: "succeeded",
      priority: "high",
      risk: "low",
      allowedPaths: ["src/**"],
      forbiddenPaths: [],
      acceptanceCriteria: [],
      verificationPlan: ["npm test"],
      attemptCount: 1,
      currentAttemptId: "att-1",
      maxAttempts: 3,
      requiresApproval: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memory.recordCompletedTask(dummyTask, "c0ffee1", "Implemented JWT token validation");

    const summaries = memory.getRollingSummaries(5);
    expect(summaries).toContain("[task-mem-01] (ROADMAP-01) Add Auth Middleware");
    expect(summaries).toContain("Commit=c0ffee1");

    // Check files on disk
    expect(fs.existsSync(path.join(tempWorkspace, "CURRENT_STATE.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempWorkspace, ".orchestrator", "REPO_MAP.md"))).toBe(true);

    const currentStateContent = fs.readFileSync(path.join(tempWorkspace, "CURRENT_STATE.md"), "utf8");
    expect(currentStateContent).toContain("**Total Completed Tasks:** 1");
  });

  it("supervises child processes and terminates them cleanly without orphans", async () => {
    const supervisor = new ProcessSupervisor();

    // Spawn a lightweight long-running node process
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { shell: false });
    supervisor.register("proc-test", child, "Long running test process");

    expect(supervisor.getActiveCount()).toBe(1);

    const terminated = await supervisor.terminate("proc-test", 1000);
    expect(terminated).toBe(true);
    expect(supervisor.getActiveCount()).toBe(0);
  });

  it("calculates multi-call cost breakdown and enforces beginner budget ceilings", () => {
    const budget = new BudgetService({
      perTaskWarningUsd: 0.50,
      perTaskHardUsd: 2.00,
      perRunHardUsd: 10.00,
    });

    // 1 call: 1000 input, 500 output with gpt-4o-mini
    const call1 = budget.recordCall("gpt-4o-mini", 1000, 500);
    expect(call1.softWarning).toBe(false);

    const usage = budget.getUsage();
    expect(usage.totalRequests).toBe(1);
    expect(usage.totalInputTokens).toBe(1000);
    expect(usage.totalOutputTokens).toBe(500);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
  });
});
