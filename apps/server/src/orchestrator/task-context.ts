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
  /** Requirement/constraint IDs this criterion verifies. */
  covers?: string[];
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
    .filter((r) => r.classification === "unresolved_contradiction" || r.scopeStatus === "unresolved" || r.contradictionDetails)
    .map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.assumption
        ? `Open question — assume: ${r.assumption}`
        : r.contradictionDetails
          ? `Possible conflict with: ${r.contradictionDetails.conflictingText}`
          : "Contradiction or ambiguity in the source specification",
    }));

  const activeAcceptanceCriteria = deriveAcceptanceCriteria(approvedScope, taskText);
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

const MAX_INDIVIDUAL_DERIVED_CRITERIA = 30;

/**
 * The criteria the reviewer judges every attempt against:
 * 1. explicit acceptance criteria from the register (with the IDs they cover);
 * 2. for every in-scope requirement or constraint not covered by (1), a criterion of its own — grouped by
 *    source section when there are many — so nothing in scope goes unjudged.
 * Out-of-scope and deferred items are never criteria.
 */
function deriveAcceptanceCriteria(inScope: ProjectRequirement[], taskText: string): AuthoritativeAcceptanceCriterion[] {
  const criteria: AuthoritativeAcceptanceCriterion[] = [];
  const used = new Set<string>();
  const nextId = () => {
    let n = criteria.length + 1;
    while (used.has(`AC-${n}`)) n++;
    used.add(`AC-${n}`);
    return `AC-${n}`;
  };

  const explicit = inScope.filter((r) => r.classification === "acceptance_criterion");
  for (const c of explicit) if (/^AC-\d+$/i.test(c.id)) used.add(c.id.toUpperCase());
  for (const c of explicit) {
    criteria.push({
      id: /^AC-\d+$/i.test(c.id) ? c.id.toUpperCase() : nextId(),
      requirementId: c.id,
      title: normalizeCriterionTitle(c.title),
      description: c.description.trim(),
      expectedResult: extractExpectedResult(c.description),
      scopeStatus: "in_scope",
      covers: c.covers ?? [],
    });
  }

  const covered = new Set(criteria.flatMap((c) => c.covers ?? []).map((id) => id.toUpperCase()));
  const uncovered = inScope.filter(
    (r) => (r.classification === "mandatory_requirement" || r.classification === "explicit_constraint") && !covered.has(r.id.toUpperCase())
  );

  if (uncovered.length <= MAX_INDIVIDUAL_DERIVED_CRITERIA) {
    for (const r of uncovered) {
      criteria.push({
        id: nextId(),
        requirementId: r.id,
        title: normalizeCriterionTitle(r.title),
        description: `${r.classification === "explicit_constraint" ? "The implementation complies with" : "The implementation fulfils"} ${r.id}: ${r.description.trim()}`,
        expectedResult: extractExpectedResult(r.description),
        scopeStatus: "in_scope",
        covers: [r.id],
      });
    }
  } else {
    const groups = new Map<string, ProjectRequirement[]>();
    for (const r of uncovered) {
      const section = r.sourceReference.replace(/\s*\(line \d+\)$/i, "") || "Specification";
      groups.set(section, [...(groups.get(section) ?? []), r]);
    }
    for (const [section, items] of groups) {
      criteria.push({
        id: nextId(),
        title: `All in-scope items from ${section}`.slice(0, 100),
        description: `Every item from ${section} is implemented and works as specified: ${items.map((r) => `${r.id} ${r.title}`).join("; ")}`.slice(0, 4000),
        expectedResult: `${items.length} item(s) from ${section} are implemented and verified.`,
        scopeStatus: "in_scope",
        covers: items.map((r) => r.id),
      });
    }
  }

  if (criteria.length === 0) {
    const cleanTask = taskText.trim();
    criteria.push({
      id: "AC-1",
      title: cleanTask.split(/\r?\n/)[0].slice(0, 80),
      description: cleanTask,
      expectedResult: `Fully implements and satisfies: ${cleanTask.slice(0, 300)}`,
      scopeStatus: "in_scope",
      covers: [],
    });
  }
  return criteria;
}

