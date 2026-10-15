import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Project, Run } from "@orchestrator/shared-types";
import { EventStore } from "../events/event-store.js";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { RunStateMachine } from "./state-machine.js";
import { InboxService } from "../domain/human-messages/inbox-service.js";
import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { CodingAgentAdapter } from "../providers/coding-agents/adapter.js";
import { GitManager, GitStatusResult } from "../git/git-manager.js";
import { SnapshotStore, WorkspaceSnapshot } from "../workspace/snapshot-store.js";
import { inspectProject, ProjectProfile } from "../workspace/project-inspector.js";
import { runChecks, validateChangedFiles, CheckResult } from "../verification/runner.js";
import { planTask } from "./planner.js";
import { reviewAttempt, CriticOutcome } from "./critic.js";
import { evaluateAttempt, GateDecision } from "./acceptance-gate.js";
import { composeInstruction, synthesizeSubstantiveBrief, synthesizeRepairBrief, synthesizeSystemAuditBrief, IterationEvidence } from "./instructor.js";
import { validateInstructionSubstance, isThoughtOrStatusFragment, isTaskDescriptor } from "../prompts/instruction-validator.js";
import { projectFileList } from "../workspace/project-inspector.js";
import { missingRequestedFiles } from "../workspace/requested-files.js";
import { calculateDiffCharBudget } from "./evidence-formatter.js";
import { ReasoningUsageLedger } from "../domain/budgets/usage-ledger.js";
import { SettingsManager } from "../platform/settings-manager.js";
import { BlueprintRepository } from "../storage/repositories/blueprint-repository.js";
import { buildAuthoritativeTaskContext, updateAuthoritativeTaskContext, type AuthoritativeTaskContext } from "./task-context.js";
import { getProjectProfile } from "../domain/profiles/project-profiles.js";
import { updateRequirementStatuses } from "../domain/requirements/requirement-inventory.js";
import { analyzeRequirements } from "./requirements-analyst.js";
import { buildAgentReference } from "./instruction-prompt.js";
import { ConversationMemoryService } from "../domain/memory/conversation-memory-service.js";
import { SecretRedactor } from "../platform/secret-redactor.js";

export const CLOUD_RUN_COST_CEILING_USD = 2.0;

export function snapshotStoreFor(rootPath: string): SnapshotStore {
  const key = crypto.createHash("sha256").update(path.resolve(rootPath).toLowerCase()).digest("hex").slice(0, 16);
  return new SnapshotStore(rootPath, path.join(SettingsManager.getDataDir(), "workspaces", key));
}

export interface PipelineContext {
  db: DatabaseSync;
  events: EventStore;
  runs: RunRepository;
  stateMachine: RunStateMachine;
  project: Project;
  run: Run;
  taskText: string;
  provider: ReasoningProvider;
  agent: CodingAgentAdapter;
  maxAttempts: number;
  signal: AbortSignal;
}

class RunCancelled extends Error {}

/**
 * Orches never ends a run because of an infrastructure problem (ChatGPT outage, login wait, coding
 * agent quota or error). It waits and retries; only the reasoning model's own decision (ACCEPT after
 * the audit, or an explicit STOP/refusal), the user's Stop button, or the configured iteration limit
 * end a run.
 */
function sleepUnlessCancelled(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunCancelled("Stopped by user."));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RunCancelled("Stopped by user."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 30 s, 1 min, 2 min … capped at 15 min. */
function retryBackoffMs(retry: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, retry - 1));
}

