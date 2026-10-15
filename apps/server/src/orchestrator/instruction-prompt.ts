import path from "node:path";
import type { RequirementInventory, ProjectRequirement } from "../domain/requirements/requirement-inventory.js";
import { normalizeRequirementText } from "../domain/requirements/requirement-inventory.js";
import type { PromptFidelityReport } from "./prompt-fidelity-gate.js";
import type { InstructionContext, IterationEvidence } from "./instructor.js";

/**
 * The instruction prompt Orches sends the reasoning model each iteration, and the checks applied to the
 * brief it returns. One document, fixed section order, every fact stated once:
 * task → user's sources (verbatim) → requirement register → workspace → results so far → what the brief
 * must contain → reply format.
 */

export const INSTRUCTION_SYSTEM = `You are the technical lead in Orches, an automated development loop. Each turn you write the engineering brief that the Antigravity coding agent executes in the user's workspace. The agent has full access to the files and a terminal and follows your brief literally, so the brief must be complete, specific and unambiguous. You do not write the code. Orches runs the project's checks afterwards and a separate review judges the result against the acceptance criteria.`;

const VERBATIM_SOURCE_LIMIT = 200_000;

const MODE_LINE: Record<string, string> = {
  creative_within_constraints: "Choose clean, robust solutions within the register and the existing architecture.",
  creative_exploration: "You may choose a better design than the sources suggest where they allow it; state the trade-off. MUST items and constraints are fixed.",
  strict_blueprint_adherence: "Implement exactly the register: no extra features, no restructuring beyond what it requires.",
};

type Stage = "implementation" | "repair" | "audit" | "audit_remediation";

function stageOf(ctx: InstructionContext): Stage {
  if (ctx.stage === "audit") return "audit";
  if (ctx.stage === "audit_remediation") return "audit_remediation";
  return ctx.iteration > 1 ? "repair" : "implementation";
}

const STAGE_LABEL: Record<Stage, string> = {
  implementation: "IMPLEMENTATION",
  repair: "REPAIR",
  audit: "AUDIT",
  audit_remediation: "AUDIT REMEDIATION",
};

const STAGE_TASK: Record<Stage, string> = {
  implementation: "Write the engineering brief the coding agent follows to implement every in-scope requirement in this workspace.",
  repair: "The previous attempt was not accepted (see Results so far). Write the brief that fixes every listed problem and completes any remaining in-scope requirement, building on the existing files.",
  audit: "The implementation passed review. Write the brief that has the coding agent audit the complete workspace against the requirement register and report its findings, without changing any files.",
  audit_remediation: "The audit found defects (see Audit report). Write the brief that fixes every defect and re-verifies the result.",
};

function fence(text: string): string {
  return `"""\n${text.trim()}\n"""`;
}

function clip(text: string, max: number): string {
  const t = (text || "").trim();
  return t.length > max ? `${t.slice(0, max)}\n…(${t.length - max} more characters)` : t;
}

// ------------------------------------------------------------------------------------------------
// Requirement register
// ------------------------------------------------------------------------------------------------

const PRIORITY: Record<string, string> = { high: "MUST", critical: "MUST", medium: "SHOULD", low: "COULD" };

function statusTag(r: ProjectRequirement, showStatus: boolean): string {
  if (!showStatus || r.status === "not_started") return "";
  return ` [${r.status.replace(/_/g, " ")}]`;
}

