import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { Task, TaskSchema, Run } from "@orchestrator/shared-types";
import { GitManager } from "../git/git-manager.js";
import { ContextBuilder } from "../prompts/context-builder.js";
import { PlannerService } from "./planner.js";
import { CriticService } from "./critic.js";
import { AcceptanceGate } from "./acceptance-gate.js";
import { VerificationRunner } from "../verification/runner.js";
import { BrowserVerifier } from "../verification/browser-verifier.js";
import { CodingAgentAdapter } from "../providers/coding-agents/adapter.js";
import { BudgetService } from "../domain/budgets/budget-service.js";
import { EventStore } from "../events/event-store.js";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { RunStateMachine } from "./state-machine.js";

export interface LoopExecutionOptions {
  projectId: string;
  runId: string;
  workspacePath: string;
  agentAdapter: CodingAgentAdapter;
  approvedRoadmapIds: string[];
  isUiTask?: boolean;
  uiTestUrl?: string;
}

export interface LoopIterationResult {
  taskId: string;
  status: "succeeded" | "stalled" | "failed" | "budget_exhausted" | "stopped";
  attempts: number;
  acceptedCommit?: string;
  error?: string;
}

export class AutonomousLoop {
  private gitManager: GitManager;
  private contextBuilder: ContextBuilder;
  private verificationRunner: VerificationRunner;
  private browserVerifier: BrowserVerifier;
  private acceptanceGate: AcceptanceGate;
  private eventStore: EventStore;
  private runRepo: RunRepository;
  private stateMachine: RunStateMachine;

  constructor(
    private db: DatabaseSync,
    private workspacePath: string,
    private planner: PlannerService,
    private critic: CriticService,
    private budgetService: BudgetService
  ) {
    this.gitManager = new GitManager(workspacePath);
    this.contextBuilder = new ContextBuilder(workspacePath);
    this.verificationRunner = new VerificationRunner(workspacePath);
    this.browserVerifier = new BrowserVerifier();
    this.acceptanceGate = new AcceptanceGate();
    this.eventStore = new EventStore(db);
    this.runRepo = new RunRepository(db);
    this.stateMachine = new RunStateMachine(this.runRepo, this.eventStore);
  }

