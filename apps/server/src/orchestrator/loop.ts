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
import { InboxService } from "../domain/human-messages/inbox-service.js";
import { IdeBridge } from "../platform/ide/ide-bridge.js";

export interface LoopExecutionOptions {
  projectId: string;
  runId: string;
  workspacePath: string;
  agentAdapter: CodingAgentAdapter;
  approvedRoadmapIds: string[];
  isUiTask?: boolean;
  uiTestUrl?: string;
  ideBridge?: IdeBridge;
  allowDirtyWorkspace?: boolean;
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
  private inboxService: InboxService;

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
    this.inboxService = new InboxService(db, this.eventStore);
  }

  public async runSingleTask(options: LoopExecutionOptions): Promise<LoopIterationResult> {
    const { projectId, runId, agentAdapter, approvedRoadmapIds } = options;

    // 1. Check run state
    const run = this.runRepo.findById(runId);
    if (!run || run.status === "stopped" || run.status === "paused") {
      return { taskId: "none", status: "stopped", attempts: 0 };
    }

    // 2. Check for pending human messages & safe interrupt
    const pendingMsgs = this.inboxService.getPendingMessages(projectId);
    const safeInterrupt = pendingMsgs.find((m) => m.kind === "safe_interrupt");
    if (safeInterrupt) {
      this.inboxService.consumePendingMessages(projectId);
      this.stateMachine.transition(runId, "stopped", `Safe interrupt requested: ${safeInterrupt.content}`);
      this.eventStore.record(projectId, "run.interrupted", { message: safeInterrupt.content }, runId);
      return { taskId: "none", status: "stopped", attempts: 0, error: `Safe interrupt: ${safeInterrupt.content}` };
    }

    const humanDirections = pendingMsgs.map((m) => `[${m.kind.toUpperCase()}] ${m.content}`);
    if (pendingMsgs.length > 0) {
      this.inboxService.consumePendingMessages(projectId);
    }

    // 3. Pre-dispatch budget check
    try {
      this.budgetService.reserveAndCheckPreflight("llama3.1:8b", 4000);
    } catch (err: unknown) {
      this.stateMachine.transition(runId, "budget_exhausted", (err as Error).message);
      this.eventStore.record(projectId, "budget.exhausted", { error: (err as Error).message }, runId);
      return { taskId: "none", status: "budget_exhausted", attempts: 0, error: (err as Error).message };
    }

    // 4. Planner plans next task linked to approved roadmap
    const planOutput = await this.planner.planNextTask(
      projectId,
      "Core feature implementation",
      "Per-task ceiling: $2.00, Run ceiling: $10.00",
      approvedRoadmapIds,
      humanDirections.length > 0 ? humanDirections : undefined
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

    // 5. Git preflight baseline & safety guard
    const gitStatus = await this.gitManager.getStatus();
    const baselineCommit = gitStatus.baselineCommit || "HEAD";

    if (gitStatus.isDirty && !options.allowDirtyWorkspace) {
      this.stateMachine.transition(
        runId,
        "paused",
        `Uncommitted changes detected in ${gitStatus.modifiedFiles.length} file(s). Safe execution paused.`
      );
      this.eventStore.record(
        projectId,
        "run.dirty_workspace",
        {
          message: "Uncommitted user changes detected. Pausing to avoid overwriting unrelated work.",
          modifiedFiles: gitStatus.modifiedFiles,
        },
        runId
      );
      return {
        taskId: task.id,
        status: "stopped",
        attempts: 0,
        error: `Dirty workspace: ${gitStatus.modifiedFiles.length} uncommitted file(s) found. Paused for safe operator resolution.`,
      };
    }

    // Visible IDE connection check
    if (agentAdapter.id === "antigravity-visible" && options.ideBridge) {
      let ideState = options.ideBridge.getState();
      if (ideState.status !== "ready") {
        if (ideState.stages?.ready?.status === "passed") {
          ideState = { ...ideState, status: "ready" };
        } else {
          // Attempt automatic connection handshake
          const connectRes = await options.ideBridge.connect(options.workspacePath);
          if (connectRes.status === "ready") {
            ideState = connectRes;
          }
        }
      }

      if (ideState.status !== "ready") {
        this.stateMachine.transition(runId, "blocked", `Visible Antigravity IDE is not ready (Status: ${ideState.status}).`);
        this.eventStore.record(
          projectId,
          "ide.not_ready",
          {
            status: ideState.status,
            stages: ideState.stages,
            errorMessage: ideState.errorMessage,
          },
          runId
        );
        return {
          taskId: task.id,
          status: "failed",
          attempts: 0,
          error: `Visible Antigravity IDE connection is not ready (Status: ${ideState.status}). Complete connection verification handshake first.`,
        };
      }
    }

    // 6. Execution & Repair Loop
    let attemptNumber = 0;
    let priorFailureEvidence: string | undefined = undefined;

    while (attemptNumber < task.maxAttempts) {
      attemptNumber++;
      task.attemptCount = attemptNumber;
      task.currentAttemptId = `att-${task.id}-${attemptNumber}`;

      // Check for user stop/pause or safe interrupt between attempts
      const currentRun = this.runRepo.findById(runId);
      if (currentRun?.status === "stopped" || currentRun?.status === "paused") {
        return { taskId: task.id, status: "stopped", attempts: attemptNumber };
      }

      const attemptPending = this.inboxService.getPendingMessages(projectId);
      const attemptInterrupt = attemptPending.find((m) => m.kind === "safe_interrupt");
      if (attemptInterrupt) {
        this.inboxService.consumePendingMessages(projectId);
        this.stateMachine.transition(runId, "stopped", `Safe interrupt requested: ${attemptInterrupt.content}`);
        return { taskId: task.id, status: "stopped", attempts: attemptNumber, error: `Safe interrupt: ${attemptInterrupt.content}` };
      }

      const attemptDirections = [
        ...humanDirections,
        ...attemptPending.map((m) => `[${m.kind.toUpperCase()}] ${m.content}`),
      ];
      if (attemptPending.length > 0) {
        this.inboxService.consumePendingMessages(projectId);
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

      // Persist attempt start
      this.db.prepare(`
        INSERT INTO task_attempts (id, task_id, attempt_number, adapter_id, provider_id, model_id, base_commit, task_branch, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
      `).run(
        task.currentAttemptId,
        task.id,
        attemptNumber,
        agentAdapter.id,
        "reasoning-engine",
        "default-model",
        baselineCommit,
        attemptBranch,
        new Date().toISOString()
      );

      // Build fresh context packet for executor
      const executorContext = this.contextBuilder.buildExecutorContext(
        task,
        attemptNumber,
        priorFailureEvidence,
        attemptDirections.length > 0 ? attemptDirections : undefined
      );

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
        this.db.prepare("UPDATE task_attempts SET status = 'awaiting_permission', ended_at = ? WHERE id = ?").run(new Date().toISOString(), task.currentAttemptId);
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

      // Persist verification runs
      const insertVerif = this.db.prepare(`
        INSERT INTO verification_runs (id, task_id, attempt_id, check_type, command, argv_json, cwd, status, exit_code, duration_ms, output_artifact_id, stdout_snippet, stderr_snippet, truncated, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const vr of verificationResults) {
        insertVerif.run(
          vr.id,
          vr.taskId,
          vr.attemptId,
          vr.checkType,
          vr.command,
          JSON.stringify(vr.argv),
          vr.cwd,
          vr.status,
          vr.exitCode ?? null,
          vr.durationMs,
          vr.outputArtifactId ?? null,
          vr.stdoutSnippet,
          vr.stderrSnippet,
          vr.truncated ? 1 : 0,
          vr.timestamp
        );
      }

      // 7. Independent Critic Review
      const criticReview = await this.critic.reviewAttempt(task, diffSummary.diff, verificationResults, agentReport);

      // Persist critic review
      this.db.prepare(`
        INSERT INTO critic_reviews (id, task_id, attempt_id, verdict, per_criterion_json, findings_json, repair_instructions_json, rationale, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `crit-${crypto.randomUUID()}`,
        task.id,
        task.currentAttemptId,
        criticReview.verdict,
        JSON.stringify(criticReview.criteria),
        JSON.stringify(criticReview.quality_findings),
        JSON.stringify(criticReview.repair_instructions),
        criticReview.rationale,
        new Date().toISOString()
      );

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
        this.db.prepare("UPDATE task_attempts SET status = 'succeeded', ended_at = ?, process_exit_code = 0 WHERE id = ?").run(new Date().toISOString(), task.currentAttemptId);
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
      this.db.prepare("UPDATE task_attempts SET status = 'failed', ended_at = ?, process_exit_code = 1 WHERE id = ?").run(new Date().toISOString(), task.currentAttemptId);
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
