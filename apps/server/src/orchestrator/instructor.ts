import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";
import { ResponseReader } from "../providers/reasoning/chatgpt-web/response-reader.js";
import {
  isTaskDescriptor,
  isMetaInstruction,
  isUnderSpecified,
  isThoughtOrStatusFragment,
  validateInstructionSubstance,
} from "../prompts/instruction-validator.js";
import type { ProjectProfile } from "../workspace/project-inspector.js";
import type { ProjectProfileDefinition } from "../domain/profiles/project-profiles.js";
import type { AutonomyMode } from "@orchestrator/shared-types";
import type { CandidateRequirement } from "../domain/blueprints/requirement-extractor.js";
import type { ImportedDocument } from "../domain/blueprints/importer.js";
import {
  buildRequirementInventory,
  type RequirementInventory,
  type ProjectRequirement,
} from "../domain/requirements/requirement-inventory.js";
import {
  validateAndCorrectPrompt,
  type PromptFidelityReport,
} from "./prompt-fidelity-gate.js";
import { calculateContextBudget, estimateTokens } from "../domain/memory/context-budget.js";
import type { AuthoritativeTaskContext } from "./task-context.js";

export {
  isTaskDescriptor,
  isMetaInstruction,
  isUnderSpecified,
  validateInstructionSubstance,
};

export interface IterationEvidence {
  iteration: number;
  instruction: string;
  agentReply: string;
  agentState: string;
  changedFiles: string[];
  diffExcerpt: string;
  checks: Array<{ label: string; status: string; output: string }>;
  blockers: string[];
  reviewer: string;
}

export interface InstructionContext {
  projectId: string;
  runId: string;
  taskText: string;
  projectObjective?: string;
  criteria: string[];
  profile: ProjectProfile;
  profileDefinition?: ProjectProfileDefinition;
  autonomyMode?: AutonomyMode;
  blueprintDocuments?: ImportedDocument[];
  blueprintRequirements?: CandidateRequirement[];
  requirementInventory?: RequirementInventory;
  taskContext?: AuthoritativeTaskContext;
  files: string[];
  iteration: number;
  maxIterations: number;
  history: IterationEvidence[];
  guidance?: string[];
  signal?: AbortSignal;
  memorySnapshotMarkdown?: string;
  memoryContextSection?: string;
}

export interface Instruction {
  action: "instruct" | "stop";
  instruction: string;
  rationale: string;
  source: "model" | "fallback";
  warning?: string;
  fidelityReport?: PromptFidelityReport;
  initialFidelityReport?: PromptFidelityReport;
  residualUncertainties?: string[];
}

const SYSTEM = `ROLE:
You are the Systems Architect, Technical Lead, and reasoning component of Orches directing the native Antigravity development agent operating in the workspace.
Your responsibility is to synthesize the comprehensive, production-grade Implementation Prompt (Master Engineering Brief) in Markdown that the Antigravity Agent will directly read and execute.
You must reason about the real engineering problem and produce a substantive, concrete engineering instruction for the current iteration.

CRITICAL DIRECTIVES:
1. PRODUCE A SUBSTANTIVE ENGINEERING INSTRUCTION:
   Do not merely produce a task title, acceptance-criteria JSON, file list, or high-level plan.
   Do not output meta-instructions telling the agent to "construct a brief", "write a plan", "draft a proposal", or "implement according to guidelines".
   You must reason about the actual project and current iteration, then return a complete, substantive, directly actionable engineering instruction.
2. PRESERVE THE USER'S SPECIFICATION AS YOUR SOURCE OF TRUTH:
   - Preserve all explicit functional requirements and non-functional requirements.
   - Preserve specified technology stacks, versions, database engines, and architectural boundaries.
   - Clearly distinguish explicit user requirements from derived implementation assumptions.
   - If requirements appear contradictory, surface the ambiguity under "Unresolved Questions" rather than silently inventing an arbitrary choice.
   - Do not invent project requirements or ungrounded external dependencies not established by the source.
3. SPECIFY IMPLEMENTATION, INTEGRATION, AND VERIFICATION:
   - Specify relevant implementation, integration, and verification expectations.
   - DO NOT write the source code yourself. DO NOT output full copy-paste source files or micro-manage single file contents. The agent is a capable engineer that will independently inspect existing code conventions, edit files, and run tests.
   - When addressing feedback from a previous iteration, conduct a root-cause analysis of the shortcomings, test outputs, and reviewer requests provided in the iteration history, and provide targeted corrective guidance.

ROUTING & OUTPUT CONTRACT:
You must reply using the Orches text-based routing protocol. Do NOT return a JSON object. Do NOT wrap your response in JSON.

For a successful instruction response, you MUST output this exact structure:
ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]

# Implementation Mission

<The complete, project-specific substantive engineering brief in Markdown>

[/ORCHES_ANTIGRAVITY_INSTRUCTION]

For an operation that must stop:
ORCHES_STATUS: STOP

Reason: <A concise and truthful explanation of why the operation cannot proceed and, where appropriate, a safe alternative>

CRITICAL PROTOCOL RULES:
- The substantive engineering brief must be Markdown and natural language.
- Do NOT return a JSON envelope or task descriptor around the engineering brief.
- Do NOT return only a task title, short summary, task descriptor, or generic plan.
- The content inside [ORCHES_ANTIGRAVITY_INSTRUCTION] must contain the complete, actionable engineering brief with concrete objectives, architecture guidance, functional requirements with [REQ-xxx] traceability, implementation boundaries, and automated verification expectations.`;