/** Wait suggested by a quota error ("Resets in 4h35m1s" / retryDelay "625.8s"), bounded to 1–60 minutes. */
export function quotaWaitMs(message: string | undefined): number {
  const text = message || "";
  let ms = 0;
  const resets = text.match(/Resets in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
  if (resets && (resets[1] || resets[2] || resets[3])) {
    ms = ((Number(resets[1] || 0) * 60 + Number(resets[2] || 0)) * 60 + Number(resets[3] || 0)) * 1000;
  } else {
    const delay = text.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
    if (delay) ms = Number(delay[1]) * 1000;
  }
  if (!ms) ms = 5 * 60_000;
  return Math.min(60 * 60_000, Math.max(60_000, ms + 15_000));
}

function formatWait(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 1 ? `${m} minute(s)` : `${Math.round(ms / 1000)} second(s)`;
}

export async function executeRun(ctx: PipelineContext): Promise<void> {
  const { db, events, runs, project, run, provider, agent, signal } = ctx;
  const root = project.rootPath;
  const inbox = new InboxService(db, events);
  const store = snapshotStoreFor(root);
  const memoryService = new ConversationMemoryService(db);
  const conversation = memoryService.getOrCreateConversation({
    conversationId: run.conversationId,
    projectId: project.id,
    initialInstruction: ctx.taskText,
    runId: run.id,
  });
  if (run.conversationId !== conversation.id) {
    runs.updateFields(run.id, { conversationId: conversation.id });
    run.conversationId = conversation.id;
  }
  const recentMsgs = memoryService.getRepository().getRecentMessages(conversation.id, 5);
  const lastMsg = recentMsgs[recentMsgs.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== SecretRedactor.redactString(ctx.taskText)) {
    memoryService.recordUserMessage(conversation.id, ctx.taskText, { runId: run.id });
  }

  let taskId: string | null = null;
  let activeSnapshot: WorkspaceSnapshot | null = null;
  /** Snapshot taken when the run started; kept for diffs and manual restore, never auto-applied. */
  let runStartSnapshot: WorkspaceSnapshot | null = null;
  let activeAttemptId: string | null = null;
  const warnings: string[] = [];

  const log = (message: string, level: "info" | "warn" | "error" = "info") =>
    events.record(project.id, "run.log", { message, level }, run.id, taskId);
  const phase = (name: string, attempt?: number) => events.record(project.id, "run.phase", { phase: name, attempt: attempt ?? null }, run.id, taskId);
  const ensureNotCancelled = () => {
    if (signal.aborted) throw new RunCancelled("Stopped by user.");
  };

  const finish = (status: "completed" | "completed_with_warnings" | "failed" | "stopped" | "budget_exhausted" | "blocked" | "paused", outcome: string, summary: string, extra: Record<string, unknown> = {}) => {
    const current = runs.findById(run.id);
    if (current && current.status !== "running") {
      // Already finalized elsewhere (e.g. crash recovery); keep that record instead of overwriting it.
      events.record(project.id, "run.log", { message: `Run was already ${current.status}; late result ignored: ${summary}`, level: "warn" }, run.id, taskId);
      return;
    }
    runs.updateFields(run.id, { outcome, summary });
    runs.setDetails(run.id, { ...runs.getDetails(run.id), warnings, usage: ReasoningUsageLedger.getShared().getRunUsage(run.id), ...extra });
    ctx.stateMachine.transition(run.id, status, summary);
    if (taskId) {
      const taskStatus = outcome === "verified" || outcome === "unverified" ? "succeeded" : outcome === "cancelled" || outcome === "declined" ? "canceled" : "failed";
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(taskStatus, new Date().toISOString(), taskId);
    }
    events.record(project.id, "run.finished", { status, outcome, summary }, run.id, taskId);
    memoryService.maybeCompact(conversation.id, provider, { force: false, signal }).catch((err) => {
      console.error(`[run ${run.id}] post-run memory compaction failed: ${(err as Error).message}`);
    });
  };

  /** History placeholder so the next instruction knows this iteration dispatched nothing. */
  const skippedIterations: Array<{ iteration: number; reason: string }> = [];
  const skipIteration = (iteration: number, attemptId: string, reason: string) => {
    log(reason, "warn");
    db.prepare("UPDATE task_attempts SET status = 'failed', ended_at = ?, agent_error = ? WHERE id = ?").run(new Date().toISOString(), reason, attemptId);
    events.record(project.id, "attempt.skipped", { attempt: iteration, reason }, run.id, taskId);
    skippedIterations.push({ iteration, reason });
  };

  /**
   * Orches never rolls the workspace back automatically: every file the agent created or changed is
   * kept, and the run-start snapshot stays on disk so the user can inspect or restore it by hand.
   * This only measures what is being preserved so the outcome can be reported truthfully.
   */
  const describePreserved = (reason: string): { changed: number; note: string } => {
    let changed = 0;
    if (runStartSnapshot) {
      try {
        changed = store.diff(runStartSnapshot).changes.length;
      } catch (err) {
        console.error(`[run ${run.id}] could not measure preserved changes: ${(err as Error).message}`);
      }
    }
    events.record(project.id, "run.changes_preserved", { reason, filesChanged: changed, snapshotId: runStartSnapshot?.id ?? null }, run.id, taskId);
    const note = changed
      ? `All ${changed} changed file(s) were preserved in the workspace (no rollback). Run-start snapshot: ${runStartSnapshot?.id}.`
      : "No files had been changed.";
    return { changed, note };
  };

  try {
    // 1. Preconditions: the workspace must exist and the provider must answer.
    phase("preparing");
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      finish("failed", "error", `Workspace folder not found: ${root}`);
      return;
    }
    {
      // The reasoning provider plans, instructs/writes code, and reviews in every mode.
      let health = await provider.healthCheck();
      for (let retry = 1; !health.ok; retry++) {
        const wait = retryBackoffMs(retry);
        log(`Reasoning provider is not ready (${health.message}). Waiting ${formatWait(wait)} and checking again (sign in to ChatGPT in the browser window if asked). Press Stop to end the run.`, "warn");
        await sleepUnlessCancelled(wait, signal);
        health = await provider.healthCheck();
      }
      log(`Reasoning provider: ${provider.displayName}, model ${provider.getModel()}. ${health.message ?? ""}`);
    }
    log(`Coding mechanism: ${agent.displayName} — ${agent.description}`);

    const blueprintRepo = new BlueprintRepository(db);
    const blueprints = blueprintRepo.listBlueprints(project.id);
    const requirements = blueprintRepo.listRequirements(project.id);
    const profileDef = getProjectProfile(project.profileId);
    const autonomyMode = project.autonomyMode || "creative_within_constraints";
    log(`Profile: ${profileDef.name} · Mode: ${autonomyMode}${blueprints.length ? ` · Master blueprints: ${blueprints.length} (${requirements.length} requirement(s))` : ""}`);

    const git = new GitManager(root);
    const gitStart: GitStatusResult = await git.getStatus();
    runs.updateFields(run.id, { safetyMode: gitStart.safetyMode });
    if (gitStart.isGitRepo) {
      log(`Git repository on branch '${gitStart.activeBranch ?? "(detached)"}'. The orchestrator will not switch branches.`);
      if (gitStart.isDirty) {
        warnings.push(`The workspace had ${gitStart.dirtyFiles.length} uncommitted change(s) before the run; they were preserved and accepted changes were not auto-committed.`);
        log(warnings[warnings.length - 1], "warn");
      }
    } else {
      log("Not a Git repository: changes are tracked with orchestrator snapshots stored outside the workspace.");
    }

    // 2. Understand the project and record the baseline state of its checks.
    const baselineProfile: ProjectProfile = await inspectProject(root, project.verificationCommands);
    for (const note of baselineProfile.notes) {
      warnings.push(note);
      log(note, "warn");
    }
    log(
      baselineProfile.checks.length
        ? `Detected checks: ${baselineProfile.checks.map((c) => `${c.label} (${c.source})`).join("; ")}.`
        : `No automated checks detected (${baselineProfile.isEmpty ? "empty folder" : baselineProfile.languages.join(", ") || "unknown project type"}).`
    );
    let baselineChecks: CheckResult[] = [];
    if (baselineProfile.checks.length) {
      phase("baseline");
      baselineChecks = await runChecks(root, baselineProfile.checks, { signal, onLog: (l) => log(l) });
      ensureNotCancelled();
    }

    // 3. Plan.
    phase("planning");
    let plan;
    try {
      plan = await planTask(provider, {
        projectId: project.id,
        runId: run.id,
        taskText: ctx.taskText,
        projectObjective: project.objective,
        workspacePath: root,
        profile: baselineProfile,
        profileDefinition: profileDef,
        autonomyMode,
        blueprintRequirements: requirements,
        signal,
      });
    } catch (err) {
      ensureNotCancelled();
      const diag = diagnoseProviderError((err as Error).message, provider);
      finish("failed", "error", `Planning failed: ${diag}`);
      return;
    }
    if (plan.warning) {
      warnings.push(plan.warning);
      log(plan.warning, "warn");
    }

    // Requirement register: the reasoning model's analysis of everything the user provided, checked
    // against Orches' scan of the sources (or the scan alone when the analysis is unavailable).
    const analysis = await analyzeRequirements(provider, {
      db,
      projectId: project.id,
      runId: run.id,
      taskText: ctx.taskText,
      projectObjective: project.objective,
      blueprints,
      candidateRequirements: requirements,
      profile: baselineProfile,
      signal,
    });
    ensureNotCancelled();
    const inventory = analysis.inventory;
    log(analysis.note);
    for (const w of inventory.summary.warnings ?? []) log(w, "warn");
    events.record(project.id, "requirements.inventoried", {
      origin: inventory.origin,
      goal: inventory.goal ?? null,
      summary: inventory.summary,
      requirements: inventory.requirements.map((r) => ({
        id: r.id,
        classification: r.classification,
        title: r.title,
        importance: r.importance,
        scopeStatus: r.scopeStatus,
        covers: r.covers,
        sourceReference: r.sourceReference,
      })),
    }, run.id, taskId);
    runs.updateFields(run.id, { title: plan.title });
    taskId = `task-${crypto.randomUUID()}`;
    let taskContext = buildAuthoritativeTaskContext({
      projectId: project.id,
      runId: run.id,
      taskId,
      taskText: ctx.taskText,
      projectObjective: project.objective,
      inventory,
      maxIterations: ctx.maxAttempts,
    });

    const activeCriteriaStrings = taskContext.activeAcceptanceCriteria.map((c) => c.description);
    plan.acceptanceCriteria = taskContext.activeAcceptanceCriteria.map((c) => `${c.id} ${c.description}`);
    const registerConstraints = inventory.requirements
      .filter((r) => r.classification === "explicit_constraint" && (!r.scopeStatus || r.scopeStatus === "in_scope"))
      .map((r) => ({ id: r.id, text: r.description }));
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tasks (id, project_id, run_id, title, objective, roadmap_item_id, status, priority, risk,
                         acceptance_criteria_json, verification_plan_json, max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'user-task', 'running', 'medium', 'medium', ?, ?, ?, ?, ?)
    `).run(
      taskId,
      project.id,
      run.id,
      plan.title,
      ctx.taskText,
      JSON.stringify(activeCriteriaStrings),
      JSON.stringify(baselineProfile.checks.map((c) => c.label)),
      ctx.maxAttempts,
      now,
      now
    );
    runs.updateFields(run.id, { currentTaskId: taskId });
    events.record(project.id, "task.planned", { taskId, title: plan.title, criteria: activeCriteriaStrings, filesToRead: plan.filesToRead, source: plan.source }, run.id, taskId);

    // 4. Attempts. Every attempt is judged on the cumulative change since the run started, so a
    // repair attempt edits the previous attempt's files instead of starting over. The workspace is
    // never rolled back automatically; the run-start snapshot is kept for diffs and manual restore.
    activeSnapshot = store.take(`${run.id}-start`);
    runStartSnapshot = activeSnapshot;
    let previousFailure: string | undefined;
    const history: IterationEvidence[] = [];
    const external = !agent.usesReasoningProvider;
    let lastStaticResults: CheckResult[] = [];
    let lastAttemptChecks: CheckResult[] = [];

    // Continuous Quality Loop & Mandatory Post-Acceptance Audit State:
    // When initial requirements receive an ACCEPT verdict, the run does NOT terminate.
    // Instead it transitions into post-acceptance audit (and remediation if defects remain).
    // The user's configured ctx.maxAttempts is strictly preserved and counts both stages.
    let stage: "implementation" | "audit" | "audit_remediation" = "implementation";
    let auditConducted = false;
    let latestAuditReport: string | undefined;
    /** Scope the reasoning model proposed itself after declining part of the request (see composeInstruction). */
    let adoptedScope: string | undefined;
    for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
      ensureNotCancelled();
      if (provider.privacyClass === "cloud" && provider.id !== "chatgpt-web") {
        const usage = ReasoningUsageLedger.getShared().getRunUsage(run.id);
        if (usage.costUsd >= CLOUD_RUN_COST_CEILING_USD) {
          const kept = describePreserved("budget");
          finish("budget_exhausted", "error", `Stopped before attempt ${attempt}: cloud spend for this run reached $${usage.costUsd.toFixed(2)} (ceiling $${CLOUD_RUN_COST_CEILING_USD.toFixed(2)}). ${kept.note}`);
          return;
        }
      }
      const guidance = inbox.getPendingMessages(project.id).filter((m) => m.kind !== "safe_interrupt").map((m) => m.content);
      if (guidance.length) inbox.consumePendingMessages(project.id);

      phase("coding", attempt);
      const attemptId = `att-${taskId}-${attempt}`;
      activeAttemptId = attemptId;
      const attemptStart = store.take(`${run.id}-attempt-${attempt}`);
      db.prepare(`
        INSERT INTO task_attempts (id, task_id, attempt_number, adapter_id, provider_id, model_id, base_commit, task_branch, snapshot_id, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
      `).run(attemptId, taskId, attempt, agent.id, provider.id, provider.getModel(), gitStart.headCommit, gitStart.activeBranch, activeSnapshot.id, new Date().toISOString());
      runs.setIterationCount(run.id, attempt);
      events.record(project.id, "attempt.started", { attempt, attemptId, maxAttempts: ctx.maxAttempts }, run.id, taskId);

      const changedSoFar = store.diff(activeSnapshot).changes.filter((c) => c.kind !== "deleted").map((c) => c.path);
      let instructionText: string | undefined;
      if (external) {
        // Context budgeting & automatic compaction before reasoning model call
        await memoryService.maybeCompact(conversation.id, provider, { inventory, signal });
        const memoryContext = memoryService.reconstructContext({
          conversationId: conversation.id,
          projectId: project.id,
          currentTaskText: ctx.taskText,
          currentRunId: run.id,
          requirementInventory: inventory,
          provider,
        });

        // Closed loop: the reasoning provider decides what the coding agent does in this iteration.
        const instructionCtx = {
          projectId: project.id,
          runId: run.id,
          taskText: ctx.taskText,
          projectObjective: project.objective,
          criteria: activeCriteriaStrings,
          taskContext,
          profile: baselineProfile,
          profileDefinition: profileDef,
          autonomyMode,
          blueprintDocuments: blueprints,
          blueprintRequirements: requirements,
          requirementInventory: inventory,
          files: projectFileList(root, 200),
          iteration: attempt,
          maxIterations: ctx.maxAttempts,
          history,
          // Iterations that dispatched nothing (unusable reply) are reported so GPT-Web can correct course.
          guidance: [...guidance, ...skippedIterations.splice(0).map((sk) => `Iteration ${sk.iteration} dispatched nothing: ${sk.reason}`)],
          signal,
          memoryContextSection: memoryContext.promptSection,
          stage,
          auditReport: latestAuditReport,
          adoptedScope,
        };
        phase("instructing", attempt);
        if (stage === "audit") {
          log(`[run-pipeline] Transitioning into full-system quality & architecture audit (Iteration ${attempt} of ${ctx.maxAttempts})`, "info");
        }
        let instr!: Awaited<ReturnType<typeof composeInstruction>>;
        for (let retry = 1; ; retry++) {
          try {
            instr = await composeInstruction(provider, instructionCtx);
          } catch (err) {
            if (signal.aborted || err instanceof RunCancelled) throw err;
            const wait = retryBackoffMs(retry);
            log(`${provider.displayName} could not produce the instruction (${diagnoseProviderError((err as Error).message, provider)}). Retrying in ${formatWait(wait)}; the run continues.`, "warn");
            await sleepUnlessCancelled(wait, signal);
            continue;
          }
          // An unusable reply in the audit stages is re-requested from GPT-Web (never replaced locally).
          if (instr.unrecoverable && retry < 3) {
            log(`${provider.displayName} did not author a usable ${stage} instruction; asking again (${retry} of 2).`, "warn");
            await sleepUnlessCancelled(30_000, signal);
            continue;
          }
          break;
        }
        ensureNotCancelled();
        if (instr.warning) {
          warnings.push(instr.warning);
          log(instr.warning, "warn");
        }
        if (instr.fidelityReport) {
          events.record(project.id, "requirements.fidelity_checked", {
            attempt,
            passed: instr.fidelityReport.passed,
            score: instr.fidelityReport.score,
            initialPassed: instr.initialFidelityReport?.passed,
            initialScore: instr.initialFidelityReport?.score,
            initialMissingRequirements: instr.initialFidelityReport?.missingRequirements,
            residualUncertainties: instr.residualUncertainties,
            missingRequirements: instr.fidelityReport.missingRequirements,
            weakenedConstraints: instr.fidelityReport.weakenedConstraints,
            unsupportedAdditions: instr.fidelityReport.unsupportedAdditions,
            unresolvedContradictions: instr.fidelityReport.unresolvedContradictions,
            summary: instr.fidelityReport.summary,
          }, run.id, taskId);
        }
        memoryService.recordModelDecision(conversation.id, instr.instruction || instr.rationale, { attempt, action: instr.action, rationale: instr.rationale, runId: run.id });
        if (instr.adoptedAlternative) {
          adoptedScope = instr.adoptedAlternative;
          events.record(project.id, "brain.scope_narrowed", { attempt, alternative: instr.adoptedAlternative, provider: provider.displayName }, run.id, taskId);
        }
        if (instr.action === "stop") {
          db.prepare("UPDATE task_attempts SET status = 'failed', ended_at = ?, instruction_text = ? WHERE id = ?").run(new Date().toISOString(), `(stopped) ${instr.rationale}`, attemptId);
          events.record(project.id, "brain.instruction", { attempt, action: "stop", rationale: instr.rationale, provider: provider.displayName, model: provider.getModel() }, run.id, taskId);
          // GPT-Web made its own decision to refuse/stop the task. Report it accurately; keep all work.
          const kept = describePreserved("brain-stopped");
          finish("stopped", "declined", `${provider.displayName} declined/stopped the task: ${instr.rationale} ${kept.note}`, { filesPreserved: kept.changed });
          return;
        }
        if (instr.unrecoverable) {
          skipIteration(attempt, attemptId, `${provider.displayName} did not author a usable ${stage} instruction (${instr.warning || instr.rationale}). Nothing was dispatched; the next iteration asks again.`);
          continue;
        }

        instructionText = instr.instruction?.trim();

        // Final dispatch boundary resilience: Never reject a user task in Orches.
        // For audit and audit_remediation stages, GPT-Web must author instructions; never substitute locally synthesized briefs.
        if (
          !instructionText ||
          instructionText.length < (stage === "audit" || stage === "audit_remediation" || attempt > 1 ? 15 : 30) ||
          isThoughtOrStatusFragment(instructionText) ||
          isTaskDescriptor(instructionText)
        ) {
          if (stage === "audit" || stage === "audit_remediation") {
            skipIteration(attempt, attemptId, `${provider.displayName}'s ${stage} reply was not a usable instruction after recovery. Nothing was dispatched; the next iteration asks again.`);
            continue;
          }
          const synthesisReason = isThoughtOrStatusFragment(instructionText || "")
            ? `Dispatched synthesized brief after model returned interim thought fragment: "${instructionText?.slice(0, 40)}"`
            : isTaskDescriptor(instructionText || "")
              ? "Dispatched synthesized brief after model returned internal task descriptor"
              : `Dispatched synthesized brief after model returned empty or insufficient instruction (${instructionText?.length || 0} chars)`;
          log(`[run-pipeline] ${synthesisReason}; synthesizing substantive brief to ensure task proceeds.`, "info");
          instructionText = attempt > 1
            ? synthesizeRepairBrief(instructionCtx, inventory)
            : synthesizeSubstantiveBrief(instructionCtx, inventory, synthesisReason);
          warnings.push(synthesisReason);
        }

        // Reference after the brief (never inside it): the register and the user's request, or only the agreed scope.
        instructionText = `${instructionText}
${buildAgentReference(inventory, ctx.taskText, adoptedScope)}`;
        memoryService.recordAgentDispatch(conversation.id, instructionText, { attempt, agent: agent.displayName, runId: run.id });
        db.prepare("UPDATE task_attempts SET instruction_text = ? WHERE id = ?").run(instructionText, attemptId);
        events.record(project.id, "brain.instruction", { attempt, action: "instruct", instruction: instructionText, rationale: instr.rationale, source: instr.source, provider: provider.displayName, model: provider.getModel() }, run.id, taskId);
        phase("coding", attempt);
        if ("getStateMachine" in provider && typeof (provider as any).getStateMachine === "function") {
          (provider as any).getStateMachine().transition("DISPATCHING_TO_ANTIGRAVITY");
        }
      }
      // Quota exhaustion, agent/provider errors and an agent that never started are infrastructure
      // problems, not results: wait and send the SAME instruction again without using up an iteration.
      let agentResult!: Awaited<ReturnType<typeof agent.execute>>;
      for (let dispatch = 0; ; dispatch++) {
        agentResult = await agent.execute({
          projectId: project.id,
          runId: run.id,
          taskId,
          attemptNumber: attempt,
          dispatchRetry: dispatch,
          workspacePath: root,
          taskText: ctx.taskText,
          title: plan.title,
          acceptanceCriteria: plan.acceptanceCriteria,
          profile: baselineProfile,
          filesToRead: [...new Set([...changedSoFar, ...plan.filesToRead])],
          previousFailure,
          guidance,
          instruction: instructionText,
          signal,
          onLog: (l) => log(l),
        });
        ensureNotCancelled();
        const kind = agentResult.errorKind;
        if (agentResult.status === "completed" || !(kind === "quota" || kind === "agent_error" || kind === "not_started")) break;
        const wait = kind === "quota" ? quotaWaitMs(agentResult.error) : retryBackoffMs(dispatch + 1);
        log(`${agent.displayName} ${kind === "quota" ? "hit its model quota" : "stopped with an error"} (${agentResult.error}). Sending the same instruction again in ${formatWait(wait)} — this does not use up an iteration. Press Stop to end the run.`, "warn");
        events.record(project.id, "agent.retry_scheduled", { attempt, retry: dispatch + 1, kind, error: agentResult.error, waitMs: wait }, run.id, taskId);
        await sleepUnlessCancelled(wait, signal);
      }
      for (const w of agentResult.warnings) log(w, "warn");
      if (agentResult.transcript) {
        const promptToSave = agentResult.transcript.prompt || instructionText;
        if (promptToSave) {
          db.prepare("UPDATE task_attempts SET agent_transcript_json = ?, instruction_text = ? WHERE id = ?").run(JSON.stringify(agentResult.transcript), promptToSave, attemptId);
        } else {
          db.prepare("UPDATE task_attempts SET agent_transcript_json = ? WHERE id = ?").run(JSON.stringify(agentResult.transcript), attemptId);
        }
        events.record(project.id, "agent.result", { attempt, agent: agent.displayName, ...agentResult.transcript, toolCalls: agentResult.transcript.toolCalls.slice(0, 50) }, run.id, taskId);
      }
      memoryService.recordAgentResponse(
        conversation.id,
        agentResult.transcript?.finalReply || `Attempt ${attempt} ended with status: ${agentResult.status}`,
        {
          attempt,
          status: agentResult.status,
          filesWritten: agentResult.filesWritten,
          filesDeleted: agentResult.filesDeleted,
          runId: run.id,
        }
      );
      ensureNotCancelled();

      // Ground truth: what actually changed on disk (this attempt, and since the run started).
      phase("verifying", attempt);
      const attemptDiff = store.diff(attemptStart);
      const diff = store.diff(activeSnapshot);
      log(attemptDiff.changes.length ? `This attempt changed: ${attemptDiff.changes.map((c) => `${c.path} (${c.kind}, +${c.additions}/-${c.deletions})`).join(", ")}` : "This attempt changed no files on disk.");
      const reported = new Set([...agentResult.filesWritten, ...agentResult.filesDeleted]);
      const unreported = attemptDiff.changes.filter((c) => !reported.has(c.path));
      if (agent.id === "builtin" && unreported.length) {
        log(`Files changed that the coder did not write (possibly edited by someone else during the run): ${unreported.map((c) => c.path).join(", ")}`, "warn");
      }

      const staticResults = await validateChangedFiles(root, diff.changes, { signal });
      const staticFailed = staticResults.some((s) => s.status !== "passed");
      let attemptChecks: CheckResult[] = [];
      if (diff.changes.length > 0 && !staticFailed && agentResult.status === "completed") {
        const afterProfile = await inspectProject(root, project.verificationCommands);
        if (afterProfile.checks.length) attemptChecks = await runChecks(root, afterProfile.checks, { signal, onLog: (l) => log(l) });
      }
      ensureNotCancelled();

      let critic: CriticOutcome = { available: false, error: "not run because the attempt already failed deterministic checks", verdict: "repair", criteria: [], findings: [], repairInstructions: [], summary: "" };
      // A short task that names a file it wants is a hard requirement. In a long specification (or once the
      // model narrowed the scope) file names are often examples or out-of-scope, so they only produce a warning.
      // Uploaded blueprints are referenced by name ("as described in spec.md") but live in Orches, not the workspace.
      const blueprintNames = new Set(blueprints.map((b) => b.filename.toLowerCase()));
      const requestedMissing = missingRequestedFiles(ctx.taskText, store.listWorkspaceFiles().files).filter(
        (f) => !blueprintNames.has(f.replace(/\\/g, "/").split("/").pop()!.toLowerCase())
      );
      const enforceRequestedFiles = ctx.taskText.length <= 4000 && !adoptedScope;
      const missingFiles = enforceRequestedFiles ? requestedMissing : [];
      if (!enforceRequestedFiles && requestedMissing.length) {
        log(`Files mentioned in the task that do not exist yet (not enforced for long specifications): ${requestedMissing.slice(0, 15).join(", ")}`, "warn");
      }
      if (stage === "audit") {
        const reportText = (agentResult.transcript?.finalReply || agentResult.summary || "").trim();
        if (reportText.length >= 20) {
          auditConducted = true;
          latestAuditReport = reportText;
        } else {
          log("[run-pipeline] Audit report from agent was empty or insufficient evidence was returned.", "warn");
          auditConducted = false;
        }
      }
      const deterministicFailure =
        agentResult.status !== "completed" ||
        (diff.changes.length === 0 && stage !== "audit") ||
        staticFailed ||
        missingFiles.length > 0 ||
        attemptChecks.some((c) => c.status !== "passed" && baselineChecks.find((b) => b.checkId === c.checkId)?.status !== c.status);
      if (!deterministicFailure) {
        phase("reviewing", attempt);
        const settings = SettingsManager.loadSettings();
        for (let retry = 1; ; retry++) {
          critic = await reviewAttempt(provider, {
            projectId: project.id,
            runId: run.id,
            taskId,
            taskText: ctx.taskText,
            iteration: attempt,
            taskContext,
            activeCriteria: taskContext.activeAcceptanceCriteria,
            excludedRequirements: taskContext.excludedRequirements,
            diffText: diff.diffText,
            changes: diff.changes,
            checks: attemptChecks,
            agentReport: agentResult.transcript?.finalReply,
            signal,
            maxDiffChars: settings.reviewDiffChunkBudget,
            auditStage: stage === "audit" || stage === "audit_remediation",
            auditReport: latestAuditReport || agentResult.transcript?.finalReply,
            scopeNote: adoptedScope,
            constraints: registerConstraints,
            goal: inventory.goal,
          });
          ensureNotCancelled();
          if (critic.available || critic.errorKind !== "provider") break;
          const wait = retryBackoffMs(retry);
          log(`Independent review could not reach ${provider.displayName} (${diagnoseProviderError(critic.error || "unknown error", provider)}). Retrying the review in ${formatWait(wait)}; the run continues.`, "warn");
          await sleepUnlessCancelled(wait, signal);
        }
        log(critic.available ? `Review verdict: ${critic.verdict}${critic.summary ? ` — ${critic.summary}` : ""}` : `Review unavailable: ${critic.error}`, critic.available ? "info" : "warn");
      }

      const gate: GateDecision = evaluateAttempt({
        changes: diff.changes,
        agentFailed: agentResult.status !== "completed",
        agentError: agentResult.error,
        rejectedWrites: agentResult.rejectedWrites,
        staticResults,
        baselineChecks,
        attemptChecks,
        critic,
        externalWrites: agentResult.transcript?.writesOutsideWorkspace ?? [],
        missingRequestedFiles: missingFiles,
        isFinalAttempt: attempt === ctx.maxAttempts,
        allowNoChanges: stage === "audit",
      });

      lastStaticResults = staticResults;
      lastAttemptChecks = attemptChecks;

      persistAttempt(db, { taskId, attemptId, agentResult, diff, staticResults, attemptChecks, baselineChecks: attempt === 1 ? baselineChecks : [], critic, gate, root });
      events.record(project.id, "attempt.evaluated", { attempt, attemptId, accepted: gate.accepted, outcome: gate.outcome, blockers: gate.blockers, warnings: gate.warnings, files: diff.changes }, run.id, taskId);

      memoryService.recordVerificationOutcome(
        conversation.id,
        {
          passed: gate.accepted,
          checks: attemptChecks.map((c) => ({ label: c.label, status: c.status, output: c.output })),
          blockers: gate.blockers,
          filesChanged: diff.changes.map((c) => c.path),
          criticVerdict: critic.verdict,
          criticRationale: critic.summary,
        },
        { attempt, runId: run.id }
      );

      updateRequirementStatuses(inventory, {
        filesChanged: diff.changes.map((c) => c.path),
        passedChecks: attemptChecks.filter((c) => c.status === "passed").map((c) => c.label),
        failedChecks: attemptChecks.filter((c) => c.status !== "passed").map((c) => c.label),
        criteriaResults: critic.available ? critic.criteria : [],
        reviewerAccepted: critic.available && critic.verdict === "accept",
        acceptanceCriteria: taskContext.activeAcceptanceCriteria,
      });
      events.record(project.id, "requirements.updated", {
        attempt,
        summary: inventory.summary,
        unverified: inventory.requirements.filter((r) => r.status !== "verified").map((r) => ({ id: r.id, status: r.status, title: r.title })),
      }, run.id, taskId);

      const diffBudget = calculateDiffCharBudget(typeof provider.getContextWindow === "function" ? provider.getContextWindow() : 32_768);
      taskContext = updateAuthoritativeTaskContext(taskContext, {
        iteration: attempt,
        changes: diff.changes,
        diffText: diff.diffText,
        diffTruncated: diff.diffText.length > diffBudget,
        checks: attemptChecks,
        findings: critic.findings,
        criteriaReviews: critic.criteria,
      });

      const prevDiffExcerpt = history[history.length - 1]?.diffExcerpt;
      const isRepeatedAttempt = attempt > 1 && diff.diffText.slice(0, 6000) === prevDiffExcerpt;

      // Continuous Quality & Post-Acceptance Improvement Workflow:
      // An initial ACCEPT verdict on implementation requirements does NOT terminate the session.
      // Instead, it confirms requirement acceptance and triggers the mandatory full-system audit.
      // Final conclusion requires:
      // 1. Full-system audit has actually been conducted.
      // 2. Its report has been returned to GPT-Web.
      // 3. GPT-Web explicitly returns ACCEPT for the audit assessment.
      // 4. No actionable implementation/repair instructions contradict the ACCEPT verdict.
      const hasActionableRepairs = critic.repairInstructions.length > 0;
      const isInitialAccept = gate.accepted && stage === "implementation";
      // The deterministic gate must also hold: a reviewer ACCEPT never overrides gate blockers
      // (protected-path edits, writes outside the workspace, regressions, concrete objections).
      const isAuditAccept = stage === "audit" &&
        gate.accepted &&
        auditConducted &&
        critic.verdict === "accept" &&
        !hasActionableRepairs;

      if (isInitialAccept) {
        log(`[run-pipeline] Initial requirements accepted by reviewer on iteration ${attempt}. Mandatory full-system audit triggered.`, "info");
        stage = "audit";
        auditConducted = false;
        latestAuditReport = undefined;
        if (attempt === ctx.maxAttempts) {
          log(`[run-pipeline] Configured maximum iterations (${ctx.maxAttempts}) reached upon initial acceptance; audit cannot be performed within budget.`, "warn");
        }
      } else if (stage === "audit") {
        if (isAuditAccept) {
          log(`[run-pipeline] Post-acceptance full-system audit ACCEPTED with no outstanding defects on iteration ${attempt}.`, "info");
        } else {
          log(`[run-pipeline] Post-acceptance full-system audit identified items to remediate (${critic.repairInstructions.length} instruction(s)). Transitioning to audit remediation.`, "info");
          stage = "audit_remediation";
        }
      } else if (stage === "audit_remediation") {
        log(`[run-pipeline] Post-acceptance audit remediation cycle completed on iteration ${attempt}. Transitioning back to fresh mandatory full-system audit.`, "info");
        stage = "audit";
        auditConducted = false;
        latestAuditReport = undefined;
      }

      // Successful termination is allowed ONLY when the mandatory audit has been conducted
      // and GPT-Web issues a qualifying final ACCEPT without contradictory repair instructions.
      const qualifiesForFinalAccept = isAuditAccept;

      if (qualifiesForFinalAccept) {
        activeSnapshot = null;
        warnings.push(...gate.warnings);
        let commitSha: string | null = null;
        if (gitStart.isGitRepo && project.autoCommit) {
          if (gitStart.isDirty) {
            log("Accepted changes were left uncommitted because the workspace already had uncommitted changes.", "warn");
          } else {
            const commit = await git.commitPaths(diff.changes.map((c) => c.path), `orches: ${plan.title}`);
            if (commit.committed) {
              commitSha = commit.commitSha;
              log(`Committed accepted changes on '${gitStart.activeBranch}' as ${commitSha?.slice(0, 10)}.`);
            } else {
              warnings.push(`Accepted changes are in the working tree but were not committed: ${commit.message}`);
              log(warnings[warnings.length - 1], "warn");
            }
          }
        }
        if (commitSha) runs.updateFields(run.id, { commitSha });
        finish(
          "completed",
          "verified",
          `Verified on iteration ${attempt} of ${ctx.maxAttempts}: Full-system audit accepted and verified with ${diff.changes.length} file(s) changed.`,
          { evidence: gate.evidence }
        );
        return;
      }

      if (gate.accepted && gate.outcome === "unverified" && attemptChecks.length === 0 && attempt < ctx.maxAttempts) {
        log(`The project has no automated checks the orchestrator could run, so behaviour was not tested. Continuing feedback loop (${attempt} of ${ctx.maxAttempts}) so tests can be implemented and validated.`, "info");
        previousFailure = "The project currently has no automated checks, so behaviour was not tested. Implement automated verification tests (e.g. test suite or verification script) to validate the system, and complete any remaining requirements.";
      } else {
        log(`Iteration ${attempt} completed with items to address: ${gate.blockers.join(" | ")}`, "info");
        previousFailure = buildRepairFeedback(gate, attemptChecks, staticResults, critic);
      }

      history.push({
        iteration: attempt,
        instruction: instructionText ?? "",
        agentReply: agentResult.transcript?.finalReply ?? agentResult.summary ?? "",
        agentState: agentResult.transcript?.state ?? agentResult.status,
        changedFiles: diff.changes.map((c) => `${c.path} (${c.kind})`),
        diffExcerpt: diff.diffText.slice(0, 6000),
        checks: attemptChecks.length
          ? [...staticResults.filter((c) => c.status !== "passed"), ...attemptChecks].map((c) => ({ label: c.label, status: c.status, output: c.output }))
          : staticResults.some((c) => c.status !== "passed")
            ? staticResults.filter((c) => c.status !== "passed").map((c) => ({ label: c.label, status: c.status, output: c.output }))
            : [{
                label: "Automated Checks",
                status: "not_run",
                output: baselineProfile.checks.length
                  ? "Project checks were not run for this iteration because it already failed earlier verification steps."
                  : "The project has no automated checks the orchestrator could run, so behaviour was not tested.",
              }],
        blockers: gate.accepted
          ? attemptChecks.length === 0 && baselineProfile.checks.length === 0
            ? ["No automated checks exist: behaviour was not tested. Please implement automated verification tests (e.g. test suite) and verify remaining functionality."]
            : []
          : gate.blockers,
        reviewer: critic.available ? `${critic.verdict}: ${critic.summary} ${critic.repairInstructions.join(" ")}` : "",
        reviewVerdict: critic.available ? critic.verdict : undefined,
        reviewSummary: critic.available ? critic.summary : undefined,
        criteriaResults: critic.available ? critic.criteria : undefined,
        findings: critic.available ? critic.findings : undefined,
        repairInstructions: critic.available ? critic.repairInstructions : undefined,
      });
      if (attempt < ctx.maxAttempts) log("Preserving files for the next iteration to address feedback.");
    }

    // Preservation of work & continuous feedback:
    // If the maximum configured attempts is reached before GPT-Web issues a qualifying final ACCEPT:
    // 1. Preserve all workspace changes, audit reports, implementation history, and outstanding findings.
    // 2. Mark the quality workflow as incomplete or unverified using the repository's existing status conventions.
    // 3. Report how many iterations were configured and consumed.
    // 4. Identify outstanding fixes, missing verification, and the reason the loop could not continue.
    // 5. Never manufacture an ACCEPT verdict or claim production readiness without evidence.
    const finalDiff = activeSnapshot ? store.diff(activeSnapshot) : null;
    const consumedAttempts = Math.min(ctx.maxAttempts, history.length);
    const lastHistory = history[history.length - 1];
    const outstandingItems = lastHistory?.blockers ?? [];
    const limit = `Configured maximum iterations (${ctx.maxAttempts} configured, ${consumedAttempts} consumed) reached`;
    const reason = stage === "implementation"
      ? `${limit} before ${provider.displayName} accepted the implementation.`
      : !auditConducted
        ? `${limit} after the implementation was accepted but before the mandatory full-system audit could be conducted.`
      : stage === "audit_remediation"
        ? `Configured maximum iterations (${ctx.maxAttempts} configured, ${consumedAttempts} consumed) reached while remediation items remained outstanding.`
        : `Configured maximum iterations (${ctx.maxAttempts} configured, ${consumedAttempts} consumed) reached before qualifying final audit acceptance.`;

    activeSnapshot = null;
    const changesCount = finalDiff?.changes.length ?? 0;
    finish(
      "completed_with_warnings",
      "unverified",
      `${reason} All workspace changes (${changesCount} file(s)) and audit history were preserved. Outstanding items to address: ${outstandingItems.join("; ") || "verification pending"}.`
    );
    return;
  } catch (err) {
    if (activeAttemptId) {
      try {
        db.prepare("UPDATE task_attempts SET status = 'failed', ended_at = COALESCE(ended_at, ?) WHERE id = ? AND status = 'running'").run(new Date().toISOString(), activeAttemptId);
      } catch (dbErr) {
        console.error(`[run ${run.id}] could not close attempt ${activeAttemptId}: ${(dbErr as Error).message}`);
      }
    }
    if (err instanceof RunCancelled || signal.aborted) {
      const kept = describePreserved("cancelled");
      const agentNote = agent.id === "antigravity"
        ? " Note: Orches cannot cancel the Antigravity Agent itself; if it was still working, stop it in the Agent panel, because it may keep changing files."
        : "";
      finish("stopped", "cancelled", `Stopped by user. ${kept.note}${agentNote}`, { filesPreserved: kept.changed });
      return;
    }
    const kept = describePreserved("error");
    finish("failed", "error", `Run failed: ${(err as Error).message}. ${kept.note}`, { filesPreserved: kept.changed });
  }
}

