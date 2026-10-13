import type { WorkspaceChange } from "../workspace/snapshot-store.js";
import { reservedPathReason, isInternalAgentArtifact } from "../workspace/path-safety.js";
import type { CheckResult } from "../verification/runner.js";
import type { CriticOutcome } from "./critic.js";

export type AttemptOutcome = "verified" | "unverified";

export interface GateInput {
  changes: WorkspaceChange[];
  agentFailed: boolean;
  agentError?: string;
  rejectedWrites: Array<{ path: string; reason: string }>;
  staticResults: CheckResult[];
  baselineChecks: CheckResult[];
  attemptChecks: CheckResult[];
  critic: CriticOutcome;
  /** Absolute paths an external agent reported writing outside the workspace. */
  externalWrites?: string[];
  /** Files named in the task that do not exist after the attempt. */
  missingRequestedFiles?: string[];
  /** Whether this attempt is the final allowed attempt (prevents premature unverified acceptance on intermediate attempts). */
  isFinalAttempt?: boolean;
  /** Whether zero workspace changes is permissible (e.g. during audit inspection stage). */
  allowNoChanges?: boolean;
}

export interface GateDecision {
  accepted: boolean;
  outcome: AttemptOutcome;
  blockers: string[];
  warnings: string[];
  evidence: string[];
}

/**
 * Deterministic acceptance rules. A model's claim of success is never enough:
 * acceptance needs real file changes, no regressions in project checks, valid
 * changed files, and no concrete objection from the critic. "verified" further
 * requires passing project checks and a critic review that accepted the work.
 */
export function evaluateAttempt(input: GateInput): GateDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const evidence: string[] = [];

  if (input.agentFailed) {
    blockers.push(`Coding mechanism reported failure: ${input.agentError || "no details"}`);
  }
  if (input.changes.length === 0 && !input.allowNoChanges) {
    blockers.push("No files were changed in the workspace, so the task cannot have been completed.");
  } else if (input.changes.length > 0) {
    evidence.push(`${input.changes.length} file(s) changed: ${input.changes.slice(0, 6).map((c) => `${c.path} (${c.kind})`).join(", ")}${input.changes.length > 6 ? ", …" : ""}`);
  }
  for (const change of input.changes) {
    const reason = reservedPathReason(change.path);
    if (reason) blockers.push(`Change to protected path '${change.path}' is not allowed: ${reason}.`);
  }
  for (const w of input.externalWrites ?? []) {
    if (!isInternalAgentArtifact(w)) {
      blockers.push(`The coding agent wrote outside the workspace: ${w}`);
    }
  }
  for (const rw of input.rejectedWrites ?? []) {
    warnings.push(`Blocked an unsafe write to '${rw.path}': ${rw.reason}`);
  }

  for (const s of input.staticResults) {
    if (s.status !== "passed") blockers.push(`${s.label}: ${s.output.split("\n")[0]}`);
  }

  const baselineById = new Map(input.baselineChecks.map((c) => [c.checkId, c]));
  let passedChecks = 0;
  let preExistingFailures = 0;
  for (const check of input.attemptChecks) {
    const before = baselineById.get(check.checkId);
    if (check.status === "passed") {
      passedChecks++;
      evidence.push(`${check.label} passed${before && before.status !== "passed" ? " (it was failing before this change)" : ""}.`);
    } else if (check.status === "cancelled") {
      blockers.push(`${check.label} was cancelled before it finished.`);
    } else if (before && before.status !== "passed") {
      preExistingFailures++;
      warnings.push(`${check.label} was already failing before this change and still fails (${check.status}); it provides no verification.`);
    } else {
      blockers.push(`${check.label} ${check.status === "timeout" ? "timed out" : "failed"}${before ? " (it passed before this change — regression)" : ""}${check.exitCode !== null ? ` with exit code ${check.exitCode}` : ""}.`);
    }
  }
  if (input.attemptChecks.length === 0) {
    warnings.push("The project has no automated checks the orchestrator could run, so behaviour was not tested.");
  }

  for (const f of input.missingRequestedFiles ?? []) {
    blockers.push(`The task asks for '${f}', but it does not exist in the workspace.`);
  }

  const critic = input.critic;
  let criticEndorses = false;
  if (!critic.available) {
    warnings.push(`Independent review was unavailable: ${critic.error || "unknown error"}.`);
  } else {
    // If chunked coverage ledger exists, require 100% complete coverage before endorsing
    if (critic.coverageLedger && !critic.coverageLedger.isComplete()) {
      const unreviewed = critic.coverageLedger.unreviewedFiles();
      blockers.push(`Critic review incomplete: ${unreviewed.length} changed files were not successfully reviewed (${unreviewed.join(", ")}).`);
    }

    // Concrete objections count whatever the verdict word says: a reviewer that answers "accept" while
    // marking a criterion failed, or unverified *and* asking for a specific fix, has not accepted it.
    const concrete = [
      ...critic.criteria.filter((c) => c.status === "failed" && c.reason.trim()).map((c) => `criterion ${c.id} not met — ${c.reason}`),
      ...(critic.repairInstructions.length > 0
        ? critic.criteria.filter((c) => c.status === "unverified" && c.reason.trim()).map((c) => `criterion ${c.id} not shown to be met — ${c.reason} (requested: ${critic.repairInstructions.join("; ")})`)
        : []),
      ...critic.findings.filter((f) => f.severity === "high" || f.severity === "critical").map((f) => `${f.severity} issue — ${f.message}`),
    ];
    if (concrete.length > 0) {
      for (const c of concrete) blockers.push(`Critic: ${c}`);
    } else if (critic.verdict === "accept" && (!critic.coverageLedger || critic.coverageLedger.isComplete())) {
      criticEndorses = true;
      evidence.push(`Critic review accepted the change${critic.summary ? `: ${critic.summary}` : "."}`);
    } else {
      warnings.push(`Critic asked for changes without a concrete failed criterion or serious finding${critic.summary ? ` (${critic.summary})` : ""}.`);
      if (input.isFinalAttempt === false) {
        blockers.push(`Critic requested repair: ${critic.summary || "revisions requested by reviewer before acceptance"}.`);
      }
    }
  }

  const accepted = blockers.length === 0;
  const verified = accepted && passedChecks > 0 && preExistingFailures === 0 && criticEndorses;
  return {
    accepted,
    outcome: verified ? "verified" : "unverified",
    blockers,
    warnings,
    evidence,
  };
}