  public async runSingleTask(options: LoopExecutionOptions): Promise<LoopIterationResult> {
    const { projectId, runId, agentAdapter, approvedRoadmapIds } = options;

    // 1. Check run state
    const run = this.runRepo.findById(runId);
    if (!run || run.status === "stopped" || run.status === "paused") {
      return { taskId: "none", status: "stopped", attempts: 0 };
    }

    // 2. Pre-dispatch budget check
    try {
      this.budgetService.reserveAndCheckPreflight("llama3.1:8b", 4000);
    } catch (err: unknown) {
      this.stateMachine.transition(runId, "budget_exhausted", (err as Error).message);
      this.eventStore.record(projectId, "budget.exhausted", { error: (err as Error).message }, runId);
      return { taskId: "none", status: "budget_exhausted", attempts: 0, error: (err as Error).message };
    }

    // 3. Planner plans next task linked to approved roadmap
    const planOutput = await this.planner.planNextTask(
      projectId,
      "Core feature implementation",
      "Per-task ceiling: $2.00, Run ceiling: $10.00",
      approvedRoadmapIds
    );

    if (planOutput.decision !== "dispatch_task" || !planOutput.next_task) {
      this.stateMachine.transition(runId, "completed", planOutput.rationale);
      return { taskId: "none", status: "succeeded", attempts: 0 };
    }

    const planned = planOutput.next_task;
    const now = new Date().toISOString();

    const task: Task = TaskSchema.parse({
      id: planned.task_id,
      projectId,
      runId,
      title: planned.title,
      objective: planned.objective,
      roadmapItemId: planned.roadmap_item_id,
      requirementIds: planned.requirement_ids,
      status: "running",
      priority: "high",
      risk: planned.risk,
      allowedPaths: planned.allowed_paths,
      forbiddenPaths: [".env*", ".orchestrator/**", "**/*.pem"],
      acceptanceCriteria: planned.acceptance_criteria.map((c) => ({
        ...c,
        status: "pending",
      })),
      verificationPlan: planned.verification_plan_ids.length > 0 ? planned.verification_plan_ids : ["npm test"],
      attemptCount: 0,
      currentAttemptId: null,
      maxAttempts: 3, // 1 initial + 2 repairs
      requiresApproval: planned.requires_approval,
      createdAt: now,
      updatedAt: now,
    });

    // Persist task in SQLite
    this.db
      .prepare(`
        INSERT INTO tasks (id, project_id, run_id, title, objective, roadmap_item_id, status, priority, risk, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(task.id, task.projectId, task.runId, task.title, task.objective, task.roadmapItemId, task.status, task.priority, task.risk, task.createdAt, task.updatedAt);

    this.eventStore.record(projectId, "task.created", { taskId: task.id, title: task.title }, runId, task.id);

    // 4. Git preflight baseline
    const gitStatus = await this.gitManager.getStatus();
    const baselineCommit = gitStatus.baselineCommit || "HEAD";

    // 5. Execution & Repair Loop
    let attemptNumber = 0;
    let priorFailureEvidence: string | undefined = undefined;

    while (attemptNumber < task.maxAttempts) {
      attemptNumber++;
      task.attemptCount = attemptNumber;
      task.currentAttemptId = `att-${task.id}-${attemptNumber}`;

      // Check for user stop/pause between attempts
      const currentRun = this.runRepo.findById(runId);
      if (currentRun?.status === "stopped" || currentRun?.status === "paused") {
        return { taskId: task.id, status: "stopped", attempts: attemptNumber };
      }

      this.eventStore.record(projectId, "task.attempt_started", {
        taskId: task.id,
        attemptNumber,
        attemptId: task.currentAttemptId,
      }, runId, task.id);

      // Create isolated attempt branch if git available
      let attemptBranch: string | null = null;
      if (gitStatus.isGitRepo) {
        attemptBranch = await this.gitManager.createAttemptBranch(projectId, task.id, attemptNumber);
      }

      // Build fresh context packet for executor
      const executorContext = this.contextBuilder.buildExecutorContext(task, attemptNumber, priorFailureEvidence);

      // Dispatch to coding agent adapter
      const agentReport = await agentAdapter.executeTask(
        task,
        this.workspacePath,
        executorContext,
        undefined,
        (logChunk) => {
          this.eventStore.record(projectId, "agent.stdout", { log: logChunk }, runId, task.id);
        }
      );

      // Handle agent permission denial
      if (agentReport.status === "awaiting_permission") {
        this.db.prepare("UPDATE tasks SET status = 'awaiting_agent_permission' WHERE id = ?").run(task.id);
        this.eventStore.record(projectId, "approval.required", { taskId: task.id, blockers: agentReport.blockers }, runId, task.id);
        return { taskId: task.id, status: "stalled", attempts: attemptNumber, error: "Awaiting agent permission" };
      }

      // 6. Independent Orchestrator Verification
      const diffSummary = await this.gitManager.getDiffSummary();
      const checkCommands = task.verificationPlan.map((cmd) => ({
        type: cmd.includes("lint") ? ("lint" as const) : ("test" as const),
        command: cmd,
      }));

      const verificationResults = await this.verificationRunner.runAll(task.id, task.currentAttemptId, checkCommands);

      // Optional Browser Verification for UI tasks
      if (options.isUiTask && options.uiTestUrl) {
        const browserEvidence = await this.browserVerifier.verifyUi({
          url: options.uiTestUrl,
          taskId: task.id,
          attemptId: task.currentAttemptId,
        });

        for (const bve of browserEvidence) {
          verificationResults.push({
            id: bve.id,
            taskId: task.id,
            attemptId: task.currentAttemptId,
            checkType: "browser_ui",
            command: `playwright-assert ${bve.url}`,
            argv: ["playwright", "assert", bve.url],
            cwd: this.workspacePath,
            status: bve.passed ? "passed" : "failed",
            exitCode: bve.passed ? 0 : 1,
            durationMs: bve.durationMs,
            outputArtifactId: bve.screenshotArtifactId,
            stdoutSnippet: `Passed assertions: ${bve.assertionsPassed}`,
            stderrSnippet: bve.consoleErrors.join("; "),
            truncated: false,
            timestamp: bve.timestamp,
          });
        }
      }

      // 7. Independent Critic Review
      const criticReview = await this.critic.reviewAttempt(task, diffSummary.diff, verificationResults, agentReport);

      // 8. Deterministic Acceptance Gate
      const gateDecision = this.acceptanceGate.evaluate(
        task,
        diffSummary.filesChanged,
        verificationResults,
        criticReview
      );

      if (gateDecision.accepted) {
        // Task Accepted: Commit checkpoint
        let acceptedCommit = baselineCommit;
        if (gitStatus.isGitRepo) {
          acceptedCommit = await this.gitManager.commitCheckpoint(task.id, task.title);
        }

        this.db.prepare("UPDATE tasks SET status = 'succeeded', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
        this.runRepo.incrementIteration(runId);

        this.eventStore.record(projectId, "task.completed", {
          taskId: task.id,
          commitSha: acceptedCommit,
          attempts: attemptNumber,
        }, runId, task.id);

        return {
          taskId: task.id,
          status: "succeeded",
          attempts: attemptNumber,
          acceptedCommit,
        };
      }

      // Gate Failed: Prepare for repair or stall
      priorFailureEvidence = gateDecision.blockers.join("\n");
      this.eventStore.record(projectId, "task.attempt_rejected", {
        taskId: task.id,
        attemptNumber,
        blockers: gateDecision.blockers,
        repairInstructions: criticReview.repair_instructions,
      }, runId, task.id);

      // Rollback isolated attempt branch
      if (gitStatus.isGitRepo && baselineCommit) {
        await this.gitManager.rollbackAttempt(baselineCommit);
      }
    }

    // Exhausted repair attempts: mark stalled
    this.db.prepare("UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
    this.eventStore.record(projectId, "task.stalled", {
      taskId: task.id,
      attempts: attemptNumber,
      reason: "Maximum repair attempts reached without satisfying verifier acceptance gates.",
    }, runId, task.id);

    return {
      taskId: task.id,
      status: "stalled",
      attempts: attemptNumber,
      error: "Exhausted repair attempts.",
    };
  }
}