/** Keep the lines that explain a failure (errors, assertions, file:line) plus the tail. */
export function focusOutput(output: string, maxLines = 40): string {
  const lines = output.split(/\r?\n/);
  if (lines.length <= maxLines) return output;
  const important = new Set<number>();
  lines.forEach((l, i) => {
    if (/error|exception|fail|assert|expected|not defined|cannot|undefined|traceback|:\d+(:\d+)?\b/i.test(l)) {
      for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 2); k++) important.add(k);
    }
  });
  for (let i = lines.length - 10; i < lines.length; i++) important.add(i);
  const picked = [...important].sort((a, b) => a - b).slice(0, maxLines);
  const out: string[] = [];
  let prev = -2;
  for (const i of picked) {
    if (i !== prev + 1) out.push("…");
    out.push(lines[i]);
    prev = i;
  }
  return out.join("\n");
}

function buildRepairFeedback(gate: GateDecision, checks: CheckResult[], statics: CheckResult[], critic: CriticOutcome): string {
  const parts = [...gate.blockers.map((b) => `- ${b}`)];
  const failing = [...statics, ...checks].filter((c) => c.status !== "passed" && c.output);
  const headline = failing
    .map((c) => c.output.split(/\r?\n/).find((l) => /\b(\w*Error|Exception|AssertionError|SyntaxError)\b|not defined|is not a function|cannot find/i.test(l)))
    .filter((l): l is string => Boolean(l))
    .map((l) => l.trim());
  if (headline.length) parts.unshift(`KEY ERROR: ${[...new Set(headline)].slice(0, 3).join(" | ")}`);
  for (const c of failing) {
    parts.push(`Output of ${c.label}:\n${focusOutput(c.output)}`);
  }
  if (critic.available && critic.repairInstructions.length) parts.push(`Reviewer instructions:\n${critic.repairInstructions.map((r) => `- ${r}`).join("\n")}`);
  return parts.join("\n\n").slice(0, 6000);
}

