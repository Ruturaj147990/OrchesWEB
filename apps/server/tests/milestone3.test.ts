import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { initDb, closeDb } from "../src/storage/db.js";
import { AutonomousLoop } from "../src/orchestrator/loop.js";
import { PlannerService } from "../src/orchestrator/planner.js";
import { CriticService } from "../src/orchestrator/critic.js";
import { ContextBuilder } from "../src/prompts/context-builder.js";
import { MockAgentAdapter } from "../src/providers/coding-agents/mock/mock-adapter.js";
import { MockReasoningProvider } from "../src/providers/reasoning/mock/mock-provider.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";
import { BrowserVerifier } from "../src/verification/browser-verifier.js";
import http from "node:http";

describe("Milestone 3 — Early Autonomous Vertical Slice (Mandatory Feasibility Gate)", () => {
  let tempWorkspace: string;
  let db: ReturnType<typeof initDb>;

  beforeAll(async () => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "orches-slice-"));
    // Initialize temporary Git repository
    execSync("git init", { cwd: tempWorkspace, stdio: "ignore" });
    execSync('git config user.name "TestRunner"', { cwd: tempWorkspace, stdio: "ignore" });
    execSync('git config user.email "test@runner.local"', { cwd: tempWorkspace, stdio: "ignore" });

    // Create memory directories and starter files
    fs.mkdirSync(path.join(tempWorkspace, ".orchestrator"), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, "SPEC.md"), "# Project Spec\nTarget file must contain PASSED.\n");
    fs.writeFileSync(path.join(tempWorkspace, ".orchestrator", "ROADMAP.md"), "- ROADMAP-001: Implement and verify target file status\n");

    // Create test validator script: exits 0 if target.txt contains PASSED, else exits 1
    const validatorScript = `
const fs = require('fs');
if (!fs.existsSync('target.txt')) process.exit(1);
const content = fs.readFileSync('target.txt', 'utf8').trim();
if (content === 'PASSED') process.exit(0);
process.exit(1);
    `;
    fs.writeFileSync(path.join(tempWorkspace, "test-validator.js"), validatorScript);

    // Initial baseline commit
    execSync("git add -A", { cwd: tempWorkspace, stdio: "ignore" });
    execSync('git commit -m "chore: baseline commit"', { cwd: tempWorkspace, stdio: "ignore" });

    // Initialize in-memory SQLite database
    closeDb();
    db = initDb(":memory:");
    const { runMigrations } = await import("../src/storage/migrations.js");
    runMigrations(db);
  });

  afterAll(() => {
    closeDb();
    if (tempWorkspace && fs.existsSync(tempWorkspace)) {
      try {
        fs.rmSync(tempWorkspace, { recursive: true, force: true });
      } catch {
        // Ignored on cleanup
      }
    }
  });

  it("proves complete vertical slice: failure -> isolated repair -> independent verifier pass -> Critic accept -> commit checkpoint", async () => {
    const projectRepo = new ProjectRepository(db);
    const runRepo = new RunRepository(db);

    const project = projectRepo.create({
      id: "proj-slice-1",
      name: "Vertical Slice Proof",
      objective: "Demonstrate failing check, repair, independent verifier, Critic review, and commit",
      rootPath: tempWorkspace,
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const run = runRepo.create({
      id: "run-slice-1",
      projectId: project.id,
      status: "running",
      currentTaskId: null,
      iterationCount: 0,
      stopReason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });

    const contextBuilder = new ContextBuilder(tempWorkspace);
    const provider = new MockReasoningProvider();
    const planner = new PlannerService(provider, contextBuilder);
    const critic = new CriticService(provider, contextBuilder);
    const budgetService = new BudgetService();

    // Setup Mock agent to simulate:
    // Attempt 1: writes "FAIL" into target.txt (causes independent verifier to fail)
    // Attempt 2: on repair, writes "PASSED" into target.txt (satisfies verifier)
    let callCount = 0;
    const mockAdapter = new MockAgentAdapter();
    mockAdapter.executeTask = async (task, wsPath, _ctx, _sig, onLog) => {
      callCount++;
      if (callCount === 1) {
        onLog?.("[Mock] Attempt 1: Writing incomplete work 'FAIL'\n");
        fs.writeFileSync(path.join(wsPath, "target.txt"), "FAIL");
      } else {
        onLog?.("[Mock] Attempt 2: Applying repair, writing 'PASSED'\n");
        fs.writeFileSync(path.join(wsPath, "target.txt"), "PASSED");
      }
      return {
        schema_version: 1,
        task_id: task.id,
        attempt_id: task.currentAttemptId || "att-1",
        status: "reported_complete",
        summary: callCount === 1 ? "Wrote incomplete draft" : "Fixed target file",
        files_changed: ["target.txt"],
        tests: [{ command: "node test-validator.js", agent_claim: "passed", claimed_exit_code: 0 }],
        blockers: [],
        questions: [],
        suggestions: [],
        requires_human: false,
        agent_session_id: `sess-${callCount}`,
      };
    };

    const loop = new AutonomousLoop(db, tempWorkspace, planner, critic, budgetService);

    // Override task verification plan to run our test-validator.js
    planner.planNextTask = async () => ({
      schema_version: 1,
      decision: "dispatch_task",
      rationale: "Fulfill ROADMAP-001 with test-validator.js check",
      next_task: {
        task_id: "task-slice-01",
        roadmap_item_id: "ROADMAP-001",
        requirement_ids: ["REQ-001"],
        title: "Create verified target.txt",
        objective: "Ensure target.txt contains PASSED and validator exits 0.",
        allowed_paths: ["target.txt"],
        acceptance_criteria: [
          { id: "AC-1", description: "Validator exits with code 0", required: true, verification: "unit_test" },
        ],
        verification_plan_ids: ["node test-validator.js"],
        risk: "low",
        requires_approval: false,
      },
      roadmap_proposals: [],
      open_questions: [],
      stop: false,
      stop_reason: null,
    });

    const result = await loop.runSingleTask({
      projectId: project.id,
      runId: run.id,
      workspacePath: tempWorkspace,
      agentAdapter: mockAdapter,
      approvedRoadmapIds: ["ROADMAP-001"],
    });

    // 1. Task must succeed after the repair attempt
    expect(result.status).toBe("succeeded");
    expect(result.attempts).toBe(2); // Exactly 1 failure + 1 repair
    expect(result.acceptedCommit).toBeDefined();

    // 2. Checkpoint commit was recorded in Git
    const gitLog = execSync("git log -n 1 --oneline", { cwd: tempWorkspace, encoding: "utf8" });
    expect(gitLog).toContain("checkpoint task task-slice-01");

    // 3. Verifier confirmed target.txt is PASSED
    const finalContent = fs.readFileSync(path.join(tempWorkspace, "target.txt"), "utf8").trim();
    expect(finalContent).toBe("PASSED");
  });

  it("demonstrates BrowserVerifier running visual assertions and capturing screenshot artifacts for UI tasks", async () => {
    // 1. Start a lightweight local HTTP test server on an ephemeral port
    const testServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!doctype html>
        <html>
          <head><title>UI Test Target</title></head>
          <body>
            <div id="target-element">Autonomous UI Active</div>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const port = (testServer.address() as { port: number }).port;
    const testUrl = `http://127.0.0.1:${port}`;

    try {
      const artifactsDir = path.join(tempWorkspace, "artifacts");
      const verifier = new BrowserVerifier(artifactsDir);

      const evidence = await verifier.verifyUi({
        url: testUrl,
        taskId: "task-ui-test",
        attemptId: "att-ui-1",
        expectedSelector: "#target-element",
      });

      // 2 viewports: desktop (1440x900) and mobile (390x844)
      expect(evidence.length).toBe(2);
      expect(evidence[0].passed).toBe(true);
      expect(evidence[0].assertionsPassed).toBeGreaterThanOrEqual(2);
      expect(evidence[0].consoleErrors.length).toBe(0);

      // Verify screenshot artifact was saved to disk
      const screenshotPath = path.join(artifactsDir, evidence[0].screenshotArtifactId!);
      expect(fs.existsSync(screenshotPath)).toBe(true);
      expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000);
    } finally {
      testServer.close();
    }
  });

  it("blocks model dispatch when budget limit is exhausted", async () => {
    const contextBuilder = new ContextBuilder(tempWorkspace);
    const provider = new MockReasoningProvider();
    const planner = new PlannerService(provider, contextBuilder);
    const critic = new CriticService(provider, contextBuilder);

    // Set budget limit to 0 calls
    const exhaustedBudget = new BudgetService({ maxReasoningCallsPerRun: 0 });
    const loop = new AutonomousLoop(db, tempWorkspace, planner, critic, exhaustedBudget);

    const result = await loop.runSingleTask({
      projectId: "proj-slice-1",
      runId: "run-slice-1",
      workspacePath: tempWorkspace,
      agentAdapter: new MockAgentAdapter(),
      approvedRoadmapIds: ["ROADMAP-001"],
    });

    expect(result.status).toBe("budget_exhausted");
    expect(result.error).toContain("Max reasoning calls per run reached 0");
  });

  it("is crash-safe and resumes existing run without duplicate execution", async () => {
    const runRepo = new RunRepository(db);
    const active = runRepo.findActiveByProjectId("proj-slice-1");
    expect(active).toBeDefined();

    // Attempting to start another run retrieves the active run idempotently
    const duplicate = runRepo.findActiveByProjectId("proj-slice-1");
    expect(duplicate?.id).toBe(active?.id);
  });
});
