import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { GitManager } from "../src/git/git-manager.js";
import { SnapshotManager } from "../src/git/snapshot-manager.js";
import { AutonomousLoop } from "../src/orchestrator/loop.js";
import { PlannerService } from "../src/orchestrator/planner.js";
import { CriticService } from "../src/orchestrator/critic.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { ContextBuilder } from "../src/prompts/context-builder.js";
import { MockReasoningProvider } from "../src/providers/reasoning/mock/mock-provider.js";
import { MockAgentAdapter } from "../src/providers/coding-agents/mock/mock-adapter.js";
import { initDb, closeDb } from "../src/storage/db.js";
import { runMigrations } from "../src/storage/migrations.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";
import { SettingsManager } from "../src/platform/settings-manager.js";

describe("Git-Optional, Non-Git Snapshot Safety & Local Repository Support", () => {
  let tempBase: string;
  let nonGitWorkspace: string;
  let localGitWorkspace: string;
  let githubWorkspace: string;
  let db: DatabaseSync;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-git-tests-"));
    SettingsManager.setDataDir(path.join(tempBase, "settings"));

    // 1. Non-Git Workspace: pure directory with zero .git folder
    nonGitWorkspace = path.join(tempBase, "non-git-project");
    fs.mkdirSync(nonGitWorkspace, { recursive: true });
    fs.writeFileSync(path.join(nonGitWorkspace, "package.json"), '{\n  "name": "non-git-app"\n}\n');
    fs.writeFileSync(path.join(nonGitWorkspace, "user-existing.txt"), "Original un-touched user file\n");

    // 2. Local Git Workspace: .git exists, but NO remote configured
    localGitWorkspace = path.join(tempBase, "local-git-project");
    fs.mkdirSync(localGitWorkspace, { recursive: true });
    execSync("git init", { cwd: localGitWorkspace, stdio: "ignore" });
    execSync('git config user.name "Test User"', { cwd: localGitWorkspace, stdio: "ignore" });
    execSync('git config user.email "test@user.local"', { cwd: localGitWorkspace, stdio: "ignore" });
    fs.writeFileSync(path.join(localGitWorkspace, "README.md"), "# Local Git\n");
    execSync("git add README.md", { cwd: localGitWorkspace, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', { cwd: localGitWorkspace, stdio: "ignore" });

    // 3. GitHub-connected Workspace: .git exists and remote origin configured
    githubWorkspace = path.join(tempBase, "github-connected-project");
    fs.mkdirSync(githubWorkspace, { recursive: true });
    execSync("git init", { cwd: githubWorkspace, stdio: "ignore" });
    execSync('git config user.name "Test User"', { cwd: githubWorkspace, stdio: "ignore" });
    execSync('git config user.email "test@user.local"', { cwd: githubWorkspace, stdio: "ignore" });
    execSync("git remote add origin https://github.com/example-user/sample-repo.git", { cwd: githubWorkspace, stdio: "ignore" });
    fs.writeFileSync(path.join(githubWorkspace, "README.md"), "# GitHub Repo\n");
    execSync("git add README.md", { cwd: githubWorkspace, stdio: "ignore" });
    execSync('git commit -m "Initial remote commit"', { cwd: githubWorkspace, stdio: "ignore" });

    db = initDb(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    try {
      closeDb();
      SettingsManager.reset();
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Git Detection & Remote Status Inspection", () => {
    it("correctly identifies non-Git folders and defaults to local_snapshot safety mode", async () => {
      const gitManager = new GitManager(nonGitWorkspace);
      const status = await gitManager.getStatus();

      expect(status.isGitRepo).toBe(false);
      expect(status.hasRemote).toBe(false);
      expect(status.remoteUrl).toBeNull();
      expect(status.safetyMode).toBe("local_snapshot");
      expect(status.activeBranch).toBeNull();
    });

    it("correctly identifies local Git repositories without remotes", async () => {
      const gitManager = new GitManager(localGitWorkspace);
      const status = await gitManager.getStatus();

      expect(status.isGitRepo).toBe(true);
      expect(status.hasRemote).toBe(false);
      expect(status.remoteUrl).toBeNull();
      expect(status.safetyMode).toBe("git");
      expect(status.baselineCommit).toBeDefined();
    });

    it("correctly identifies GitHub-connected repositories without triggering network pushes", async () => {
      const gitManager = new GitManager(githubWorkspace);
      const status = await gitManager.getStatus();

      expect(status.isGitRepo).toBe(true);
      expect(status.hasRemote).toBe(true);
      expect(status.remoteUrl).toBe("https://github.com/example-user/sample-repo.git");
      expect(status.safetyMode).toBe("git");
    });
  });

  describe("2. Local Snapshot Safety Operations (Non-Git Folder)", () => {
    it("takes snapshots, computes unified diffs, and commits checkpoints without Git", async () => {
      const gitManager = new GitManager(nonGitWorkspace);

      // Initial baseline
      const initialStatus = await gitManager.getStatus();
      expect(initialStatus.isDirty).toBe(false);

      // Create pre-attempt baseline snapshot
      const attemptSnapId = await gitManager.createAttemptBranch("proj-1", "task-1", 1);
      expect(attemptSnapId).toMatch(/^snap-/);

      // Simulate agent modifying a file and adding a new file
      fs.writeFileSync(path.join(nonGitWorkspace, "package.json"), '{\n  "name": "non-git-app",\n  "version": "1.0.0"\n}\n');
      fs.writeFileSync(path.join(nonGitWorkspace, "src-code.js"), 'console.log("hello world");\n');

      // Compute diff
      const diffSummary = await gitManager.getDiffSummary();
      expect(diffSummary.filesChanged).toContain("package.json");
      expect(diffSummary.filesChanged).toContain("src-code.js");
      expect(diffSummary.diff).toContain("+  \"version\": \"1.0.0\"");
      expect(diffSummary.diff).toContain("+console.log(\"hello world\");");

      // Commit safety checkpoint
      const checkpointId = await gitManager.commitCheckpoint("task-1", "Feature implemented", diffSummary.filesChanged);
      expect(checkpointId).toMatch(/^snap-/);

      const postCommitStatus = await gitManager.getStatus();
      expect(postCommitStatus.baselineCommit).toBe(checkpointId);
    });

    it("safely rolls back failed attempts without destroying pre-existing user files", async () => {
      const gitManager = new GitManager(nonGitWorkspace);

      // Baseline before agent runs
      const baselineSnapId = await gitManager.createAttemptBranch("proj-1", "task-1", 1);

      // Pre-existing user file content
      const originalUserFileContent = fs.readFileSync(path.join(nonGitWorkspace, "user-existing.txt"), "utf8");

      // Agent creates a bad file and mistakenly modifies package.json
      const strayBadFile = path.join(nonGitWorkspace, "stray-bad-file.js");
      fs.writeFileSync(strayBadFile, "syntax error here");
      fs.writeFileSync(path.join(nonGitWorkspace, "package.json"), "CORRUPT JSON");

      const diffSummary = await gitManager.getDiffSummary();
      expect(diffSummary.filesChanged).toContain("stray-bad-file.js");
      expect(diffSummary.filesChanged).toContain("package.json");

      // Rollback attempt
      await gitManager.rollbackAttempt(baselineSnapId, diffSummary.filesChanged);

      // 1. Stray file was cleaned up
      expect(fs.existsSync(strayBadFile)).toBe(false);

      // 2. package.json restored
      const restoredPkg = fs.readFileSync(path.join(nonGitWorkspace, "package.json"), "utf8");
      expect(restoredPkg).toContain('"name": "non-git-app"');

      // 3. Pre-existing user file was never touched
      const currentUserFile = fs.readFileSync(path.join(nonGitWorkspace, "user-existing.txt"), "utf8");
      expect(currentUserFile).toBe(originalUserFileContent);
    });

    it("allows explicit user-consented Git initialization without configuring remotes", async () => {
      const gitManager = new GitManager(nonGitWorkspace);
      expect((await gitManager.getStatus()).isGitRepo).toBe(false);

      const initResult = await gitManager.initRepo();
      expect(initResult.success).toBe(true);

      const postInitStatus = await gitManager.getStatus();
      expect(postInitStatus.isGitRepo).toBe(true);
      expect(postInitStatus.hasRemote).toBe(false);
      expect(postInitStatus.remoteUrl).toBeNull();
      expect(postInitStatus.safetyMode).toBe("git");
    });
  });

  describe("3. Real Autonomous Task Execution in Disposable Non-Git Directory", () => {
    it("executes complete autonomous development loop with verification, Critic review, and snapshot checkpoint in non-Git folder", async () => {
      const projectRepo = new ProjectRepository(db);
      const runRepo = new RunRepository(db);

      const project = projectRepo.create({
        id: "proj-nongit-01",
        name: "Autonomous Non-Git Slice",
        objective: "Verify autonomous coding loop in a folder with zero git configuration",
        rootPath: nonGitWorkspace,
        profileId: "general",
        autonomyMode: "creative_within_constraints",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const run = runRepo.create({
        id: "run-nongit-01",
        projectId: project.id,
        status: "running",
        currentTaskId: null,
        iterationCount: 0,
        stopReason: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });

      // Verification script that checks for created non-git-output.txt
      const verifyScriptPath = path.join(nonGitWorkspace, "verify-step.js");
      fs.writeFileSync(
        verifyScriptPath,
        `
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, 'non-git-output.txt');
        if (!fs.existsSync(file)) {
          console.error("Missing non-git-output.txt");
          process.exit(1);
        }
        const content = fs.readFileSync(file, 'utf8');
        if (!content.includes("Autonomous Non-Git Success")) {
          console.error("Content mismatch:", content);
          process.exit(2);
        }
        console.log("Verification passed: non-git-output.txt matches required content");
        process.exit(0);
        `
      );

      // Mock agent that generates the exact required file
      const agentAdapter = new MockAgentAdapter({
        mode: "success",
        filesToModify: [
          {
            relativePath: "non-git-output.txt",
            content: "Autonomous Non-Git Success\n",
          },
        ],
      });

      const contextBuilder = new ContextBuilder(nonGitWorkspace);
      const localProvider = new MockReasoningProvider();
      const planner = new PlannerService(localProvider, contextBuilder);
      const critic = new CriticService(localProvider, contextBuilder);
      const budgetService = new BudgetService();

      planner.planNextTask = async () => ({
        schema_version: 1,
        decision: "dispatch_task",
        rationale: "Generate non-git autonomous output file",
        next_task: {
          task_id: "task-nongit-01",
          roadmap_item_id: "rm-nongit-01",
          requirement_ids: ["req-nongit-01"],
          title: "Generate non-git autonomous output file",
          objective: "Write non-git-output.txt with exact text 'Autonomous Non-Git Success'",
          allowed_paths: ["non-git-output.txt"],
          acceptance_criteria: [
            { id: "ac-1", description: "Verification script exits 0", required: true, verification: "unit_test" },
          ],
          verification_plan_ids: ["node verify-step.js"],
          risk: "low",
          requires_approval: false,
        },
        roadmap_proposals: [],
        open_questions: [],
        stop: false,
        stop_reason: null,
      });

      const loop = new AutonomousLoop(db, nonGitWorkspace, planner, critic, budgetService);

      const result = await loop.runSingleTask({
        projectId: project.id,
        runId: run.id,
        workspacePath: nonGitWorkspace,
        agentAdapter,
        approvedRoadmapIds: ["rm-nongit-01"],
        allowDirtyWorkspace: true,
      });

      // Assertions
      expect(result.status).toBe("succeeded");
      expect(result.acceptedCommit).toBeDefined();
      expect(result.acceptedCommit).toMatch(/^snap-/);

      // Verify file exists on disk
      const outputFile = path.join(nonGitWorkspace, "non-git-output.txt");
      expect(fs.existsSync(outputFile)).toBe(true);
      expect(fs.readFileSync(outputFile, "utf8")).toBe("Autonomous Non-Git Success\n");

      // Verify task in SQLite database
      const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.taskId) as any;
      expect(taskRow).toBeDefined();
      expect(taskRow.status).toBe("succeeded");

      // Verify run iteration incremented
      const updatedRun = runRepo.findById(run.id);
      expect(updatedRun?.iterationCount).toBe(1);

      // Verify snapshot manager has durable checkpoint recorded
      const gitManager = new GitManager(nonGitWorkspace);
      const snapshots = gitManager.getSnapshotManager().listSnapshots();
      expect(snapshots.length).toBeGreaterThan(0);
    });

    it("handles verifier failure and bounded repair rollback cleanly in non-Git folder", async () => {
      const projectRepo = new ProjectRepository(db);
      const runRepo = new RunRepository(db);

      const project = projectRepo.create({
        id: "proj-nongit-fail-01",
        name: "Failure Path Non-Git Slice",
        objective: "Verify rollback and bounded repair in a folder without git",
        rootPath: nonGitWorkspace,
        profileId: "general",
        autonomyMode: "strict_blueprint_adherence",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const run = runRepo.create({
        id: "run-nongit-fail-01",
        projectId: project.id,
        status: "running",
        currentTaskId: null,
        iterationCount: 0,
        stopReason: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });

      // Verification script that deliberately always fails
      const failingScriptPath = path.join(nonGitWorkspace, "always-fail.js");
      fs.writeFileSync(failingScriptPath, `console.error("Deliberate failure check"); process.exit(1);`);

      // Agent generates broken attempt file
      const agentAdapter = new MockAgentAdapter({
        mode: "failing_tests",
        filesToModify: [
          {
            relativePath: "broken-attempt.txt",
            content: "broken attempt content\n",
          },
        ],
      });

      const contextBuilder = new ContextBuilder(nonGitWorkspace);
      const localProvider = new MockReasoningProvider();
      const planner = new PlannerService(localProvider, contextBuilder);
      const critic = new CriticService(localProvider, contextBuilder);
      const budgetService = new BudgetService();

      planner.planNextTask = async () => ({
        schema_version: 1,
        decision: "dispatch_task",
        rationale: "Deliberate failing task for non-git bounded repair",
        next_task: {
          task_id: "task-fail-01",
          roadmap_item_id: "rm-fail-01",
          requirement_ids: ["req-fail-01"],
          title: "Deliberate failing task for non-git bounded repair",
          objective: "Trigger verifier failure and ensure attempts are rolled back safely",
          allowed_paths: ["broken-attempt.txt"],
          acceptance_criteria: [
            { id: "ac-1", description: "Verification script exits 0", required: true, verification: "unit_test" },
          ],
          verification_plan_ids: ["node always-fail.js"],
          risk: "low",
          requires_approval: false,
        },
        roadmap_proposals: [],
        open_questions: [],
        stop: false,
        stop_reason: null,
      });

      const loop = new AutonomousLoop(db, nonGitWorkspace, planner, critic, budgetService);

      const result = await loop.runSingleTask({
        projectId: project.id,
        runId: run.id,
        workspacePath: nonGitWorkspace,
        agentAdapter,
        approvedRoadmapIds: ["rm-fail-01"],
        allowDirtyWorkspace: true,
      });

      // Exhausted repair attempts: task marked stalled safely
      expect(result.status).toBe("stalled");
      expect(result.attempts).toBe(3);

      // Verify broken-attempt.txt was rolled back and does not pollute project
      expect(fs.existsSync(path.join(nonGitWorkspace, "broken-attempt.txt"))).toBe(false);

      // Verify pre-existing user file remains intact
      expect(fs.existsSync(path.join(nonGitWorkspace, "user-existing.txt"))).toBe(true);

      const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.taskId) as any;
      expect(taskRow.status).toBe("blocked");
    });
  });
});
