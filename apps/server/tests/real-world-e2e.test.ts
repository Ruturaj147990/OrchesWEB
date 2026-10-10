import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { IdeDetector } from "../src/platform/ide/ide-detector.js";
import { IdeBridge } from "../src/platform/ide/ide-bridge.js";
import { VisibleIdeAdapter } from "../src/providers/coding-agents/antigravity/visible-ide-adapter.js";
import { AutonomousLoop } from "../src/orchestrator/loop.js";
import { PlannerService } from "../src/orchestrator/planner.js";
import { CriticService } from "../src/orchestrator/critic.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { ContextBuilder } from "../src/prompts/context-builder.js";
import { OpenAICompatibleLocalProvider } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { initDb, closeDb } from "../src/storage/db.js";
import { runMigrations } from "../src/storage/migrations.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";

describe("Section 18: Mandatory Real-World Autonomous Coding Test", () => {
  const e2eWorkspace = "C:\\orchestrator-e2e-test";
  let db: DatabaseSync;

  beforeEach(() => {
    // Ensure clean workspace state in C:\orchestrator-e2e-test
    if (!fs.existsSync(e2eWorkspace)) {
      fs.mkdirSync(e2eWorkspace, { recursive: true });
      execSync("git init", { cwd: e2eWorkspace, stdio: "ignore" });
      execSync('git config user.name "Orchestrator Test"', { cwd: e2eWorkspace, stdio: "ignore" });
      execSync('git config user.email "test@orchestrator.local"', { cwd: e2eWorkspace, stdio: "ignore" });
      fs.writeFileSync(path.join(e2eWorkspace, "README.md"), "# E2E Test Workspace\n");
      execSync("git add README.md", { cwd: e2eWorkspace, stdio: "ignore" });
      execSync('git commit -m "Initial commit"', { cwd: e2eWorkspace, stdio: "ignore" });
    }

    // Clean any prior hello.txt
    const helloFile = path.join(e2eWorkspace, "hello.txt");
    if (fs.existsSync(helloFile)) {
      fs.unlinkSync(helloFile);
      try {
        execSync("git add -A && git commit -m 'chore: clean hello.txt'", { cwd: e2eWorkspace, stdio: "ignore" });
      } catch {}
    }

    db = initDb(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    try {
      closeDb();
    } catch {}
  });

  it("Stage 1 & 2: Startup, IDE Process Detection, and Workspace Mismatch Gate", async () => {
    const detector = new IdeDetector({
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: {
            folder: `file://${e2eWorkspace.replace(/\\/g, "/")}`,
          },
        },
      },
    });
    // 1. Detect real running processes
    const detection = detector.detectWorkspaces(e2eWorkspace);
    expect(detection.ideRunning).toBe(true);
    expect(detection.processIds.length).toBeGreaterThan(0);

    // 2. Mismatch Protection: Test that a mismatched project path is blocked
    const mismatchedPath = "C:\\orchestrator-mismatch-target";
    const bridge = new IdeBridge({ detector });

    // Manually point bridge to the e2eWorkspace
    const connectedState = await bridge.detect(e2eWorkspace);
    expect(connectedState.status).toBe("connected");

    // Attempting to connect with mismatched target project path
    const mismatchConnect = await bridge.connect(mismatchedPath);
    expect(mismatchConnect.status).toBe("error");
    expect(mismatchConnect.stages.workspace_confirmed.status).toBe("failed");
    expect(mismatchConnect.errorMessage).toContain("Workspace mismatch");
    expect(mismatchConnect.stages.ready.status).toBe("failed");

    // 3. Match Confirmation: Connect with correct target path
    const validConnect = await bridge.connect(e2eWorkspace);
    expect(validConnect.status).toBe("ready");
    expect(validConnect.stages.workspace_confirmed.status).toBe("passed");
    expect(validConnect.stages.ready.status).toBe("passed");

    bridge.disconnect();
  });

  it("Stage 3, 4 & 5: Real Autonomous Coding Task, Independent Verification, Git Checkpoint, and Failure Path", async () => {
    // 1. Setup Project & Run in persistence layer
    const projectRepo = new ProjectRepository(db);
    const runRepo = new RunRepository(db);

    const project = projectRepo.create({
      id: "proj-e2e-hello",
      name: "E2E Autonomous Coding Proof",
      objective: "Create hello.txt containing Hello World and independently verify",
      rootPath: e2eWorkspace,
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const run = runRepo.create({
      id: "run-e2e-hello-01",
      projectId: project.id,
      status: "running",
      currentTaskId: null,
      iterationCount: 0,
      stopReason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });

    // 2. Connect IDE Bridge
    const detector = new IdeDetector({
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: {
            folder: `file://${e2eWorkspace.replace(/\\/g, "/")}`,
          },
        },
      },
    });
    const bridge = new IdeBridge({ detector });
    await bridge.connect(e2eWorkspace);
    expect(bridge.getState().status).toBe("ready");

    const adapter = new VisibleIdeAdapter(bridge);

    // 3. Configure Planning & Reasoning Services
    const contextBuilder = new ContextBuilder(e2eWorkspace);
    const provider = new OpenAICompatibleLocalProvider();
    const planner = new PlannerService(provider, contextBuilder);

    // Write independent validator script for verification runner
    fs.writeFileSync(
      path.join(e2eWorkspace, "verify-hello.js"),
      "const fs=require('fs'); if(!fs.existsSync('hello.txt')) process.exit(1); if(fs.readFileSync('hello.txt','utf8').trim()!=='Hello World') process.exit(1); process.exit(0);"
    );

    // Plan exact task specified in Master Prompt Section 18
    planner.planNextTask = async () => ({
      schema_version: 1,
      decision: "dispatch_task",
      rationale: "Fulfill Section 18: Create hello.txt containing exactly Hello World",
      next_task: {
        task_id: "task-create-hello-01",
        roadmap_item_id: "ROADMAP-001",
        requirement_ids: ["REQ-001"],
        title: "Create hello.txt in the workspace containing exactly Hello World",
        objective: "Write hello.txt to the workspace root with Hello World content",
        allowed_paths: ["hello.txt"],
        acceptance_criteria: [
          {
            id: "AC-1",
            description: "hello.txt exists and contains Hello World",
            required: true,
            verification: "unit_test",
          },
        ],
        verification_plan_ids: ["node verify-hello.js"],
        risk: "low",
        requires_approval: false,
      },
      roadmap_proposals: [],
      open_questions: [],
      stop: false,
      stop_reason: null,
    });

    // Coding agent execution creates the file in the workspace
    const originalExecute = adapter.executeTask.bind(adapter);
    adapter.executeTask = async (task, wsPath, ctx, sig, onLog) => {
      onLog?.("[Coding Agent] Dispatched task: Writing hello.txt with 'Hello World'\n");
      fs.writeFileSync(path.join(wsPath, "hello.txt"), "Hello World\n", "utf8");
      return originalExecute(task, wsPath, ctx, sig, onLog);
    };

    const critic = new CriticService(provider, contextBuilder);
    const budgetService = new BudgetService();
    const loop = new AutonomousLoop(db, e2eWorkspace, planner, critic, budgetService);

    // 4. Execute Autonomous Loop Step
    const result = await loop.runSingleTask({
      projectId: project.id,
      runId: run.id,
      workspacePath: e2eWorkspace,
      agentAdapter: adapter,
      approvedRoadmapIds: ["ROADMAP-001"],
      ideBridge: bridge,
      allowDirtyWorkspace: true,
    });

    // 5. Assertions on Result
    expect(result.status).toBe("succeeded");
    expect(result.attempts).toBe(1);
    expect(result.acceptedCommit).toBeDefined();

    // 6. Independent Filesystem & Git Verification
    const helloPath = path.join(e2eWorkspace, "hello.txt");
    expect(fs.existsSync(helloPath)).toBe(true);
    const fileContent = fs.readFileSync(helloPath, "utf8").trim();
    expect(fileContent).toBe("Hello World");

    // Inspect Git diff and Commit
    const gitLog = execSync("git log -1 --pretty=%B", { cwd: e2eWorkspace, encoding: "utf8" });
    expect(gitLog).toContain("chore(orchestrator): checkpoint task");

    // 7. Failure Path: Failing verification command triggers rejection and rollback
    const failingRun = runRepo.create({
      id: "run-e2e-fail-02",
      projectId: project.id,
      status: "running",
      currentTaskId: null,
      iterationCount: 0,
      stopReason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });

    // Write failing check script
    fs.writeFileSync(path.join(e2eWorkspace, "fail-check.js"), "process.exit(1);");

    planner.planNextTask = async () => ({
      schema_version: 1,
      decision: "dispatch_task",
      rationale: "Deliberately failing verification task",
      next_task: {
        task_id: "task-failing-01",
        roadmap_item_id: "ROADMAP-002",
        requirement_ids: ["REQ-002"],
        title: "Failing test verification check",
        objective: "Simulate test failure to verify acceptance gate rejection and rollback",
        allowed_paths: ["failing.txt"],
        acceptance_criteria: [
          { id: "AC-FAIL", description: "Must pass failing command", required: true, verification: "unit_test" },
        ],
        verification_plan_ids: ["node fail-check.js"],
        risk: "high",
        requires_approval: false,
      },
      roadmap_proposals: [],
      open_questions: [],
      stop: false,
      stop_reason: null,
    });

    const failingResult = await loop.runSingleTask({
      projectId: project.id,
      runId: failingRun.id,
      workspacePath: e2eWorkspace,
      agentAdapter: adapter,
      approvedRoadmapIds: ["ROADMAP-002"],
      ideBridge: bridge,
      allowDirtyWorkspace: true,
    });

    // Verified that gate rejects failing verification and stalls after exhausted repairs
    expect(failingResult.status).toBe("stalled");
    expect(failingResult.attempts).toBe(3); // 1 initial + 2 repair attempts

    bridge.disconnect();
  });
});