function persistAttempt(
  db: DatabaseSync,
  a: {
    taskId: string;
    attemptId: string;
    agentResult: { status: string; summary: string; error?: string };
    diff: { changes: unknown[]; diffText: string };
    staticResults: CheckResult[];
    attemptChecks: CheckResult[];
    baselineChecks: CheckResult[];
    critic: CriticOutcome;
    gate: GateDecision;
    root: string;
  }
): void {
  const insert = db.prepare(`
    INSERT INTO verification_runs (id, task_id, attempt_id, check_type, command, argv_json, cwd, status, exit_code, duration_ms, stdout_snippet, stderr_snippet, truncated, timestamp, phase, source)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `);
  const ts = new Date().toISOString();
  const save = (c: CheckResult, phaseName: string) =>
    insert.run(`vr-${crypto.randomUUID()}`, a.taskId, a.attemptId, c.kind, c.label, a.root, c.status, c.exitCode, c.durationMs, c.output, c.truncated ? 1 : 0, ts, phaseName, c.source);
  a.baselineChecks.forEach((c) => save(c, "baseline"));
  a.staticResults.forEach((c) => save(c, "static"));
  a.attemptChecks.forEach((c) => save(c, "attempt"));

  if (a.critic.available) {
    db.prepare(`
      INSERT INTO critic_reviews (id, task_id, attempt_id, verdict, per_criterion_json, findings_json, repair_instructions_json, rationale, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`crit-${crypto.randomUUID()}`, a.taskId, a.attemptId, a.critic.verdict, JSON.stringify(a.critic.criteria), JSON.stringify(a.critic.findings), JSON.stringify(a.critic.repairInstructions), a.critic.summary, ts);
  }

  db.prepare(`
    UPDATE task_attempts SET status = ?, ended_at = ?, files_changed_json = ?, diff_text = ?, gate_json = ?, agent_summary = ?, agent_error = ?
    WHERE id = ?
  `).run(
    a.gate.accepted ? "succeeded" : "failed",
    ts,
    JSON.stringify(a.diff.changes),
    a.diff.diffText,
    JSON.stringify({ ...a.gate, critic: a.critic }),
    a.agentResult.summary,
    a.agentResult.error ?? null,
    a.attemptId
  );
}

function isProviderOutageOrConfigError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("500") ||
    lower.includes("503") ||
    lower.includes("browser") ||
    lower.includes("login") ||
    lower.includes("auth") ||
    lower.includes("unreachable") ||
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("crash") ||
    lower.includes("closed") ||
    lower.includes("connection") ||
    lower.includes("network") ||
    lower.includes("provider error")
  );
}

function diagnoseProviderError(error: string, provider?: ReasoningProvider): string {
  const name = provider?.displayName || "ChatGPT Web";
  const lower = error.toLowerCase();
  if (lower.includes("login") || lower.includes("auth") || lower.includes("unauthorized")) {
    return `${name} session is not authenticated. Please sign in to chatgpt.com in the open browser window.`;
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return `${name} response timed out. Check browser connection or generation status.`;
  }
  if (lower.includes("browser") || lower.includes("crash") || lower.includes("closed")) {
    return `${name} browser connection lost. Safe recovery will be attempted on next request.`;
  }
  return error;
}
