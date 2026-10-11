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
import { SnapshotStore, WorkspaceSnapshot, RestoreResult } from "../workspace/snapshot-store.js";
import { inspectProject, ProjectProfile } from "../workspace/project-inspector.js";
import { runChecks, validateChangedFiles, CheckResult } from "../verification/runner.js";
import { planTask } from "./planner.js";
import { reviewAttempt, CriticOutcome } from "./critic.js";
import { evaluateAttempt, GateDecision } from "./acceptance-gate.js";
import { composeInstruction, IterationEvidence } from "./instructor.js";
import { projectFileList } from "../workspace/project-inspector.js";
import { missingRequestedFiles } from "../workspace/requested-files.js";
import { ReasoningUsageLedger } from "../domain/budgets/usage-ledger.js";
import { SettingsManager } from "../platform/settings-manager.js";
import { BlueprintRepository } from "../storage/repositories/blueprint-repository.js";
import { getProjectProfile } from "../domain/profiles/project-profiles.js";

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

export async function executeRun(ctx: PipelineContext): Promise<void> {
  const { db, events, runs, project, run, provider, agent, signal } = ctx;
  const root = project.rootPath;
  const inbox = new InboxService(db, events);
  const store = snapshotStoreFor(root);
  let taskId: string | null = null;
  let activeSnapshot: WorkspaceSnapshot | null = null;
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
      const taskStatus = outcome === "verified" || outcome === "unverified" ? "succeeded" : outcome === "cancelled" ? "canceled" : "failed";
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(taskStatus, new Date().toISOString(), taskId);
    }
    events.record(project.id, "run.finished", { status, outcome, summary }, run.id, taskId);
  };

  const rollbackActive = (label: string): RestoreResult | null => {
    if (!activeSnapshot) return null;
    const diff = store.diff(activeSnapshot);
    const paths = diff.changes.map((c) => c.path);
    const result = store.restore(activeSnapshot, paths, label);
    if (activeAttemptId) {
      db.prepare("UPDATE task_attempts SET rollback_json = ? WHERE id = ?").run(JSON.stringify(result), activeAttemptId);
    }
    events.record(project.id, "attempt.rolled_back", { ...result, label }, run.id, taskId);
    return result;
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
      const health = await provider.healthCheck();
      if (!health.ok) {
        finish("failed", "error", `Reasoning provider is not ready: ${health.message}`);
        return;
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
      finish("failed", "error", `Planning failed: ${(err as Error).message}`);
      return;
    }
    if (plan.warning) {
      warnings.push(plan.warning);
      log(plan.warning, "warn");
    }
    runs.updateFields(run.id, { title: plan.title });
    taskId = `task-${crypto.randomUUID()}`;
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
      JSON.stringify(plan.acceptanceCriteria),
      JSON.stringify(baselineProfile.checks.map((c) => c.label)),
      ctx.maxAttempts,
      now,
      now
    );
    runs.updateFields(run.id, { currentTaskId: taskId });
    events.record(project.id, "task.planned", { taskId, title: plan.title, criteria: plan.acceptanceCriteria, filesToRead: plan.filesToRead, source: plan.source }, run.id, taskId);

    // 4. Attempts. Every attempt is judged on the cumulative change since the run started, so a
    // repair attempt edits the previous attempt's files instead of starting over. Rollback to the
    // run's starting snapshot happens only when the run ends without an accepted result.
    activeSnapshot = store.take(`${run.id}-start`);
    let previousFailure: string | undefined;
    const history: IterationEvidence[] = [];
    const external = !agent.usesReasoningProvider;
    for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
      ensureNotCancelled();
      if (provider.privacyClass === "cloud") {
        const usage = ReasoningUsageLedger.getShared().getRunUsage(run.id);
        if (usage.costUsd >= CLOUD_RUN_COST_CEILING_USD) {
          const rb = rollbackActive("budget");
          finish("budget_exhausted", "error", `Stopped before attempt ${attempt}: cloud spend for this run reached $${usage.costUsd.toFixed(2)} (ceiling $${CLOUD_RUN_COST_CEILING_USD.toFixed(2)}). ${describeRollback(rb)}`);
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
      events.record(project.id, "attempt.started", { attempt, attemptId, maxAttempts: ctx.maxAttempts }, run.id, taskId);

      const changedSoFar = store.diff(activeSnapshot).changes.filter((c) => c.kind !== "deleted").map((c) => c.path);
      let instructionText: string | undefined;
      if (external) {
        // Closed loop: the reasoning provider decides what the coding agent does in this iteration.
        phase("instructing", attempt);
        const instr = await composeInstruction(provider, {
          projectId: project.id,
          runId: run.id,
          taskText: ctx.taskText,
          projectObjective: project.objective,
          criteria: plan.acceptanceCriteria,
          profile: baselineProfile,
          profileDefinition: profileDef,
          autonomyMode,
          blueprintDocuments: blueprints,
          blueprintRequirements: requirements,
          files: projectFileList(root, 200),
          iteration: attempt,
          maxIterations: ctx.maxAttempts,
          history,
          guidance,
          signal,
        });
        ensureNotCancelled();
        if (instr.warning) {
          warnings.push(instr.warning);
          log(instr.warning, "warn");
        }
        if (instr.action === "stop") {
          db.prepare("UPDATE task_attempts SET status = 'failed', ended_at = ?, instruction_text = ? WHERE id = ?").run(new Date().toISOString(), `(stopped) ${instr.rationale}`, attemptId);
          events.record(project.id, "brain.instruction", { attempt, action: "stop", rationale: instr.rationale, provider: provider.displayName, model: provider.getModel() }, run.id, taskId);
          const rb = rollbackActive("brain-stopped");
          activeSnapshot = null;
          finish("failed", "rejected", `${provider.displayName} stopped the run: ${instr.rationale} ${describeRollback(rb)}`, { rollback: rb });
          return;
        }
        instructionText = instr.instruction;
        db.prepare("UPDATE task_attempts SET instruction_text = ? WHERE id = ?").run(instructionText, attemptId);
        events.record(project.id, "brain.instruction", { attempt, action: "instruct", instruction: instructionText, rationale: instr.rationale, source: instr.source, provider: provider.displayName, model: provider.getModel() }, run.id, taskId);
        phase("coding", attempt);
      }
      const agentResult = await agent.execute({
        projectId: project.id,
        runId: run.id,
        taskId,
        attemptNumber: attempt,
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
      const missingFiles = missingRequestedFiles(ctx.taskText, store.listWorkspaceFiles().files);
      const deterministicFailure =
        agentResult.status !== "completed" ||
        diff.changes.length === 0 ||
        staticFailed ||
        missingFiles.length > 0 ||
        attemptChecks.some((c) => c.status !== "passed" && baselineChecks.find((b) => b.checkId === c.checkId)?.status !== c.status);
      if (!deterministicFailure) {
        phase("reviewing", attempt);
        critic = await reviewAttempt(provider, {
          projectId: project.id,
          runId: run.id,
          taskId,
          taskText: ctx.taskText,
          criteria: plan.acceptanceCriteria,
          diffText: diff.diffText,
          checks: attemptChecks,
          agentReport: agentResult.transcript?.finalReply,
          signal,
        });
        ensureNotCancelled();
        log(critic.available ? `Review verdict: ${critic.verdict}${critic.summary ? ` — ${critic.summary}` : ""}` : `Review unavailable: ${critic.error}`, critic.available ? "info" : "warn");

        if (!critic.available && isProviderOutageOrConfigError(critic.error)) {
          const diag = diagnoseProviderError(critic.error || "Unknown provider error", provider);
          log(`Reviewer failed due to reasoning provider error: ${diag}`, "error");
          persistAttempt(db, {
            taskId,
            attemptId,
            agentResult,
            diff,
            staticResults,
            attemptChecks,
            baselineChecks: attempt === 1 ? baselineChecks : [],
            critic,
            gate: { accepted: false, outcome: "rejected", blockers: [diag], warnings: [critic.error ?? ""], evidence: [] },
            root,
          });
          events.record(project.id, "attempt.evaluated", { attempt, attemptId, accepted: false, outcome: "rejected", blockers: [diag], warnings: [critic.error], files: diff.changes }, run.id, taskId);
          activeSnapshot = null; // Preserve workspace changes on disk so work is not lost
          finish(
            "blocked",
            "error",
            `Run blocked: Independent review failed due to provider error (${diag}). Workspace changes were preserved. Fix the model configuration or start the provider to continue.`,
            { evidence: [diag] }
          );
          return;
        }
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
      });

      persistAttempt(db, { taskId, attemptId, agentResult, diff, staticResults, attemptChecks, baselineChecks: attempt === 1 ? baselineChecks : [], critic, gate, root });
      events.record(project.id, "attempt.evaluated", { attempt, attemptId, accepted: gate.accepted, outcome: gate.outcome, blockers: gate.blockers, warnings: gate.warnings, files: diff.changes }, run.id, taskId);

      const prevDiffExcerpt = history[history.length - 1]?.diffExcerpt;
      const isRepeatedAttempt = attempt > 1 && diff.diffText.slice(0, 6000) === prevDiffExcerpt;

      // Acceptance handling:
      // An attempt concludes if:
      // 1. It is accepted AND verified (has passing checks and critic endorsed), OR
      // 2. It is not an external agent (e.g. built-in coder), OR
      // 3. It has reached the maximum allowed attempts (ctx.maxAttempts), OR
      // 4. A repeated ineffective attempt was detected where no new files or changes were made.
      const canConclude = gate.accepted && (
        gate.outcome === "verified" ||
        !external ||
        attempt >= ctx.maxAttempts ||
        isRepeatedAttempt
      );

      if (canConclude) {
        activeSnapshot = null;
        runs.incrementIteration(run.id);
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
        store.prune();
        const verb = gate.outcome === "verified" ? "Verified" : "Completed without full verification";
        finish(
          gate.outcome === "verified" ? "completed" : "completed_with_warnings",
          gate.outcome,
          `${verb} on attempt ${attempt}: ${diff.changes.length} file(s) changed.${gate.outcome === "unverified" ? ` ${gate.warnings[0] ?? ""}` : ""}`.trim(),
          { evidence: gate.evidence }
        );
        return;
      }

      if (gate.accepted && gate.outcome === "unverified" && attempt < ctx.maxAttempts) {
        log(`The project has no automated checks the orchestrator could run, so behaviour was not tested. Continuing feedback loop (${attempt} of ${ctx.maxAttempts}) so tests can be implemented and validated.`, "info");
        runs.incrementIteration(run.id);
        previousFailure = "The project currently has no automated checks, so behaviour was not tested. Implement automated verification tests (e.g. test suite or verification script) to validate the system, and complete any remaining requirements.";
      } else {
        log(`Attempt ${attempt} rejected: ${gate.blockers.join(" | ")}`, "warn");
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
          : [{ label: "Automated Checks", status: "unverified", output: "The project has no automated checks the orchestrator could run, so behaviour was not tested." }],
        blockers: gate.accepted ? ["No automated checks exist: behaviour was not tested. Please implement automated verification tests (e.g. test suite) and verify remaining functionality."] : gate.blockers,
        reviewer: critic.available ? `${critic.verdict}: ${critic.summary} ${critic.repairInstructions.join(" ")}` : "",
      });
      if (attempt < ctx.maxAttempts) log("Keeping this attempt's files so the next attempt can repair them; everything is rolled back if no attempt is accepted.");
    }

    const rb = rollbackActive("rejected");
    activeSnapshot = null;
    if (rb && rb.failed.length > 0) {
      finish("failed", "error", `All attempts were rejected and rollback was INCOMPLETE for: ${rb.failed.map((f) => `${f.path} (${f.error})`).join(", ")}. Inspect these files manually.`, { rollback: rb });
      return;
    }
    finish("failed", "rejected", `All ${ctx.maxAttempts} attempt(s) were rejected. ${describeRollback(rb)}`, { rollback: rb });
  } catch (err) {
    if (err instanceof RunCancelled || signal.aborted) {
      const rb = rollbackActive("cancelled");
      finish("stopped", "cancelled", describeCancellation(rb));
      return;
    }
    let rbNote = "";
    try {
      const rb = rollbackActive("error");
      if (rb) rbNote = rb.failed.length ? ` Rollback incomplete for ${rb.failed.map((f) => f.path).join(", ")}.` : ` In-progress changes were rolled back (${rb.restored.length + rb.removed.length} file(s)).`;
    } catch (rbErr) {
      rbNote = ` Rollback failed: ${(rbErr as Error).message}.`;
    }
    finish("failed", "error", `Run failed: ${(err as Error).message}.${rbNote}`);
  }
}

