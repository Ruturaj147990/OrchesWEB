import {
  buildRequirementInventory,
  type ProjectRequirement,
  type RequirementInventory,
} from "../domain/requirements/requirement-inventory.js";
import type { CriticFinding, CriticCriterion } from "./critic.js";
import type { CheckResult } from "../verification/runner.js";

export interface AuthoritativeAcceptanceCriterion {
  id: string; // e.g. "AC-1", "AC-2"
  requirementId?: string; // e.g. "REQ-001"
  title: string;
  description: string;
  expectedResult: string;
  scopeStatus: "in_scope";
}

export interface AuthoritativeExcludedRequirement {
  id: string;
  title: string;
  reason: string;
  scopeStatus: "out_of_scope" | "safety_conflict" | "deferred";
}

export interface AuthoritativeUnresolvedRequirement {
  id: string;
  title: string;
  reason: string;
}

export interface AuthoritativeTaskContext {
  projectId: string;
  runId: string;
  taskId: string;
  iteration: number;
  maxIterations: number;
  originalObjective: string;
  projectObjective?: string;
  originalRequirements: ProjectRequirement[];
  approvedScope: ProjectRequirement[];
  activeAcceptanceCriteria: AuthoritativeAcceptanceCriterion[];
  excludedRequirements: AuthoritativeExcludedRequirement[];
  unresolvedRequirements: AuthoritativeUnresolvedRequirement[];
  acceptedFunctionality: string[];
  latestChanges: Array<{ path: string; kind: string; additions: number; deletions: number }>;
  latestDiffText: string;
  latestDiffTruncated: boolean;
  diffCompleteness: "complete" | "partial" | "empty";
  latestChecks: Array<{ label: string; status: string; exitCode: number | null; output: string }>;
  checksStatus: "all_passed" | "failures_detected" | "not_run";
  previousFindings: CriticFinding[];
  unresolvedFindings: CriticFinding[];
}

export interface CreateTaskContextInput {
  projectId: string;
  runId: string;
  taskId?: string;
  taskText: string;
  projectObjective?: string;
  inventory?: RequirementInventory;
  maxIterations?: number;
}

/**
 * Creates the single authoritative task context across all iterations of a run.
 * Establishes stable criteria IDs, complete text, explicit scope boundaries,
 * and separates excluded/conflicted items from active pass/fail criteria.
 */
export function buildAuthoritativeTaskContext(input: CreateTaskContextInput): AuthoritativeTaskContext {
  const {
    projectId,
    runId,
    taskId = "task-0",
    taskText,
    projectObjective,
    inventory = buildRequirementInventory({ taskText, projectObjective }),
    maxIterations = 5,
  } = input;

  const originalRequirements = [...inventory.requirements];
  const approvedScope = inventory.requirements.filter(
    (r) => r.scopeStatus === "in_scope" || (!r.scopeStatus && r.classification !== "unresolved_contradiction")
  );

  const excludedRequirements: AuthoritativeExcludedRequirement[] = inventory.requirements
    .filter(
      (r) =>
        r.scopeStatus === "out_of_scope" ||
        r.scopeStatus === "safety_conflict" ||
        r.scopeStatus === "deferred"
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.scopeConflictReason || (r.scopeStatus === "deferred" ? "Deferred to subsequent phase" : "Excluded from approved scope"),
      scopeStatus: r.scopeStatus as "out_of_scope" | "safety_conflict" | "deferred",
    }));

  const unresolvedRequirements: AuthoritativeUnresolvedRequirement[] = inventory.requirements
    .filter((r) => r.classification === "unresolved_contradiction" || r.scopeStatus === "unresolved")
    .map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.contradictionDetails?.conflictingText || "Contradiction or ambiguity in source specification",
    }));

  // Derive stable, complete active acceptance criteria
  const activeAcceptanceCriteria: AuthoritativeAcceptanceCriterion[] = [];
  const specCriteria = approvedScope.filter((r) => r.classification === "acceptance_criterion");

  if (specCriteria.length > 0) {
    specCriteria.forEach((c, idx) => {
      activeAcceptanceCriteria.push({
        id: `AC-${idx + 1}`,
        requirementId: c.id,
        title: normalizeCriterionTitle(c.title),
        description: c.description.trim(),
        expectedResult: extractExpectedResult(c.description),
        scopeStatus: "in_scope",
      });
    });
  } else {
    // If no explicit acceptance criteria exist, construct them from in-scope mandatory requirements
    const mandatory = approvedScope.filter(
      (r) => r.classification === "mandatory_requirement" || r.classification === "explicit_constraint"
    );
    if (mandatory.length > 0) {
      mandatory.slice(0, 10).forEach((m, idx) => {
        activeAcceptanceCriteria.push({
          id: `AC-${idx + 1}`,
          requirementId: m.id,
          title: normalizeCriterionTitle(m.title),
          description: m.description.trim(),
          expectedResult: extractExpectedResult(m.description),
          scopeStatus: "in_scope",
        });
      });
    } else {
      // Fallback: derive testable criterion from taskText without promoting clipped fragments
      const cleanTask = taskText.trim();
      activeAcceptanceCriteria.push({
        id: "AC-1",
        title: cleanTask.split(/\r?\n/)[0].slice(0, 80),
        description: cleanTask,
        expectedResult: `Fully implements and satisfies: ${cleanTask}`,
        scopeStatus: "in_scope",
      });
    }
  }

  return {
    projectId,
    runId,
    taskId,
    iteration: 1,
    maxIterations,
    originalObjective: taskText.trim(),
    projectObjective: projectObjective?.trim(),
    originalRequirements,
    approvedScope,
    activeAcceptanceCriteria,
    excludedRequirements,
    unresolvedRequirements,
    acceptedFunctionality: [],
    latestChanges: [],
    latestDiffText: "",
    latestDiffTruncated: false,
    diffCompleteness: "empty",
    latestChecks: [],
    checksStatus: "not_run",
    previousFindings: [],
    unresolvedFindings: [],
  };
}