export const MODE_DIRECTIVES: Record<AutonomyMode, string> = {
  creative_within_constraints: `MODE: Creative within constraints (Default).
Encourage innovative, robust, and clean technical solutions while strictly adhering to user requirements, existing project architecture, technical boundaries, and safety policies. Suggest modern patterns, effective abstractions, and algorithms while respecting the requested scope.`,
  creative_exploration: `MODE: Creative exploration (Soft constraints).
Grant greater autonomy in architectural design, technical approach, and alternative exploration. Requirements designated as preferences or soft constraints may be reconsidered if a superior, cleaner, or more performant alternative exists. Articulate trade-offs and rationale clearly. Mandatory core objectives and workspace safety remain strictly non-negotiable.`,
  strict_blueprint_adherence: `MODE: Strict instruction & blueprint adherence.
Prioritize exact, faithful implementation of the user's explicit requirements and blueprint specifications. Strictly discourage unsolicited features, speculative redesigns, scope expansion, or unrequested architectural restructuring. Fulfill the exact acceptance criteria with minimal, targeted changes.`,
};

/**
 * Expands high-level project tasks into concrete domain architecture, workflows,
 * and business rules without relying on ungrounded hardcoded hardware or proprietary code.
 */
export function synthesizeDomainDetails(taskText: string, profileId?: string): {
  entities: string[];
  workflows: string[];
  businessRules: string[];
  interfaces: string[];
} {
  const lower = taskText.toLowerCase();

  if (lower.includes("library") && (lower.includes("management") || lower.includes("system") || lower.includes("book"))) {
    return {
      entities: [
        "**Book**: `id`, `title`, `author`, `isbn`, `genre`, `published_year`, `total_copies`, `available_copies`",
        "**Member**: `id`, `name`, `email`, `phone`, `membership_date`, `status` (`active`, `suspended`), `active_loans_count`",
        "**Loan / Checkout**: `id`, `book_id`, `member_id`, `checkout_date`, `due_date`, `return_date`, `status` (`borrowed`, `returned`, `overdue`)",
      ],
      workflows: [
        "**Catalog Management**: Add new books, update catalog records, search catalog by title/author/genre, inspect real-time availability.",
        "**Member Management**: Register library members, view borrowing history, validate membership status.",
        "**Circulation (Checkout)**: Validate member status and loan limits; check `available_copies > 0`; create loan record; decrement `available_copies`.",
        "**Circulation (Return)**: Mark loan as returned, record return timestamp, calculate overdue duration and fines if applicable, increment `available_copies`.",
        "**Dashboard & Inventory**: Summary statistics for total books, active loans, overdue items, and registered members.",
      ],
      businessRules: [
        "Zero-Copy Rejection: A book with `available_copies === 0` cannot be checked out.",
        "Loan Limit: Members with overdue books or exceeding loan allowance cannot checkout new items.",
        "ISBN Integrity: Duplicate ISBN entries must be rejected or update existing inventory copies.",
        "Date Tracking: Return dates must be verified against due dates for overdue detection.",
      ],
      interfaces: [
        "API / Service endpoints: `GET /api/books`, `POST /api/books`, `GET /api/members`, `POST /api/members`, `POST /api/loans/checkout`, `POST /api/loans/return`, `GET /api/dashboard`",
      ],
    };
  }

  if (lower.includes("auth") || lower.includes("jwt") || lower.includes("login") || lower.includes("user")) {
    return {
      entities: [
        "**User**: `id`, `email`, `password_hash`, `role`, `created_at`, `status`",
        "**Session / Token**: `id`, `user_id`, `token`, `expires_at`, `revoked`",
      ],
      workflows: [
        "**Registration**: Validate email uniqueness and password complexity, hash password with secure algorithm, store user.",
        "**Authentication**: Verify credentials, issue secure JWT / session token with appropriate expiration.",
        "**Protected Route Guard**: Middleware validating token signature and user active status; returns 401 on missing/expired token.",
      ],
      businessRules: [
        "Never store plaintext passwords.",
        "Return generic authentication failure messages to prevent user enumeration.",
        "Token expiration and revocation must be strictly enforced.",
      ],
      interfaces: [
        "API endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`",
      ],
    };
  }

  // Universal fallback for any software domain
  return {
    entities: [
      `Domain entities tailored to ${taskText.slice(0, 60)} with unambiguous primary keys, audit timestamps, and field validations.`,
    ],
    workflows: [
      "Core operations: Create, Query, Update, Process with appropriate boundary validations.",
      "Primary business transaction flow fulfilling the user's requested outcome.",
    ],
    businessRules: [
      "Input validation on all external boundaries.",
      "Safe state transitions and integrity constraints.",
    ],
    interfaces: [
      "Clean API or module contracts with structured responses and standard error handling.",
    ],
  };
}

/**
 * Synthesizes a comprehensive, source-faithful Engineering Implementation Brief
 * directly from the requirement inventory and specification inputs.
 */