function describeRollback(rb: RestoreResult | null): string {
  if (!rb) return "No files had been changed.";
  if (rb.failed.length) return `Rollback was INCOMPLETE for: ${rb.failed.map((f) => f.path).join(", ")}.`;
  const n = rb.restored.length + rb.removed.length;
  return n ? `All ${n} changed file(s) were rolled back; the workspace is back to its original state.` : "No files had been changed.";
}

function describeCancellation(rb: RestoreResult | null): string {
  if (!rb) return "Stopped by user before any files were changed.";
  if (rb.failed.length) return `Stopped by user. Rollback was INCOMPLETE for: ${rb.failed.map((f) => f.path).join(", ")}.`;
  const n = rb.restored.length + rb.removed.length;
  return n ? `Stopped by user. ${n} file(s) changed by the interrupted attempt were rolled back.` : "Stopped by user. The interrupted attempt had not changed any files.";
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
    lower.includes("econnrefused") ||
    lower.includes("unreachable") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("model_unavailable")
  );
}

function diagnoseProviderError(error: string, provider: ReasoningProvider): string {
  const lower = error.toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) {
    return `Model '${provider.getModel()}' not found on local model server (HTTP 404). Run 'ollama pull ${provider.getModel()}' or select an available model in Settings.`;
  }
  if (lower.includes("econnrefused") || lower.includes("unreachable")) {
    return `Local reasoning model server is unreachable at ${provider.displayName}. Ensure Ollama or local model server is running.`;
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) {
    return `Authentication failed for reasoning provider '${provider.displayName}'. Check your API key.`;
  }
  return error;
}