export interface TaskContextUpdateInput {
  iteration: number;
  changes: Array<{ path: string; kind: string; additions: number; deletions: number }>;
  diffText: string;
  diffTruncated: boolean;
  checks: CheckResult[];
  findings?: CriticFinding[];
  criteriaReviews?: CriticCriterion[];
}

/**
 * Updates the authoritative task context with evidence from a completed attempt.
 * Retains the canonical scope, original objective, and active criteria intact.
 */
export function updateAuthoritativeTaskContext(
  context: AuthoritativeTaskContext,
  update: TaskContextUpdateInput
): AuthoritativeTaskContext {
  const latestChecks = update.checks.map((c) => ({
    label: c.label,
    status: c.status,
    exitCode: c.exitCode,
    output: c.output || "",
  }));

  const checksStatus: "all_passed" | "failures_detected" | "not_run" =
    latestChecks.length === 0
      ? "not_run"
      : latestChecks.every((c) => c.status === "passed")
        ? "all_passed"
        : "failures_detected";

  const diffCompleteness: "complete" | "partial" | "empty" =
    update.changes.length === 0
      ? "empty"
      : update.diffTruncated
        ? "partial"
        : "complete";

  // Reconcile findings: retain unresolved findings from previous rounds
  const newFindings = update.findings || [];
  const resolvedCriteriaIds = new Set(
    (update.criteriaReviews || []).filter((c) => c.status === "passed").map((c) => c.id)
  );

  const carriedForward = context.unresolvedFindings.filter(
    (f) => !newFindings.some((nf) => nf.message === f.message) && !resolvedCriteriaIds.has(f.message)
  );

  const unresolvedFindings = [...newFindings, ...carriedForward];

  return {
    ...context,
    iteration: update.iteration,
    latestChanges: update.changes,
    latestDiffText: update.diffText,
    latestDiffTruncated: update.diffTruncated,
    diffCompleteness,
    latestChecks,
    checksStatus,
    previousFindings: newFindings,
    unresolvedFindings,
  };
}

function normalizeCriterionTitle(title: string): string {
  const clean = title.replace(/^[-*•\d\.)\s]+/, "").replace(/\[[A-Za-z0-9_-]+\]/g, "").trim();
  return clean.slice(0, 100);
}

function extractExpectedResult(desc: string): string {
  const match = desc.match(/(?:should|must|verify that|assert that|expected to)\s+([^.,;\n]+)/i);
  if (match) return match[1].trim();
  return desc.slice(0, 120);
}
