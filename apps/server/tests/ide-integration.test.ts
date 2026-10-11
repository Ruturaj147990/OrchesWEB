import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { IdeDetector } from "../src/platform/ide/ide-detector.js";
import { IdeBridge } from "../src/platform/ide/ide-bridge.js";
import { VisibleIdeAdapter } from "../src/providers/coding-agents/antigravity/visible-ide-adapter.js";
import { AutonomousLoop } from "../src/orchestrator/loop.js";
import { PlannerService } from "../src/orchestrator/planner.js";
import { CriticService } from "../src/orchestrator/critic.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { initDb, closeDb } from "../src/storage/db.js";
import { runMigrations } from "../src/storage/migrations.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";
import { buildApp } from "../src/app.js";
import { resetSharedIdeBridge } from "../src/api/routes/ide.js";

describe("Visible Antigravity IDE Integration", () => {
  let tmpDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ide-test-"));
    db = initDb(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    try {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  it("1. Detects IDE windows and workspaces correctly with canonical paths", () => {
    const ws1 = path.join(tmpDir, "project-alpha");
    const ws2 = path.join(tmpDir, "project-beta");
    fs.mkdirSync(ws1, { recursive: true });
    fs.mkdirSync(ws2, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [
        { processId: 1001, name: "Antigravity IDE" },
        { processId: 1002, name: "language_server_windows_x64" },
      ],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: {
            folder: `file://${ws1.replace(/\\/g, "/")}`,
          },
        },
        backupWorkspaces: {
          folders: [
            { folderUri: `file://${ws1.replace(/\\/g, "/")}` },
            { folderUri: `file://${ws2.replace(/\\/g, "/")}` },
          ],
        },
      },
    });

    const result = detector.detectWorkspaces(ws1);
    expect(result.ideRunning).toBe(true);
    expect(result.processIds).toContain(1001);
    expect(result.workspaces.length).toBe(2);

    const matchWs = result.workspaces.find((w) => w.isMatchingProject);
    expect(matchWs).toBeDefined();
    expect(matchWs?.canonicalPath.toLowerCase()).toBe(detector.canonicalizePath(ws1).toLowerCase());
    expect(matchWs?.isActiveWindow).toBe(true);

    const otherWs = result.workspaces.find((w) => !w.isMatchingProject);
    expect(otherWs).toBeDefined();
    expect(otherWs?.canonicalPath.toLowerCase()).toBe(detector.canonicalizePath(ws2).toLowerCase());
    expect(otherWs?.isActiveWindow).toBe(false);
  });

  it("2. Handles multiple IDE windows and lets user select the workspace", async () => {
    const wsAlpha = path.join(tmpDir, "alpha");
    const wsBeta = path.join(tmpDir, "beta");
    fs.mkdirSync(wsAlpha, { recursive: true });
    fs.mkdirSync(wsBeta, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 2020, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: { folder: `file://${wsAlpha.replace(/\\/g, "/")}` },
        },
        backupWorkspaces: {
          folders: [
            { folderUri: `file://${wsAlpha.replace(/\\/g, "/")}` },
            { folderUri: `file://${wsBeta.replace(/\\/g, "/")}` },
          ],
        },
      },
    });

    const bridge = new IdeBridge({ detector });
    const detectedState = await bridge.detect(wsBeta);
    expect(detectedState.detectedWorkspaces.length).toBe(2);

    // Find beta workspace
    const betaWs = detectedState.detectedWorkspaces.find((w) => w.name === "beta");
    expect(betaWs).toBeDefined();

    // Select beta workspace
    const updated = bridge.selectWorkspace(betaWs!.id, wsBeta);
    expect(updated.selectedWorkspace?.id).toBe(betaWs!.id);
    expect(updated.selectedWorkspace?.name).toBe("beta");

    bridge.disconnect();
  });

  it("3. Prohibits connection when selected workspace path does not match target project", async () => {
    const wsTarget = path.join(tmpDir, "target-project");
    const wsWrong = path.join(tmpDir, "wrong-project");
    fs.mkdirSync(wsTarget, { recursive: true });
    fs.mkdirSync(wsWrong, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 3030, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: { folder: `file://${wsWrong.replace(/\\/g, "/")}` },
        },
      },
    });

    const bridge = new IdeBridge({ detector });
    // Attempt connecting to wsTarget while IDE is open on wsWrong
    const state = await bridge.connect(wsTarget);

    expect(state.status).toBe("error");
    expect(state.stages.workspace_confirmed.status).toBe("failed");
    expect(state.stages.ready.status).toBe("failed");
    expect(state.errorMessage).toContain("Workspace mismatch");
    expect(state.errorMessage).toContain("prohibited");

    bridge.disconnect();
  });

  it("4. Prohibits connection and explains why when IDE is not running", async () => {
    const ws = path.join(tmpDir, "project");
    fs.mkdirSync(ws, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [], // No IDE processes
    });

    const bridge = new IdeBridge({ detector });
    const state = await bridge.connect(ws);

    expect(state.status).toBe("error");
    expect(state.stages.ide_detected.status).toBe("failed");
    expect(state.stages.ready.status).toBe("failed");
    expect(state.errorMessage).toContain("Antigravity IDE is not running");

    bridge.disconnect();
  });

  it("5. Completes entire 6-stage handshake and verifies agent readiness", async () => {
    const ws = path.join(tmpDir, "verified-project");
    fs.mkdirSync(ws, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 4040, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: { folder: `file://${ws.replace(/\\/g, "/")}` },
        },
      },
    });

    const bridge = new IdeBridge({
      detector,
      mockAgentTestResult: { success: true, details: "Mock agent readiness verified." },
    });

    const state = await bridge.connect(ws);

    expect(state.status).toBe("ready");
    expect(state.stages.ide_detected.status).toBe("passed");
    expect(state.stages.workspace_identified.status).toBe("passed");
    expect(state.stages.connection_established.status).toBe("passed");
    expect(state.stages.workspace_confirmed.status).toBe("passed");
    expect(state.stages.agent_tested.status).toBe("passed");
    expect(state.stages.ready.status).toBe("passed");
    expect(state.lastHeartbeat).not.toBeNull();

    // Verify test-agent probe can be invoked independently
    const probe = await bridge.testAgent(ws);
    expect(probe.success).toBe(true);

    // Verify disconnect cleanly resets stages
    const disconnected = bridge.disconnect();
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.selectedWorkspace).toBeNull();
  });

  it("6. VisibleIdeAdapter enforces connection readiness before executing tasks", async () => {
    const ws = path.join(tmpDir, "adapter-project");
    fs.mkdirSync(ws, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 5050, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: { folder: `file://${ws.replace(/\\/g, "/")}` },
        },
      },
    });

    const bridge = new IdeBridge({ detector, mockAgentTestResult: { success: true } });
    const adapter = new VisibleIdeAdapter(bridge);

    // Before connection, executeTask should fail immediately
    await expect(
      adapter.executeTask(
        {
          id: "task-01",
          projectId: "p1",
          runId: "r1",
          title: "Test task",
          objective: "Validate",
          roadmapItemId: "rm1",
          requirementIds: [],
          status: "running",
          priority: "high",
          risk: "low",
          allowedPaths: ["*"],
          forbiddenPaths: [],
          acceptanceCriteria: [],
          verificationPlan: [],
          attemptCount: 1,
          currentAttemptId: "att-1",
          maxAttempts: 3,
          requiresApproval: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ws,
        "Context packet"
      )
    ).rejects.toThrow(/Connection is not ready/);

    // Connect bridge
    await bridge.connect(ws);

    // After connection is ready, executeTask succeeds and returns report
    const logs: string[] = [];
    const report = await adapter.executeTask(
      {
        id: "task-01",
        projectId: "p1",
        runId: "r1",
        title: "Test task",
        objective: "Validate",
        roadmapItemId: "rm1",
        requirementIds: [],
        status: "running",
        priority: "high",
        risk: "low",
        allowedPaths: ["*"],
        forbiddenPaths: [],
        acceptanceCriteria: [],
        verificationPlan: [],
        attemptCount: 1,
        currentAttemptId: "att-1",
        maxAttempts: 3,
        requiresApproval: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ws,
      "Context packet",
      undefined,
      (l) => logs.push(l)
    );

    expect(report.status).toBe("reported_complete");
    expect(logs.some((l) => l.includes("[Visible Antigravity IDE]"))).toBe(true);

    bridge.disconnect();
  });

  it("7. REST API: supports detect, select-workspace, connect, test-connection, disconnect, and mode toggle", async () => {
    const ws = path.join(tmpDir, "api-project");
    fs.mkdirSync(ws, { recursive: true });

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 6060, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: {
          lastActiveWindow: { folder: `file://${ws.replace(/\\/g, "/")}` },
        },
      },
    });

    const bridge = new IdeBridge({ detector, mockAgentTestResult: { success: true } });
    resetSharedIdeBridge(bridge);

    const app = await buildApp(":memory:");

    // GET /api/v1/ide/status
    const resStatus = await app.inject({ method: "GET", url: "/api/v1/ide/status" });
    expect(resStatus.statusCode).toBe(200);
    const statusData = JSON.parse(resStatus.payload);
    expect(statusData.status).toBe("connected");

    // POST /api/v1/ide/mode
    const resMode = await app.inject({
      method: "POST",
      url: "/api/v1/ide/mode",
      payload: { mode: "visible_ide" },
    });
    expect(resMode.statusCode).toBe(200);
    expect(JSON.parse(resMode.payload).activeMode).toBe("visible_ide");

    // POST /api/v1/ide/connect
    const resConnect = await app.inject({
      method: "POST",
      url: "/api/v1/ide/connect",
      payload: { projectRootPath: ws },
    });
    expect(resConnect.statusCode).toBe(200);
    const connectData = JSON.parse(resConnect.payload);
    expect(connectData.status).toBe("ready");
    expect(connectData.stages.ready.status).toBe("passed");

    // POST /api/v1/ide/test-connection
    const resTest = await app.inject({
      method: "POST",
      url: "/api/v1/ide/test-connection",
      payload: { projectRootPath: ws },
    });
    expect(resTest.statusCode).toBe(200);
    expect(JSON.parse(resTest.payload).success).toBe(true);

    // POST /api/v1/ide/disconnect
    const resDisconnect = await app.inject({ method: "POST", url: "/api/v1/ide/disconnect" });
    expect(resDisconnect.statusCode).toBe(200);
    expect(JSON.parse(resDisconnect.payload).status).toBe("disconnected");

    await app.close();
    bridge.disconnect();
  });

  it("8. Protects unrelated user work by pausing when uncommitted/untracked changes exist", async () => {
    const gitWs = path.join(tmpDir, "git-dirty-test");
    fs.mkdirSync(gitWs, { recursive: true });

    // Initialize git repo
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: gitWs, stdio: "ignore" });
    execSync('git config user.name "Tester"', { cwd: gitWs, stdio: "ignore" });
    execSync('git config user.email "tester@test.local"', { cwd: gitWs, stdio: "ignore" });

    // Initial baseline commit
    fs.writeFileSync(path.join(gitWs, "README.md"), "# Project Baseline\n");
    execSync("git add -A", { cwd: gitWs, stdio: "ignore" });
    execSync('git commit -m "chore: baseline commit"', { cwd: gitWs, stdio: "ignore" });

    // User creates uncommitted manual edits in the open IDE
    fs.writeFileSync(path.join(gitWs, "uncommitted_user_notes.txt"), "Important developer notes not yet committed.");

    const projectRepo = new ProjectRepository(db);
    const runRepo = new RunRepository(db);

    const project = projectRepo.create({
      id: "proj-dirty-1",
      name: "Dirty Guard Test",
      objective: "Verify dirty git state safety guard",
      rootPath: gitWs,
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const run = runRepo.create({
      id: "run-dirty-1",
      projectId: project.id,
      status: "running",
      currentTaskId: null,
      iterationCount: 0,
      stopReason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });

    const { ContextBuilder } = await import("../src/prompts/context-builder.js");
    const { MockReasoningProvider } = await import("../src/providers/reasoning/mock/mock-provider.js");
    const contextBuilder = new ContextBuilder(gitWs);
    const provider = new MockReasoningProvider();
    const planner = new PlannerService(provider, contextBuilder);
    const critic = new CriticService(provider, contextBuilder);
    const budgetService = new BudgetService();

    const loop = new AutonomousLoop(db, gitWs, planner, critic, budgetService);

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 7070, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: { lastActiveWindow: { folder: `file://${gitWs.replace(/\\/g, "/")}` } },
      },
    });
    const bridge = new IdeBridge({ detector, mockAgentTestResult: { success: true } });
    await bridge.connect(gitWs);
    const adapter = new VisibleIdeAdapter(bridge);

    const result = await loop.runSingleTask({
      projectId: project.id,
      runId: run.id,
      workspacePath: gitWs,
      agentAdapter: adapter,
      approvedRoadmapIds: ["ROADMAP-001"],
      ideBridge: bridge,
      allowDirtyWorkspace: false,
    });

    // Proves safe pause without overwriting user work
    expect(result.status).toBe("stopped");
    expect(result.error).toContain("Dirty workspace");
    expect(fs.existsSync(path.join(gitWs, "uncommitted_user_notes.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(gitWs, "uncommitted_user_notes.txt"), "utf8")).toBe("Important developer notes not yet committed.");

    const updatedRun = runRepo.findById(run.id);
    expect(updatedRun?.status).toBe("paused");

    bridge.disconnect();
  });

  it("9. Executes complete autonomous development loop in Visible IDE mode with verification and commit", async () => {
    const gitWs = path.join(tmpDir, "git-visible-loop");
    fs.mkdirSync(gitWs, { recursive: true });

    // Initialize git repo
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: gitWs, stdio: "ignore" });
    execSync('git config user.name "Tester"', { cwd: gitWs, stdio: "ignore" });
    execSync('git config user.email "tester@test.local"', { cwd: gitWs, stdio: "ignore" });

    // Create memory directories and validator
    fs.mkdirSync(path.join(gitWs, ".orchestrator"), { recursive: true });
    fs.writeFileSync(path.join(gitWs, "SPEC.md"), "# Spec\nFile target.txt must contain PASSED.\n");
    fs.writeFileSync(path.join(gitWs, ".orchestrator", "ROADMAP.md"), "- ROADMAP-001: Implement feature\n");

    const validatorScript = `
const fs = require('fs');
if (!fs.existsSync('target.txt')) process.exit(1);
const content = fs.readFileSync('target.txt', 'utf8').trim();
if (content === 'PASSED') process.exit(0);
process.exit(1);
    `;
    fs.writeFileSync(path.join(gitWs, "test-validator.js"), validatorScript);

    execSync("git add -A", { cwd: gitWs, stdio: "ignore" });
    execSync('git commit -m "chore: baseline commit"', { cwd: gitWs, stdio: "ignore" });

    const projectRepo = new ProjectRepository(db);
    const runRepo = new RunRepository(db);

    const project = projectRepo.create({
      id: "proj-visible-1",
      name: "Visible IDE Loop Proof",
      objective: "Execute complete loop with visible IDE",
      rootPath: gitWs,
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const run = runRepo.create({
      id: "run-visible-1",
      projectId: project.id,
      status: "running",
      currentTaskId: null,
      iterationCount: 0,
      stopReason: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });

    const { ContextBuilder } = await import("../src/prompts/context-builder.js");
    const { MockReasoningProvider } = await import("../src/providers/reasoning/mock/mock-provider.js");
    const contextBuilder = new ContextBuilder(gitWs);
    const provider = new MockReasoningProvider();
    const planner = new PlannerService(provider, contextBuilder);
    planner.planNextTask = async () => ({
      schema_version: 1,
      decision: "dispatch_task",
      rationale: "Fulfill ROADMAP-001 with validator script check",
      next_task: {
        task_id: "task-visible-01",
        roadmap_item_id: "ROADMAP-001",
        requirement_ids: ["REQ-001"],
        title: "Create verified target.txt in visible workspace",
        objective: "Ensure target.txt contains PASSED and test-validator.js exits 0.",
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
    const critic = new CriticService(provider, contextBuilder);
    const budgetService = new BudgetService();

    const loop = new AutonomousLoop(db, gitWs, planner, critic, budgetService);

    const detector = new IdeDetector({
      mockProcesses: [{ processId: 8080, name: "Antigravity IDE" }],
      mockStorageJson: {
        windowsState: { lastActiveWindow: { folder: `file://${gitWs.replace(/\\/g, "/")}` } },
      },
    });
    const bridge = new IdeBridge({ detector, mockAgentTestResult: { success: true } });
    await bridge.connect(gitWs);

    const adapter = new VisibleIdeAdapter(bridge);
    // Simulate live code modification appearing in the open workspace
    const origExecute = adapter.executeTask.bind(adapter);
    adapter.executeTask = async (task, wsPath, ctx, sig, onLog) => {
      fs.writeFileSync(path.join(wsPath, "target.txt"), "PASSED");
      return origExecute(task, wsPath, ctx, sig, onLog);
    };

    const result = await loop.runSingleTask({
      projectId: project.id,
      runId: run.id,
      workspacePath: gitWs,
      agentAdapter: adapter,
      approvedRoadmapIds: ["ROADMAP-001"],
      ideBridge: bridge,
    });

    expect(result.status).toBe("succeeded");
    expect(result.attempts).toBe(1);
    expect(result.acceptedCommit).toBeDefined();

    // Verify commit in git log
    const gitLog = execSync("git log -1 --pretty=%B", { cwd: gitWs, encoding: "utf8" });
    expect(gitLog).toContain("chore(orchestrator): checkpoint task");

    bridge.disconnect();
  });
});