/** The register as compact Markdown lists (used by the instruction prompt, the review prompt and the agent reference). */
export function formatRegister(inv: RequirementInventory, opts: { showStatus?: boolean; includeSources?: boolean } = {}): string {
  const inScope = (r: ProjectRequirement) => !r.scopeStatus || r.scopeStatus === "in_scope";
  const reqs = inv.requirements.filter((r) => inScope(r) && ["mandatory_requirement", "optional_requirement", "reasonable_inference"].includes(r.classification));
  const cons = inv.requirements.filter((r) => inScope(r) && r.classification === "explicit_constraint");
  const acs = inv.requirements.filter((r) => inScope(r) && r.classification === "acceptance_criterion");
  const out = inv.requirements.filter((r) => r.scopeStatus === "out_of_scope" || r.scopeStatus === "deferred" || r.scopeStatus === "safety_conflict");
  const qs = inv.requirements.filter((r) => r.classification === "unresolved_contradiction" || r.contradictionDetails);
  const src = (r: ProjectRequirement) => (opts.includeSources && r.sourceReference ? ` (source: ${r.sourceReference})` : "");

  const lines: string[] = [];
  if (inv.goal) lines.push(`Goal: ${inv.goal}`, "");
  lines.push("Requirements:");
  lines.push(
    ...(reqs.length
      ? reqs.map((r) => {
          const p = r.classification === "optional_requirement" ? "COULD" : r.classification === "reasonable_inference" ? "INFERRED" : PRIORITY[r.importance] ?? "MUST";
          return `- ${r.id} [${p}]${statusTag(r, !!opts.showStatus)} ${r.description}${src(r)}`;
        })
      : ["- (none)"])
  );
  lines.push("", "Constraints (never violate):");
  lines.push(...(cons.length ? cons.map((r) => `- ${r.id}${statusTag(r, !!opts.showStatus)} ${r.description}${src(r)}`) : ["- (none)"]));
  if (acs.length) {
    lines.push("", "Acceptance criteria:");
    lines.push(...acs.map((r) => `- ${r.id}${statusTag(r, !!opts.showStatus)} ${r.description}${r.covers?.length ? ` (covers ${r.covers.join(", ")})` : ""}`));
  }
  if (out.length) {
    lines.push("", "Out of scope (do not build):");
    lines.push(...out.map((r) => `- ${r.id} ${r.description}${r.scopeConflictReason ? ` — ${r.scopeConflictReason}` : ""}`));
  }
  if (qs.length) {
    lines.push("", "Open questions (use the stated assumption):");
    lines.push(
      ...qs.map((r) =>
        r.classification === "unresolved_contradiction"
          ? `- ${r.id} ${r.description}${r.assumption ? ` → assume: ${r.assumption}` : ""}`
          : `- ${r.id} may conflict with: "${r.contradictionDetails!.conflictingText}" → decide and state the choice.`
      )
    );
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------
// Results so far
// ------------------------------------------------------------------------------------------------

function tail(text: string, lines: number): string {
  const all = (text || "").split(/\r?\n/);
  return all.slice(-lines).join("\n");
}

function formatIteration(h: IterationEvidence): string {
  const out: string[] = [`### Iteration ${h.iteration} (agent state: ${h.agentState})`];
  out.push(`Agent report: ${clip(h.agentReply || "(none)", 2500)}`);
  out.push(`Files changed since the run started: ${h.changedFiles.join(", ") || "none"}`);
  out.push("Checks run by Orches:");
  out.push(
    ...(h.checks.length
      ? h.checks.map((c) => `- ${c.label}: ${c.status}${c.status !== "passed" && c.output ? `\n\`\`\`\n${tail(c.output, 40)}\n\`\`\`` : ""}`)
      : ["- none"])
  );
  if (h.reviewVerdict) {
    out.push(`Review: ${h.reviewVerdict.toUpperCase()}${h.reviewSummary ? ` — ${h.reviewSummary}` : ""}`);
    for (const c of h.criteriaResults ?? []) if (c.status !== "passed") out.push(`- ${c.id} ${c.status}: ${c.reason}`);
    for (const f of h.findings ?? []) out.push(`- finding [${f.severity}]: ${f.message}`);
    for (const r of h.repairInstructions ?? []) out.push(`- requested fix: ${r}`);
  } else if (h.reviewer) {
    out.push(`Review: ${h.reviewer}`);
  }
  if (h.blockers.length) out.push(`Not accepted because:\n${h.blockers.map((b) => `- ${b}`).join("\n")}`);
  if (h.diffExcerpt) out.push(`Diff excerpt:\n\`\`\`diff\n${clip(h.diffExcerpt, 6000)}\n\`\`\``);
  return out.join("\n");
}

function formatHistory(history: IterationEvidence[]): string {
  if (!history.length) return "";
  const latest = history[history.length - 1];
  const earlier = history.slice(0, -1).map((h) => `- Iteration ${h.iteration}: ${h.reviewVerdict ? `review ${h.reviewVerdict}` : h.agentState}; ${h.blockers.length ? `not accepted (${clip(h.blockers.join("; "), 300)})` : "accepted"}`);
  return [formatIteration(latest), ...(earlier.length ? ["", "Earlier iterations:", ...earlier] : [])].join("\n");
}

// ------------------------------------------------------------------------------------------------
// Brief requirements per stage
// ------------------------------------------------------------------------------------------------

function briefRequirements(stage: Stage, checks: string): string {
  const report = "Final report: tell the agent to end with the files created or changed, every command run with its result, each acceptance criterion ID with pass/fail and evidence, and anything not done.";
  switch (stage) {
    case "implementation":
      return [
        "1. Objective and definition of done.",
        "2. Technical design: stack and versions (obeying every constraint), directory structure and key files, components and their responsibilities, data model, interfaces (routes or functions with inputs, outputs and error behaviour).",
        "3. Implementation steps, ordered. Each step names the files to create or change, what to build, and the requirement IDs it satisfies.",
        "4. Traceability: every in-scope R- and C- ID with the step(s) that satisfy it. None may be missing.",
        "5. Rules: the constraints as rules; nothing outside the register; no placeholders, TODOs or stub-only code; no secrets in code.",
        `6. Tests and verification: tests for each acceptance criterion (named after its AC ID), the exact commands to run (Orches runs: ${checks}), and the expected results.`,
        "7. Assumptions used for the open questions.",
        `8. ${report}`,
      ].join("\n");
    case "repair":
      return [
        "1. Diagnosis: for each failing check, failed criterion, finding and blocking issue in Results so far, the root cause (file, function, reason).",
        "2. Fixes: ordered, precise changes per file. Keep what works; do not rewrite unrelated code or start over.",
        "3. Remaining work: in-scope IDs that are still not done, with steps.",
        `4. Verification: commands to run (Orches runs: ${checks}); the previously failing tests and criteria must pass.`,
        `5. ${report}`,
      ].join("\n");
    case "audit":
      return [
        "1. Audit only: the agent must not modify any file.",
        `2. Run ${checks} and report the results.`,
        "3. Verify every acceptance criterion and constraint with evidence (file paths, test output).",
        "4. Review correctness, error handling, security, performance, maintainability, test coverage and build/run readiness.",
        "5. Report format: first line `READINESS_VERDICT: READY` or `READINESS_VERDICT: DEFECTS_DETECTED`; then each finding with severity (critical/high/medium/low), file path and the fix needed; then each AC ID with pass/fail and evidence.",
      ].join("\n");
    case "audit_remediation":
      return [
        "1. Fix every defect from the audit report, highest severity first, naming the file and the change.",
        "2. Change nothing else.",
        `3. Verification: commands to run (Orches runs: ${checks}); re-check each fixed defect.`,
        `4. ${report}`,
      ].join("\n");
  }
}

// ------------------------------------------------------------------------------------------------
// Prompt
// ------------------------------------------------------------------------------------------------

export function buildInstructionPromptV2(ctx: InstructionContext, inventory: RequirementInventory): string {
  const stage = stageOf(ctx);
  const includeSources = stage === "implementation" || stage === "audit";
  const checks = ctx.profile.checks.map((c) => `\`${c.label}\``).join(", ");
  const checksText = checks || "none yet — the agent must add a runnable test command (e.g. an npm \"test\" script or pytest)";
  const checksShort = checks || "the test command the agent adds";
  const s: string[] = [];

  s.push(`# Orches request — iteration ${ctx.iteration} of ${ctx.maxIterations} — ${STAGE_LABEL[stage]}`);
  s.push("", "## Your task now", STAGE_TASK[stage]);

  // User sources, verbatim.
  s.push("", "## User request (verbatim)", fence(ctx.taskText));
  const objective = ctx.projectObjective?.trim();
  if (objective && objective !== ctx.taskText.trim()) s.push("", "## Project specification (verbatim)", fence(objective));
  const docs = ctx.blueprintDocuments ?? [];
  if (docs.length) {
    if (includeSources) {
      let budget = VERBATIM_SOURCE_LIMIT;
      for (const d of docs) {
        const text = d.extractedText.trim();
        s.push("", `## Blueprint: ${d.filename} (verbatim)`, fence(text.length > budget ? `${text.slice(0, budget)}\n…(truncated; the requirement register covers the full document)` : text));
        budget = Math.max(0, budget - text.length);
      }
    } else {
      s.push("", "## Blueprints", `${docs.map((d) => d.filename).join(", ")} — provided in full earlier in this run; the register below is derived from them.`);
    }
  }

  // Register.
  const origin = inventory.origin === "analysis" || inventory.origin === "cache" ? "from your requirements analysis, checked by Orches" : "from Orches' scan of the user's sources";
  s.push("", `## Requirement register (${origin}; IDs are stable for this run)`, formatRegister(inventory, { showStatus: ctx.iteration > 1 }));
  if (ctx.adoptedScope) s.push("", "## Agreed scope", `You declined part of the request earlier and offered this instead. Stay strictly within it:\n${clip(ctx.adoptedScope, 2000)}`);

  // Workspace.
  const p = ctx.profile;
  s.push(
    "",
    "## Workspace",
    `- Folder: ${p.rootPath ? path.basename(p.rootPath) : "(project folder)"}`,
    `- State: ${p.isEmpty ? "empty (new project)" : `${p.fileCount} files; languages: ${p.languages.join(", ") || "unknown"}; manifests: ${p.manifests.join(", ") || "none"}`}`,
    `- Checks Orches runs after the agent finishes: ${checksText}`,
    `- Files: ${ctx.files.length ? ctx.files.slice(0, 200).join(", ") + (ctx.files.length > 200 ? ", …" : "") : "(none)"}`
  );

  const style: string[] = [];
  style.push(MODE_LINE[ctx.autonomyMode ?? "creative_within_constraints"] ?? MODE_LINE.creative_within_constraints);
  if (ctx.profileDefinition) style.push(...ctx.profileDefinition.engineeringGuidelines.map((g) => g.replace(/\.\s*$/, "")));
  s.push("", "## Working style", ...style.map((x) => `- ${x}`));

  if (ctx.history.length) s.push("", "## Results so far", formatHistory(ctx.history));
  if (stage === "audit_remediation" && ctx.auditReport) s.push("", "## Audit report", clip(ctx.auditReport, 12_000));
  if (ctx.memoryContextSection?.trim()) s.push("", "## Memory from earlier runs on this project", clip(ctx.memoryContextSection, 4000));
  if (ctx.guidance?.length) s.push("", "## Operator guidance", ...ctx.guidance.map((g) => `- ${g}`));

  s.push("", "## The brief must contain", briefRequirements(stage, checksShort));
  s.push(
    "",
    "## Reply format",
    "ORCHES_STATUS: INSTRUCT",
    "[ORCHES_ANTIGRAVITY_INSTRUCTION]",
    "# Implementation Mission",
    "<the brief, in Markdown>",
    "[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
    "",
    "If the work must not proceed, reply instead:",
    "ORCHES_STATUS: STOP",
    "Reason: <why>",
    "",
    "Write the brief itself: no preamble, no plan for a plan, no full source files (signatures and short snippets are fine). Use the register IDs."
  );
  return s.join("\n");
}

// ------------------------------------------------------------------------------------------------
// Brief coverage check
// ------------------------------------------------------------------------------------------------

const STOP = new Set(["that", "this", "with", "from", "must", "shall", "should", "will", "have", "when", "into", "each", "their", "they", "your", "only", "also", "than", "then", "them", "been", "being", "able", "user", "users", "system", "using", "used", "make", "made"]);

function mentionsId(briefLower: string, id: string): boolean {
  const m = id.match(/^([A-Z]+)-(\d+)$/i);
  if (!m) return briefLower.includes(id.toLowerCase());
  return new RegExp(`\\b${m[1].toLowerCase()}-?0*${m[2]}\\b`).test(briefLower);
}

function covered(briefNorm: string, briefLower: string, r: ProjectRequirement): boolean {
  if (mentionsId(briefLower, r.id)) return true;
  const words = normalizeRequirementText(r.description).split(" ").filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOP.has(w));
  if (!words.length) return true;
  const hit = words.filter((w) => briefNorm.includes(` ${w}`)).length;
  return hit >= Math.max(1, Math.ceil(words.length * 0.6));
}

/** In-scope must-requirements and constraints the brief neither references by ID nor describes. */
export function checkBriefCoverage(brief: string, inventory: RequirementInventory): { missing: ProjectRequirement[]; report: PromptFidelityReport } {
  const briefLower = brief.toLowerCase();
  const briefNorm = ` ${normalizeRequirementText(brief)} `;
  const targets = inventory.requirements.filter(
    (r) =>
      (!r.scopeStatus || r.scopeStatus === "in_scope") &&
      (r.classification === "explicit_constraint" || (r.classification === "mandatory_requirement" && r.importance !== "low"))
  );
  const traceabilityMap = targets.map((r) => ({ requirementId: r.id, title: r.title, classification: r.classification, isMapped: covered(briefNorm, briefLower, r) }));
  const missing = targets.filter((_, i) => !traceabilityMap[i].isMapped);
  const score = targets.length ? Math.round(((targets.length - missing.length) / targets.length) * 100) : 100;
  return {
    missing,
    report: {
      passed: missing.length === 0,
      score,
      missingRequirements: missing.map((r) => ({ id: r.id, title: r.title, importance: r.importance, reason: "Not referenced or described in the brief." })),
      weakenedConstraints: [],
      unsupportedAdditions: [],
      unresolvedContradictions: [],
      traceabilityMap,
      summary: missing.length
        ? `Brief covers ${targets.length - missing.length} of ${targets.length} in-scope requirements and constraints; missing: ${missing.map((r) => r.id).join(", ")}.`
        : `Brief covers all ${targets.length} in-scope requirements and constraints.`,
    },
  };
}

export function buildCoverageAmendment(missing: ProjectRequirement[]): string {
  return [
    "Your brief does not cover these in-scope items:",
    ...missing.map((r) => `- ${r.id} ${r.description}`),
    "",
    "Reply with the complete revised brief (not only the additions) in the same format, covering every in-scope requirement and constraint.",
  ].join("\n");
}

// ------------------------------------------------------------------------------------------------
// Reference appended to the brief for the coding agent
// ------------------------------------------------------------------------------------------------

/**
 * Context Orches appends after the reasoning model's brief (it never edits the brief): the register and
 * the user's request, so the agent can check its work against the source. With an agreed narrower scope,
 * only that scope is given — the declined original request is not passed on.
 */
export function buildAgentReference(inventory: RequirementInventory, taskText: string, adoptedScope?: string): string {
  if (adoptedScope) {
    return ["", "---", "## Reference from Orches", "### Agreed scope (implement only this)", clip(adoptedScope, 2000)].join("\n");
  }
  return [
    "",
    "---",
    "## Reference from Orches",
    "### Requirement register",
    formatRegister(inventory),
    "",
    "### Original user request (verbatim)",
    fence(clip(taskText, 12_000)),
  ].join("\n");
}
