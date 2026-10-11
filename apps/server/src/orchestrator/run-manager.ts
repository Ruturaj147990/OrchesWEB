import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Run, RunSchema } from "@orchestrator/shared-types";
import { EventStore } from "../events/event-store.js";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { ProjectRepository } from "../storage/repositories/project-repository.js";
import { RunStateMachine } from "./state-machine.js";
import { executeRun, snapshotStoreFor } from "./run-pipeline.js";
import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { CodingAgentAdapter } from "../providers/coding-agents/adapter.js";
import { getActiveProvider } from "../providers/reasoning/registry.js";
import { resolveCodingAgent } from "../providers/coding-agents/registry.js";
import { SettingsManager } from "../platform/settings-manager.js";
import { validateWorkspaceRoot, forbiddenWorkspaceRoots } from "../workspace/path-safety.js";

export interface RunManagerOverrides {
  /** Tests inject deterministic providers/agents; production resolves them from settings. */
  provider?: () => ReasoningProvider;
  agent?: (provider: ReasoningProvider) => CodingAgentAdapter;
}

export class RunStartError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export class RunManager {
  private runs: RunRepository;
  private projects: ProjectRepository;
  private stateMachine: RunStateMachine;
  private active = new Map<string, { controller: AbortController; promise: Promise<void>; rootPath: string }>();

  constructor(private db: DatabaseSync, private events: EventStore, private overrides: RunManagerOverrides = {}) {
    this.runs = new RunRepository(db);
    this.projects = new ProjectRepository(db);
    this.stateMachine = new RunStateMachine(this.runs, events);
  }

  public isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Resolves when the given run's background execution has finished (used by tests and shutdown). */
  public async waitFor(runId: string): Promise<void> {
    await this.active.get(runId)?.promise;
  }

  public start(projectId: string, taskText: string): Run {
    const project = this.projects.findById(projectId);
    if (!project) throw new RunStartError("Project not found.", 404);
    const text = (taskText || "").trim();
    if (text.length < 3) throw new RunStartError("Describe the task to run.");
    if (text.length > 20_000) throw new RunStartError("Task description is too long (20,000 characters max).");
    if (!fs.existsSync(project.rootPath)) throw new RunStartError(`Workspace folder not found: ${project.rootPath}`);
    // Re-validated at every start: projects saved by older versions may point at unsafe folders.
    const rootCheck = validateWorkspaceRoot(project.rootPath, forbiddenWorkspaceRoots());
    if (!rootCheck.ok) throw new RunStartError(`This project's folder cannot be used: ${rootCheck.reason} Edit the project to choose another folder.`);

    const existing = this.runs.findActiveByProjectId(projectId);
    if (existing) throw new RunStartError("A run is already in progress for this project. Stop it before starting another.", 409);
    const normalizedRoot = path.resolve(project.rootPath).toLowerCase();
    for (const job of this.active.values()) {
      if (job.rootPath === normalizedRoot) throw new RunStartError("Another project is running in the same workspace folder.", 409);
    }

    const settings = SettingsManager.loadSettings();
    const provider = this.overrides.provider ? this.overrides.provider() : getActiveProvider();
    const agent = this.overrides.agent ? this.overrides.agent(provider) : resolveCodingAgent(settings.codingAgentId, provider);

    const run: Run = RunSchema.parse({
      id: `run-${crypto.randomUUID()}`,
      projectId,
      status: "running",
      startedAt: new Date().toISOString(),
      taskText: text,
      providerId: provider.id,
      modelId: provider.getModel(),
      agentId: agent.id,
    });
    this.runs.create(run);
    this.events.record(projectId, "run.started", {
      runId: run.id,
      task: text,
      provider: { id: provider.id, name: provider.displayName, model: provider.getModel() },
      agent: { id: agent.id, name: agent.displayName },
    }, run.id);

    const controller = new AbortController();
    const promise = executeRun({
      db: this.db,
      events: this.events,
      runs: this.runs,
      stateMachine: this.stateMachine,
      project,
      run,
      taskText: text,
      provider,
      agent,
      maxAttempts: settings.maxAttempts,
      signal: controller.signal,
    })
      .catch((err) => {
        // executeRun handles its own failures; this guards against bugs in that handling.
        console.error(`[run ${run.id}] unexpected pipeline error`, err);
        try {
          this.runs.updateFields(run.id, { outcome: "error", summary: `Internal error: ${(err as Error).message}` });
          this.stateMachine.transition(run.id, "failed", `Internal error: ${(err as Error).message}`);
        } catch {}
      })
      .finally(() => this.active.delete(run.id));
    this.active.set(run.id, { controller, promise, rootPath: normalizedRoot });
    return run;
  }

  public stop(runId: string): Run {
    const run = this.runs.findById(runId);
    if (!run) throw new RunStartError("Run not found.", 404);
    const job = this.active.get(runId);
    if (job) {
      job.controller.abort();
      this.events.record(run.projectId, "run.log", { message: "Stop requested; cancelling the current step and rolling back its changes…", level: "warn" }, runId);
      return run;
    }
    if (run.status === "running" || run.status === "ready") {
      // No live job (e.g. after a crash): mark it stopped so the project is usable again.
      this.runs.updateFields(runId, { outcome: "cancelled", summary: "Stopped (no active process was attached to this run)." });
      return this.stateMachine.transition(runId, "stopped", "Stopped (no active process was attached to this run).");
    }
    return run;
  }

  /** Abort everything and wait for rollbacks (graceful shutdown). */
  public async shutdown(): Promise<void> {
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([...this.active.values()].map((j) => j.promise));
  }

  /**
   * Runs left "running" by a crash or restart: restore the files changed by the
   * attempt that was in progress (from its pre-attempt snapshot) and mark the run failed.
   */
  public recoverInterruptedRuns(): number {
    let recovered = 0;
    for (const run of this.runs.listActive()) {
      if (this.active.has(run.id)) continue;
      const project = this.projects.findById(run.projectId);
      let note = "The server stopped while this run was in progress.";
      const attempt = this.db
        .prepare(`
          SELECT a.id, a.snapshot_id FROM task_attempts a JOIN tasks t ON t.id = a.task_id
          WHERE t.run_id = ? AND a.status = 'running' ORDER BY a.attempt_number DESC LIMIT 1
        `)
        .get(run.id) as { id: string; snapshot_id: string | null } | undefined;
      if (attempt?.snapshot_id && project && fs.existsSync(project.rootPath)) {
        const store = snapshotStoreFor(project.rootPath);
        const snap = store.get(attempt.snapshot_id);
        if (snap) {
          const diff = store.diff(snap);
          const rb = store.restore(snap, diff.changes.map((c) => c.path), "recovery");
          this.db.prepare("UPDATE task_attempts SET status = 'interrupted', ended_at = ?, rollback_json = ? WHERE id = ?").run(new Date().toISOString(), JSON.stringify(rb), attempt.id);
          note += rb.failed.length
            ? ` Rollback was INCOMPLETE for: ${rb.failed.map((f) => f.path).join(", ")}.`
            : ` ${rb.restored.length + rb.removed.length} file(s) from the unfinished attempt were rolled back.`;
        } else {
          note += " The pre-attempt snapshot was missing, so files could not be rolled back automatically.";
        }
      }
      this.runs.updateFields(run.id, { outcome: "error", summary: note });
      this.runs.updateStatus(run.id, "failed", note);
      if (run.currentTaskId) this.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(run.currentTaskId);
      this.events.record(run.projectId, "run.finished", { status: "failed", outcome: "error", summary: note }, run.id);
      recovered++;
    }
    return recovered;
  }
}
