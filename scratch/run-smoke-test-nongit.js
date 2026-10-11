import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { initDb, closeDb } from "../apps/server/dist/storage/db.js";
import { runMigrations } from "../apps/server/dist/storage/migrations.js";
import { ProjectRepository } from "../apps/server/dist/storage/repositories/project-repository.js";
import { RunRepository } from "../apps/server/dist/storage/repositories/run-repository.js";
import { OpenAICompatibleLocalProvider } from "../apps/server/dist/providers/reasoning/openai-compatible/local-provider.js";
import { PlannerService } from "../apps/server/dist/orchestrator/planner.js";
import { CriticService } from "../apps/server/dist/orchestrator/critic.js";
import { ContextBuilder } from "../apps/server/dist/prompts/context-builder.js";
import { BudgetService } from "../apps/server/dist/domain/budgets/budget-service.js";
import { AutonomousLoop } from "../apps/server/dist/orchestrator/loop.js";
import { ReasoningCodingAgentAdapter } from "../apps/server/dist/providers/coding-agents/reasoning/reasoning-coding-adapter.js";
import { GitManager } from "../apps/server/dist/git/git-manager.js";

async function runRealSmokeTest() {
  console.log("=== PHASE 4: MANDATORY REAL CODING SMOKE TEST IN NON-GIT DIRECTORY ===");

  // 1. Create disposable workspace outside git
  const disposableWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "orches-smoke-nongit-"));
  console.log(`[Smoke Test] Created disposable non-Git workspace: ${disposableWorkspace}`);

  // Confirm NO .git directory
  const hasGit = fs.existsSync(path.join(disposableWorkspace, ".git"));
  console.log(`[Smoke Test] Has .git directory: ${hasGit} (Must be false: Local Snapshot Mode)`);
  if (hasGit) {
    throw new Error("Target workspace unexpectedly contains a .git directory!");
  }

  // 2. Initialize storage
  const db = initDb(":memory:");
  runMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const runRepo = new RunRepository(db);

  const objective = "Create a minimal Node.js project with a greeting function, an executable entry point, tests using the built-in node:test framework, and a short README. Ensure the tests run using node --test and do not use external packages unless necessary.";

  const project = projectRepo.create({
    id: `proj-smoke-${Date.now()}`,
    name: "Non-Git Node Minimal Project",
    objective,
    rootPath: disposableWorkspace,
    profileId: "general",
    autonomyMode: "creative_within_constraints",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const run = runRepo.create({
    id: `run-smoke-${Date.now()}`,
    projectId: project.id,
    status: "running",
    currentTaskId: null,
    iterationCount: 0,
    stopReason: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });

  // 3. Connect to live Ollama HTTP server
  console.log(`[Smoke Test] Connecting to live Ollama on http://127.0.0.1:11434 with model llama3.1:8b...`);
  const provider = new OpenAICompatibleLocalProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.1:8b",
    timeoutMs: 120000,
  });

  const health = await provider.healthCheck();
  console.log(`[Smoke Test] Ollama Health: ok=${health.ok}, status=${health.status}, models=${health.discoveredModels?.join(", ")}`);

  const contextBuilder = new ContextBuilder(disposableWorkspace);
  const planner = new PlannerService(provider, contextBuilder);
  const critic = new CriticService(provider, contextBuilder);
  const budgetService = new BudgetService();

  // Instantiate direct ReasoningCodingAgentAdapter
  const agentAdapter = new ReasoningCodingAgentAdapter(provider);

  const loop = new AutonomousLoop(db, disposableWorkspace, planner, critic, budgetService);

  console.log(`[Smoke Test] Executing autonomous task loop in non-Git workspace...`);
  const startTime = Date.now();
  const result = await loop.runSingleTask({
    projectId: project.id,
    runId: run.id,
    workspacePath: disposableWorkspace,
    agentAdapter,
    approvedRoadmapIds: ["ROADMAP-001"],
  });
  const durationMs = Date.now() - startTime;

  console.log(`[Smoke Test] Loop execution finished in ${(durationMs / 1000).toFixed(1)}s: status=${result.status}, task=${result.taskId}`);

  const attempts = db.prepare("SELECT * FROM task_attempts").all();
  console.log("[Smoke Test] Task Attempts:", JSON.stringify(attempts, null, 2));
  const verifs = db.prepare("SELECT * FROM verification_runs").all();
  console.log("[Smoke Test] Verification Runs:", JSON.stringify(verifs, null, 2));
  const critics = db.prepare("SELECT * FROM critic_reviews").all();
  console.log("[Smoke Test] Critic Reviews:", JSON.stringify(critics, null, 2));
  const events = db.prepare("SELECT * FROM run_events").all();
  console.log("[Smoke Test] Events count:", events.length);
  const rejections = db.prepare("SELECT payload_json FROM run_events WHERE type = 'task.attempt_rejected'").all();
  console.log("[Smoke Test] Attempt Rejections:", JSON.stringify(rejections.map(r => JSON.parse(r.payload_json)), null, 2));

  // 4. Inspect generated files in the disposable workspace
  const allWorkspaceFiles = [];
  const scan = (dir, base = "") => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = path.join(base, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== ".orchestrator") scan(path.join(dir, ent.name), rel);
      } else {
        allWorkspaceFiles.push(rel.replace(/\\/g, "/"));
      }
    }
  };
  scan(disposableWorkspace);

  console.log(`[Smoke Test] Files created outside .orchestrator:`, allWorkspaceFiles);

  // 5. Run node --test in the target workspace
  let testExitCode = -1;
  let testOutput = "";
  try {
    testOutput = execSync("node --test", { cwd: disposableWorkspace, encoding: "utf8" });
    testExitCode = 0;
    console.log(`[Smoke Test] node --test passed successfully (exit 0)`);
  } catch (err) {
    testExitCode = err.status ?? 1;
    testOutput = (err.stdout || "") + "\n" + (err.stderr || "");
    console.log(`[Smoke Test] node --test exited with code ${testExitCode}`);
  }

  // 6. Inspect snapshot manager
  const gitManager = new GitManager(disposableWorkspace);
  const snapshotManager = gitManager.getSnapshotManager();
  const snapshots = snapshotManager.listSnapshots();
  console.log(`[Smoke Test] Snapshot checkpoints created: ${snapshots.length}`);

  // 7. Assemble diagnostic evidence
  const evidence = {
    testTimestamp: new Date().toISOString(),
    disposableWorkspace,
    isGitRepo: hasGit,
    provider: {
      id: provider.id,
      model: "llama3.1:8b",
      health,
    },
    loopResult: result,
    durationMs,
    filesCreatedOutsideOrchestrator: allWorkspaceFiles,
    nodeTestVerification: {
      exitCode: testExitCode,
      outputSnippet: testOutput.slice(0, 500),
    },
    snapshotCount: snapshots.length,
    latestSnapshot: snapshots[snapshots.length - 1] || null,
  };

  const artifactsDir = path.resolve("artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const evidencePath = path.join(artifactsDir, "smoke-test-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`[Smoke Test] Evidence saved to ${evidencePath}`);

  // 8. Assertions
  if (allWorkspaceFiles.length === 0) {
    throw new Error("FAILED: Zero files created outside .orchestrator!");
  }
  if (result.status !== "succeeded") {
    throw new Error(`FAILED: Task did not succeed. Status: ${result.status}, error: ${result.error}`);
  }

  console.log("=== PHASE 4: MANDATORY REAL CODING SMOKE TEST PASSED SUCCESSFULLY ===");
  closeDb();
}

runRealSmokeTest().catch((err) => {
  console.error("SMOKE TEST ERROR:", err);
  process.exit(1);
});
