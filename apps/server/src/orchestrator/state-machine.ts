import { Run, RunStatus } from "@orchestrator/shared-types";
import { RunRepository } from "../storage/repositories/run-repository.js";
import { EventStore } from "../events/event-store.js";

const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ["ready", "canceled"],
  ready: ["running", "canceled"],
  running: ["pausing", "paused", "completing", "blocked", "budget_exhausted", "stalled", "stopped", "failed"],
  pausing: ["paused", "stopped", "failed"],
  paused: ["running", "stopped", "canceled"],
  completing: ["completed", "completed_with_warnings", "failed"],
  completed: [],
  completed_with_warnings: [],
  blocked: ["ready", "running", "stopped"],
  budget_exhausted: ["ready", "running", "stopped"],
  stalled: ["ready", "running", "stopped"],
  stopped: ["ready"],
  failed: ["ready"],
  canceled: [],
};

export class RunStateMachine {
  constructor(
    private runRepo: RunRepository,
    private eventStore: EventStore
  ) {}

  public transition(runId: string, toStatus: RunStatus, reason?: string): Run {
    const run = this.runRepo.findById(runId);
    if (!run) {
      throw new Error(`Run '${runId}' not found`);
    }

    // Idempotent: already in target status
    if (run.status === toStatus) {
      return run;
    }

    const allowed = VALID_TRANSITIONS[run.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new Error(`Invalid run state transition from '${run.status}' to '${toStatus}'`);
    }

    this.runRepo.updateStatus(runId, toStatus, reason);
    const updated = this.runRepo.findById(runId)!;

    // Record audit event
    this.eventStore.record(
      updated.projectId,
      `run.${toStatus}`,
      {
        runId,
        fromStatus: run.status,
        toStatus,
        reason: reason || null,
      },
      runId
    );

    return updated;
  }
}