export function synthesizeSubstantiveBrief(ctx: InstructionContext, inventory: RequirementInventory, reason?: string): string {
  const title = ctx.taskText.trim().split(/\r?\n/)[0].replace(/^#+\s*/, "").slice(0, 80) || "Project Implementation";
  const domain = synthesizeDomainDetails(ctx.taskText, ctx.profileDefinition?.id);
  const mode = ctx.autonomyMode ?? "creative_within_constraints";
  const modeDirective = MODE_DIRECTIVES[mode] || MODE_DIRECTIVES.creative_within_constraints;

  const checks = ctx.profile.checks.map((c) => c.label).join(", ") || "none detected (standard file and syntax validation)";

  const sections: string[] = [];

  sections.push(`# ${title} — Implementation Engineering Brief`);
  sections.push("");
  sections.push("## 1. Executive Objective & Scope");
  sections.push(ctx.taskText.trim());

  if (ctx.projectObjective && ctx.projectObjective.trim() && ctx.projectObjective.trim() !== ctx.taskText.trim()) {
    sections.push("");
    sections.push("### Universal Project Specification & Instructions (Authoritative)");
    sections.push(ctx.projectObjective.trim());
  }

  sections.push("");
  sections.push("## 2. Working Instructions for Antigravity Agent");
  sections.push("- **Workspace Confinement**: Work exclusively within the project workspace. Never edit files outside it.");
  sections.push("- **Independent Inspection**: Inspect existing workspace files, configuration, and conventions before editing.");
  sections.push("- **Cohesive Implementation**: Implement the functionality as an integrated whole using your native file-editing tools.");
  sections.push("- **Deterministic Verification**: Run the project's automated tests and checks to verify your work before concluding.");
  sections.push("- **Environment Safety**: Do not commit, switch branches, or edit `.env` secrets.");

  sections.push("");
  sections.push("## 3. Preserved Constraints & Architecture Boundaries");
  const constraints = inventory.requirements.filter((r) => r.classification === "explicit_constraint");
  if (constraints.length > 0) {
    for (const c of constraints) {
      sections.push(`- **[${c.id}]** STRICT CONSTRAINT: ${c.description} *(Ref: ${c.sourceReference})*`);
    }
  } else {
    sections.push("- Adhere to workspace file conventions, existing manifests, and clean modular boundaries.");
  }
  if (ctx.profile.languages.length > 0) {
    sections.push(`- Workspace Language & Environment: ${ctx.profile.languages.join(", ")}`);
  }
  if (ctx.profileDefinition) {
    sections.push(`- **Profile Guidelines (${ctx.profileDefinition.name})**: ${ctx.profileDefinition.engineeringGuidelines.join("; ")}`);
  }
  sections.push(`- **Autonomy Directive**: ${modeDirective}`);

  if (ctx.blueprintRequirements && ctx.blueprintRequirements.length > 0) {
    sections.push("");
    sections.push("## 4. Master Blueprint Requirements");
    for (const b of ctx.blueprintRequirements) {
      sections.push(`- **[${b.id}]** (${b.provenanceKind}) ${b.title}: ${b.description}`);
    }
  }

  sections.push("");
  sections.push("## 5. Functional Specifications & Domain Workflows");
  sections.push("### Core Domain Entities");
  domain.entities.forEach((e) => sections.push(`- ${e}`));
  sections.push("");
  sections.push("### Operational Workflows");
  domain.workflows.forEach((w) => sections.push(`- ${w}`));
  sections.push("");
  sections.push("### Business Rules & Integrity Constraints");
  domain.businessRules.forEach((b) => sections.push(`- ${b}`));

  // Distinguish active in-scope requirements from safety-conflicted, out-of-scope, or deferred items
  const activeConstraints = constraints.filter((c) => c.scopeStatus !== "safety_conflict" && c.scopeStatus !== "out_of_scope");
  const conflictedItems = inventory.requirements.filter((r) => r.scopeStatus === "safety_conflict");

  const mandatory = inventory.requirements.filter(
    (r) =>
      r.classification === "mandatory_requirement" &&
      r.scopeStatus !== "safety_conflict" &&
      r.scopeStatus !== "out_of_scope"
  );
  if (mandatory.length > 0) {
    sections.push("");

    // Phased / volume management: if large (> 40) or multiple phases exist
    const hasPhases = inventory.summary.phases && inventory.summary.phases.length > 1;
    const isLarge = mandatory.length > 40;

    if (hasPhases || isLarge) {
      const activePhase = inventory.summary.phases?.find((p) => ctx.taskText.toLowerCase().includes(p.toLowerCase())) || inventory.summary.phases?.[0];
      const activeMandatory = activePhase
        ? mandatory.filter((m) => m.phase === activePhase)
        : mandatory.slice(0, 40);
      const deferredMandatory = mandatory.filter((m) => !activeMandatory.includes(m));

      sections.push(`### Explicit Specification Requirements (${activePhase ? `Active: ${activePhase}` : "Immediate Implementation Scope"})`);
      for (const m of activeMandatory) {
        sections.push(`- **[${m.id}]** (${m.importance}) ${m.title}: ${m.description} *(Ref: ${m.sourceReference})*`);
      }

      if (deferredMandatory.length > 0) {
        sections.push("");
        sections.push("### Phased Implementation Roadmap & Retained Scope");
        sections.push(`> [!NOTE] Specification Volume Notice: The project specification contains ${inventory.summary.total} requirements across ${inventory.summary.phases?.length || "multiple"} phases. To maintain focus within model context limits, this engineering brief specifies active scope (${activeMandatory.length} requirements) and all global architecture constraints. Remaining requirements (${deferredMandatory.length}) are fully retained in the requirement inventory for subsequent phases and iterations.`);
        
        const deferredByPhase = new Map<string, ProjectRequirement[]>();
        for (const d of deferredMandatory) {
          const k = d.phase || "Subsequent Iterations";
          const list = deferredByPhase.get(k) || [];
          list.push(d);
          deferredByPhase.set(k, list);
        }

        for (const [phaseName, reqs] of deferredByPhase) {
          const sample = reqs.slice(0, 5).map((r) => `[${r.id}] ${r.title}`).join("; ");
          sections.push(`- **${phaseName}** (${reqs.length} requirements): ${sample}${reqs.length > 5 ? ` ... (+${reqs.length - 5} more)` : ""}`);
        }
      }
    } else {
      sections.push("### Explicit Specification Requirements");
      for (const m of mandatory) {
        sections.push(`- **[${m.id}]** (${m.importance}) ${m.title}: ${m.description} *(Ref: ${m.sourceReference})*`);
      }
    }
  }

  const optional = inventory.requirements.filter((r) => r.classification === "optional_requirement");
  if (optional.length > 0) {
    sections.push("");
    sections.push("### Optional Enhancements & Non-Binding Inferences");
    for (const o of optional) {
      sections.push(`- **[${o.id}]** (Optional) ${o.title}: ${o.description}`);
    }
  }

  if (conflictedItems.length > 0) {
    sections.push("");
    sections.push("## Scope Safety Boundaries & Excluded Operational Scope");
    sections.push("The following requirements from source materials conflict with authorized safety boundaries or declared simulation scope and are EXCLUDED from active implementation:");
    for (const c of conflictedItems) {
      sections.push(`- **[${c.id}]** (Excluded / Conflict): ${c.title} — *${c.scopeConflictReason || "Excluded from authorized scope."}*`);
    }
  }

  const contradictions = inventory.requirements.filter((r) => r.classification === "unresolved_contradiction");
  if (contradictions.length > 0) {
    sections.push("");
    sections.push("## 6. Unresolved Specification Contradictions & Ambiguities");
    sections.push("The source specification contains the following conflicting instructions. Exercise safe, non-destructive behavior and do not assume unverified requirements:");
    for (const c of contradictions) {
      sections.push(`- **[${c.id}]** ${c.title}: ${c.description} (Conflict noted with: ${c.contradictionDetails?.conflictingSource || "other section"})`);
    }
  }

  sections.push("");
  sections.push("## 7. Implementation Touchpoints");
  sections.push("Inspect the workspace layout to locate relevant entry points, routes, models, views, and test suites. Coordinate the necessary modifications across these components to deliver a fully functional system.");

  sections.push("");
  sections.push("## 8. Verification Strategy & Acceptance Criteria");
  const criteria = inventory.requirements.filter((r) => r.classification === "acceptance_criterion");
  if (criteria.length > 0) {
    sections.push("### Specification Acceptance Criteria:");
    criteria.forEach((c) => sections.push(`- **[${c.id}]** ${c.description}`));
  } else if (ctx.criteria.length > 0) {
    sections.push("### Concrete Acceptance Criteria:");
    ctx.criteria.forEach((c, i) => sections.push(`${i + 1}. ${c}`));
  }
  sections.push(`### Automated Verification Checks: ${checks}`);
  sections.push("Ensure all unit and integration tests pass cleanly with exit code 0.");

  sections.push("");
  sections.push("## 9. Definition of Done");
  sections.push("The task is complete when all domain workflows operate as specified, required routes/APIs respond correctly, edge cases and validations are covered, and all automated checks pass cleanly.");

  return sections.join("\n");
}

/**
 * Synthesizes a targeted, evidence-driven corrective brief for iterations > 1.
 * Focuses on actual workspace changes, failing assertions, and incomplete requirements.
 */
export function synthesizeRepairBrief(ctx: InstructionContext, inventory: RequirementInventory): string {
  const lastFailure = ctx.history[ctx.history.length - 1];
  const sections: string[] = [];

  sections.push(`# Corrective Engineering Brief (Iteration ${ctx.iteration} of ${ctx.maxIterations})`);
  sections.push("");
  sections.push("## 1. Objective of This Corrective Iteration");
  sections.push(`Address the specific defects, failing checks, and unmet requirements from attempt ${lastFailure?.iteration ?? ctx.iteration - 1}.`);

  sections.push("");
  sections.push("## 2. Evidence from Previous Attempt");
  if (lastFailure) {
    if (lastFailure.changedFiles.length > 0) {
      sections.push(`- **Files Modified So Far**: ${lastFailure.changedFiles.join(", ")}`);
    }
    const failingChecks = lastFailure.checks.filter((c) => c.status !== "passed");
    if (failingChecks.length > 0) {
      sections.push("### Concrete Verification Failures:");
      for (const c of failingChecks) {
        sections.push(`- **${c.label} (${c.status})**:`);
        if (c.output) {
          sections.push("```");
          sections.push(c.output.split("\n").slice(-25).join("\n"));
          sections.push("```");
        }
      }
    }
    if (lastFailure.blockers.length > 0) {
      sections.push("### Rejection Reasons:");
      for (const b of lastFailure.blockers) {
        sections.push(`- ${b}`);
      }
    }
  }

  sections.push("");
  sections.push("## 3. Outstanding Requirements to Satisfy");
  const unverifiedReqs = inventory.requirements.filter((r) => r.status !== "verified");
  if (unverifiedReqs.length > 0) {
    for (const req of unverifiedReqs.slice(0, 15)) {
      sections.push(`- **[${req.id}]** (${req.classification}): ${req.title}`);
    }
  } else {
    sections.push("- Resolve all check failures and ensure the system operates end-to-end as specified.");
  }

  sections.push("");
  sections.push("## 4. Targeted Corrective Actions");
  sections.push("1. Inspect the exact failure locations and error output quoted above.");
  sections.push("2. Edit the workspace files to resolve the defects without regressing passing checks.");
  sections.push("3. Run the project verification checks to confirm all tests pass cleanly.");

  return sections.join("\n");
}

/**
 * Builds the complete, deterministic instruction prompt for the initial brief
 * or iterative repair iterations.
 */
export function buildInstructionPrompt(
  ctx: InstructionContext,
  inventory?: RequirementInventory,
  options: {
    filesRepresentation?: string;
    historyRepresentation?: string[];
  } = {}
): string {
  const inv =
    inventory ||
    ctx.requirementInventory ||
    buildRequirementInventory({
      taskText: ctx.taskText,
      projectObjective: ctx.projectObjective,
      blueprintDocuments: ctx.blueprintDocuments,
      candidateRequirements: ctx.blueprintRequirements,
    });

  const mode = ctx.autonomyMode ?? "creative_within_constraints";
  const modeDirective = MODE_DIRECTIVES[mode] || MODE_DIRECTIVES.creative_within_constraints;
  const checks = ctx.profile.checks.map((c) => c.label).join(", ") || "none detected (only file validation)";

  const histArr = options.historyRepresentation ?? ctx.history.slice(-2).map(
    (h) => `--- Iteration ${h.iteration} ---
INSTRUCTION YOU GAVE: ${h.instruction.slice(0, 1500)}
AGENT STATE: ${h.agentState}
AGENT'S OWN REPORT (unverified claim): ${h.agentReply.slice(0, 1500) || "(none)"}
FILES CHANGED SINCE THE RUN STARTED: ${h.changedFiles.join(", ") || "none"}
DIFF EXCERPT:
${h.diffExcerpt.slice(0, 5000) || "(no changes)"}
CHECKS RUN BY THE ORCHESTRATOR:
${h.checks.map((c) => `- ${c.label}: ${c.status}${c.status !== "passed" && c.output ? `\n${c.output.split("\n").slice(-25).join("\n")}` : ""}`).join("\n") || "- none"}
SHORTCOMINGS & REVIEW FEEDBACK TO ADDRESS:
${h.blockers.map((b) => `- ${b}`).join("\n") || "- (none)"}
REVIEWER NOTES: ${h.reviewer || "(none)"}`
  );

  const profileSection = ctx.profileDefinition
    ? `PROJECT PROFILE: ${ctx.profileDefinition.name}
${ctx.profileDefinition.description}
Engineering Guidelines:
${ctx.profileDefinition.engineeringGuidelines.map((g) => `- ${g}`).join("\n")}
Focus Areas: ${ctx.profileDefinition.focusAreas.join(", ")}`
    : "";

  const objectiveSection = ctx.projectObjective && ctx.projectObjective.trim() && ctx.projectObjective.trim() !== ctx.taskText.trim()
    ? `UNIVERSAL PROJECT SPECIFICATION & INSTRUCTIONS (Authoritative Source of Truth):
${ctx.projectObjective.trim()}`
    : "";

  const inScopeMandatory = inv.requirements
    .filter((r) => r.classification === "mandatory_requirement" && r.scopeStatus !== "safety_conflict" && r.scopeStatus !== "out_of_scope")
    .slice(0, 20);
  const excludedItems = inv.requirements.filter((r) => r.scopeStatus === "safety_conflict" || r.scopeStatus === "out_of_scope");

  const inventorySection = `STRUCTURED REQUIREMENT INVENTORY (Extracted from source):
Mandatory Requirements:
${inScopeMandatory.map((r) => `- [${r.id}] ${r.title}`).join("\n") || "- None explicit"}
Explicit Constraints:
${inv.requirements.filter((r) => r.classification === "explicit_constraint").slice(0, 10).map((r) => `- [${r.id}] STRICT: ${r.description}`).join("\n") || "- None explicit"}
${excludedItems.length > 0 ? `Excluded / Safety Conflict Scope Boundaries (DO NOT IMPLEMENT):\n${excludedItems.map((r) => `- [${r.id}] (EXCLUDED): ${r.title} — ${r.scopeConflictReason || "Out of scope"}`).join("\n")}\n` : ""}${inv.summary.contradictions > 0 ? `Unresolved Contradictions (Surface, do not invent resolution):\n${inv.requirements.filter((r) => r.classification === "unresolved_contradiction").map((r) => `- [${r.id}] ${r.description}`).join("\n")}` : ""}`;

  const blueprintSection = ctx.blueprintRequirements && ctx.blueprintRequirements.length > 0
    ? `MASTER BLUEPRINT REQUIREMENTS:
${ctx.blueprintRequirements
  .slice(0, 20)
  .map((r) => `- [${r.id}] (${r.provenanceKind}) ${r.title} — ${r.description} (Ref: ${r.sourceReference})`)
  .join("\n")}${ctx.blueprintRequirements.length > 20 ? `\n… and ${ctx.blueprintRequirements.length - 20} additional blueprint requirements.` : ""}`
    : ctx.blueprintDocuments && ctx.blueprintDocuments.length > 0
      ? `MASTER BLUEPRINT ATTACHMENT:
Attached document: ${ctx.blueprintDocuments.map((d) => `${d.filename} (${d.byteSize} bytes)`).join(", ")}
Excerpt:
${ctx.blueprintDocuments[0].extractedText.slice(0, 2500)}`
      : "";

  const memorySection = ctx.memoryContextSection
    ? `PERSISTENT CONTEXT MEMORY & HISTORICAL PROGRESS:\n${ctx.memoryContextSection}`
    : ctx.memorySnapshotMarkdown
      ? `PERSISTENT CONTEXT MEMORY SNAPSHOT:\n${ctx.memorySnapshotMarkdown}`
      : "";

  const filesStr = options.filesRepresentation ?? (ctx.files.slice(0, 100).join(", ") || "(none)");

  const criteriaList = ctx.taskContext?.activeAcceptanceCriteria && ctx.taskContext.activeAcceptanceCriteria.length > 0
    ? ctx.taskContext.activeAcceptanceCriteria.map((c) => `- **[${c.id}]** ${c.title}: ${c.description}`)
    : ctx.criteria.map((c, i) => `${i + 1}. ${c}`);

  return [
    "OBJECTIVE / TASK FROM THE USER:",
    ctx.taskText.trim(),
    "",
    objectiveSection,
    "",
    inventorySection,
    "",
    blueprintSection,
    "",
    memorySection,
    "",
    "AUTONOMY & CREATIVITY DIRECTIVE:",
    modeDirective,
    "",
    profileSection,
    "",
    "ACCEPTANCE CRITERIA:",
    criteriaList.join("\n"),
    "",
    `PROJECT: ${ctx.profile.isEmpty ? "empty folder" : `${ctx.profile.fileCount} files; languages: ${ctx.profile.languages.join(", ") || "unknown"}`}. Checks the orchestrator runs afterwards: ${checks}.`,
    `EXISTING FILES (sample): ${filesStr}`,
    "",
    `ITERATION ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    histArr.length ? `PREVIOUS ITERATIONS:\n${histArr.join("\n\n")}` : "This is the first iteration.",
    ctx.guidance?.length ? `\nOPERATOR GUIDANCE:\n${ctx.guidance.map((g) => `- ${g}`).join("\n")}` : "",
    "",
    `INSTRUCTIONS:
Determine what engineering work is actually required now.
Preserve all applicable user requirements, attached-source constraints, and existing architecture.
Distinguish verified facts from assumptions and unresolved issues.
Do not invent project requirements or silently override explicit instructions.

Produce a complete, concrete, directly actionable engineering instruction that the native Antigravity agent can execute.
Specify relevant implementation, integration, and verification expectations. Avoid unnecessary redesign and unrelated work.

Do not merely produce a task title, acceptance-criteria JSON, file list, or high-level plan.
Do not ask another AI to create a plan or another prompt.
Do not claim that work has been completed merely because it has been described.

It must communicate:
1. Executive Objective & Expected Outcome: Restate the full objective, scope boundaries, and target behavior.
2. Architecture & Design Direction: Outline design patterns, interfaces, integration points, and algorithmic approach.
3. Applicable Constraints & Profile Guidelines: Incorporate profile guidelines and autonomy mode directives.
4. Functional Specifications & Workflows: Represent all mandatory requirements from the inventory with [REQ-xxx] traceability.
5. Scope of Implementation: Guide the agent on areas to inspect and coordinate without prescribing file-by-file copy-paste dumps.
6. Verification Expectations: Explicitly state how the agent must validate its work (e.g. running the project's tests).
${histArr.length ? "7. Root Cause Analysis & Fix Directions: Quote the exact failing checks above and specify the technical correction required." : ""}

CRITICAL RULES:
- DO NOT emit a meta-instruction telling the agent to "construct a brief" or "write a plan". Write the brief directly!
- PRESERVE ALL EXPLICIT REQUIREMENTS AND CONSTRAINTS. Do not drop or dilute them.
- DO NOT output full copy-paste source files. The agent will independently inspect the workspace and write the code.
- DO NOT return the internal task-planning JSON schema (e.g. {"title": "...", "acceptance_criteria": [...], "files_to_read": [...]}).

ROUTING & OUTPUT CONTRACT:
Respond using the Orches routing protocol (NOT JSON):

If you can provide engineering instructions:
ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Implementation Mission
<Complete, substantive markdown engineering brief>
[/ORCHES_ANTIGRAVITY_INSTRUCTION]

If the operation cannot proceed:
ORCHES_STATUS: STOP
Reason: <Explanation of genuine blocker>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The reasoning provider decides what the coding agent should do next: synthesizing
 * a comprehensive Engineering Brief for the task, validating it against the requirement
 * inventory, and generating targeted corrective instructions across iterations.
 */
export async function composeInstruction(
  provider: ReasoningProvider,
  ctx: InstructionContext
): Promise<Instruction> {
  const inventory =
    ctx.requirementInventory ||
    buildRequirementInventory({
      taskText: ctx.taskText,
      projectObjective: ctx.projectObjective,
      blueprintDocuments: ctx.blueprintDocuments,
      candidateRequirements: ctx.blueprintRequirements,
    });

  const budget = calculateContextBudget(provider);
  let maxOutputTokens = budget.breakdown.maxOutputTokens || 3500;
  const systemTokens = estimateTokens(SYSTEM);
  const effectiveLimit = Math.max(1000, budget.totalContextTokens - budget.safetyMarginTokens);

  let currentHistory = ctx.history.slice(-2).map(
    (h) => `--- Iteration ${h.iteration} ---
INSTRUCTION YOU GAVE: ${h.instruction.slice(0, 1500)}
AGENT STATE: ${h.agentState}
AGENT'S OWN REPORT (unverified claim): ${h.agentReply.slice(0, 1500) || "(none)"}
FILES CHANGED SINCE THE RUN STARTED: ${h.changedFiles.join(", ") || "none"}
DIFF EXCERPT:
${h.diffExcerpt.slice(0, 5000) || "(no changes)"}
CHECKS RUN BY THE ORCHESTRATOR:
${h.checks.map((c) => `- ${c.label}: ${c.status}${c.status !== "passed" && c.output ? `\n${c.output.split("\n").slice(-25).join("\n")}` : ""}`).join("\n") || "- none"}
SHORTCOMINGS & REVIEW FEEDBACK TO ADDRESS:
${h.blockers.map((b) => `- ${b}`).join("\n") || "- (none)"}
REVIEWER NOTES: ${h.reviewer || "(none)"}`
  );

  let filesRepresentation = ctx.files.slice(0, 100).join(", ") || "(none)";
  let prompt = buildInstructionPrompt(ctx, inventory, { filesRepresentation, historyRepresentation: currentHistory });

  // Request Assembly Guard: ensure total assembled request (system + prompt + output reserve)
  // strictly fits within effective budget
  if (systemTokens + estimateTokens(prompt) + maxOutputTokens > effectiveLimit) {
    // Stage 1: Prune file list
    filesRepresentation = ctx.files.slice(0, 15).join(", ") || "(none)";
    prompt = buildInstructionPrompt(ctx, inventory, { filesRepresentation, historyRepresentation: currentHistory });
  }

  if (systemTokens + estimateTokens(prompt) + maxOutputTokens > effectiveLimit) {
    // Stage 2: Prune history diffs and excerpts
    currentHistory = ctx.history.slice(-2).map((h) =>
      `--- Iteration ${h.iteration} ---
INSTRUCTION: ${h.instruction.slice(0, 400)}
AGENT REPLY: ${h.agentReply.slice(0, 300) || "(none)"}
FILES CHANGED: ${h.changedFiles.join(", ") || "none"}
CHECKS: ${h.checks.map((c) => `- ${c.label}: ${c.status}`).join("\n") || "- none"}
SHORTCOMINGS TO RESOLVE: ${h.blockers.map((b) => `- ${b}`).join("\n") || "- (none)"}`
    );
    filesRepresentation = "(omitted to preserve context budget)";
    prompt = buildInstructionPrompt(ctx, inventory, { filesRepresentation, historyRepresentation: currentHistory });
  }

  if (systemTokens + estimateTokens(prompt) + maxOutputTokens > effectiveLimit) {
    // Stage 3: Dynamically adjust maxOutputTokens to fit remaining room
    const remainingForOutput = effectiveLimit - systemTokens - estimateTokens(prompt);
    maxOutputTokens = Math.max(500, Math.min(maxOutputTokens, remainingForOutput));
  }


  const operation = ctx.iteration === 1 ? "code_generation" : "repair_diagnosis";

  const response = await provider.generate(
    {
      operation,
      systemInstruction: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      json: false,
      temperature: 0.2,
      maxOutputTokens,
      projectId: ctx.projectId,
      runId: ctx.runId,
    },
    ctx.signal
  );

  // 1. Extract instruction using natural-language protocol reader
  const extracted = ResponseReader.extractInstruction(response.text || "", {
    allowLegacyJson: true,
  });

  // 2. Check for explicit STOP status or refusal
  if (extracted.action === "stop") {
    const combinedRationale = extracted.stopReason && extracted.rationale && extracted.stopReason !== extracted.rationale
      ? `${extracted.stopReason}: ${extracted.rationale}`
      : extracted.stopReason || extracted.rationale || "The reasoning model stopped the run.";
    return {
      action: "stop",
      instruction: "",
      rationale: combinedRationale,
      source: "model",
    };
  }

  // 3. Check parsed object fallback if provider returned parsed object (e.g. ScriptedProvider in tests)
  const parsed = (response.parsed ?? extractJsonFromText(response.text || "")) as Record<string, unknown> | null;
  if (parsed && typeof parsed === "object") {
    const parsedAction = String(parsed.action ?? "").toLowerCase();
    if (parsedAction === "stop") {
      const stopReason = String(parsed.stop_reason ?? parsed.stopReason ?? "").trim();
      const rationale = String(parsed.rationale ?? parsed.reason ?? "").trim();
      const combinedRationale = stopReason && rationale && stopReason !== rationale
        ? `${stopReason}: ${rationale}`
        : stopReason || rationale || "The reasoning model stopped the run.";
      return {
        action: "stop",
        instruction: "",
        rationale: combinedRationale,
        source: "model",
      };
    }
  }

  // 4. Retrieve candidate raw instruction
  let rawInstruction = extracted.instructionText.trim();
  if (!rawInstruction && parsed) {
    if (typeof parsed.instruction === "string") rawInstruction = parsed.instruction.trim();
    else if (typeof parsed.prompt === "string") rawInstruction = parsed.prompt.trim();
  }

  // Support markers inside parsed instruction if any
  if (rawInstruction) {
    const markerStart = rawInstruction.indexOf("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    const markerEnd = rawInstruction.indexOf("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
    if (markerStart !== -1 && markerEnd !== -1 && markerEnd > markerStart) {
      rawInstruction = rawInstruction.slice(markerStart + 32, markerEnd).trim();
    } else if (markerStart !== -1) {
      rawInstruction = rawInstruction.slice(markerStart + 32).trim();
    }
  }

  // Reject internal task descriptors (e.g. JSON with title/acceptance_criteria but no substantive brief)
  if (rawInstruction && isTaskDescriptor(rawInstruction)) {
    rawInstruction = "";
  }

  const combinedSource = `${ctx.taskText}\n${ctx.projectObjective || ""}\n${ctx.blueprintDocuments?.map((b) => b.extractedText).join("\n") || ""}`;

  let candidateInstruction = rawInstruction;
  let source: "model" | "fallback" = "model";
  let warning: string | undefined;

  // Quality Gate: Check if the model emitted a meta-instruction, task descriptor, thought fragment, or under-specified brief
  const isRepair = ctx.iteration > 1;
  const isDescriptor = (response.text && isTaskDescriptor(response.text)) || (rawInstruction && isTaskDescriptor(rawInstruction));
  const isThought = (response.text && isThoughtOrStatusFragment(response.text)) || (rawInstruction && isThoughtOrStatusFragment(rawInstruction));
  const minLength = isRepair ? 15 : 30;
  const isSubstanceInvalid = rawInstruction
    ? isRepair
      ? rawInstruction.length < minLength
      : !validateInstructionSubstance(rawInstruction, ctx.taskText).valid
    : true;

  if (
    !rawInstruction ||
    rawInstruction.length < minLength ||
    isDescriptor ||
    isThought ||
    isMetaInstruction(rawInstruction) ||
    isUnderSpecified(rawInstruction, ctx.taskText, { isRepair }) ||
    isSubstanceInvalid
  ) {
    source = "fallback";
    const fragmentSnippet = (rawInstruction || response.text || "").trim().slice(0, 90);
    warning = isThought
      ? `The reasoning model returned an interim thought fragment or status update ("${fragmentSnippet}…"); the orchestrator synthesized a comprehensive, substantive engineering brief from the project specification and requirement inventory.`
      : isDescriptor
        ? "The reasoning model returned an internal task-planning descriptor rather than a substantive engineering instruction; the orchestrator synthesized a comprehensive engineering brief directly."
        : rawInstruction && isMetaInstruction(rawInstruction)
          ? `The reasoning model returned a meta-instruction ("${rawInstruction.slice(0, 90)}…"); the orchestrator synthesized a comprehensive, substantive engineering brief from the project specification and requirement inventory.`
          : rawInstruction && isUnderSpecified(rawInstruction, ctx.taskText)
            ? "The reasoning model returned an under-specified brief; the orchestrator synthesized a complete, structured engineering brief."
            : extracted.validationError
              ? `The reasoning model's response did not adhere to the natural-language protocol (${extracted.validationError}); the orchestrator synthesized a comprehensive engineering brief directly.`
              : "The reasoning model did not produce a usable natural-language instruction; the orchestrator synthesized a comprehensive engineering brief directly.";

    candidateInstruction = ctx.iteration > 1
      ? synthesizeRepairBrief(ctx, inventory)
      : synthesizeSubstantiveBrief(ctx, inventory, warning);
  }

  // Mandatory Requirement Traceability & Prompt-Fidelity Gate:
  // Validate candidate prompt against the inventory, enforce full requirement coverage and constraint preservation.
  const fidelityResult = validateAndCorrectPrompt(candidateInstruction, inventory, {
    sourceText: combinedSource,
    autonomyMode: ctx.autonomyMode,
    iteration: ctx.iteration,
  });

  return {
    action: "instruct",
    instruction: fidelityResult.prompt,
    rationale: extracted.rationale || (typeof parsed?.rationale === "string" && parsed.rationale ? parsed.rationale : "Engineering implementation brief with verified requirement fidelity"),
    source,
    warning: warning ? `${warning} ${fidelityResult.report.summary}` : fidelityResult.report.summary,
    fidelityReport: fidelityResult.report,
    initialFidelityReport: fidelityResult.initialReport,
    residualUncertainties: fidelityResult.residualUncertainties,
  };
}
