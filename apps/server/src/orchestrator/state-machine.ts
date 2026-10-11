import { Run, RunStatus } from "@orchestrator/shared-types";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { EventStore } from "../events/event-store.js";

/** A run executes one task. It is created "running" and ends in exactly one terminal state. */
const VALID_TRANSITIONS: Partial<Record<RunStatus, RunStatus[]>> = {
  ready: ["running", "stopped", "failed"],
  running: ["completed", "completed_with_warnings", "failed", "stopped", "budget_exhausted"],
};

export class RunStateMachine {
  constructor(
    private runRepo: RunRepository,
    private eventStore: EventStore
  ) {}

  public transition(runId: string, toStatus: RunStatus, reason?: string): Run {
    const run = this.runRepo.findById(runId);
    if (!run) throw new Error(`Run '${runId}' not found`);
    if (run.status === toStatus) return run;
    const allowed = VALID_TRANSITIONS[run.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new Error(`Invalid run state transition from '${run.status}' to '${toStatus}'`);
    }
    this.runRepo.updateStatus(runId, toStatus, reason);
    const updated = this.runRepo.findById(runId)!;
    this.eventStore.record(updated.projectId, "run.status", { runId, fromStatus: run.status, toStatus, reason: reason || null }, runId);
    return updated;
  }
}
