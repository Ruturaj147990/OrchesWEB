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
import { buildAlternativeFollowUp, analyzeRefusal } from "../prompts/refusal-detector.js";
import { INSTRUCTION_SYSTEM, buildInstructionPromptV2, checkBriefCoverage, buildCoverageAmendment } from "./instruction-prompt.js";
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
  /** Structured review results (when a review ran). */
  reviewVerdict?: string;
  reviewSummary?: string;
  criteriaResults?: Array<{ id: string; status: string; reason: string }>;
  findings?: Array<{ severity: string; message: string }>;
  repairInstructions?: string[];
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
  stage?: "implementation" | "audit" | "audit_remediation";
  auditReport?: string;
  /** A narrower scope the reasoning model itself proposed (after declining the full request) and that was adopted. */
  adoptedScope?: string;
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
  unrecoverable?: boolean;
  /** The model declined the request (fully or partly). */
  refusal?: boolean;
  /** Set when the model declined the full request and Orches proceeded with the alternative the model offered. */
  adoptedAlternative?: string;
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
3. INDEPENDENT ASSESSMENT & ADVISORY CONCERNS:
   - You may receive advisory concerns identified by Orches analysis (safety concerns, technical limitations, ambiguity, missing information, feasibility issues, conflicting requirements).
   - These findings are strictly advisory to assist your evaluation. You independently evaluate the complete, unmodified user request and decide how to respond.
   - If you determine that the request cannot or should not proceed, return ORCHES_STATUS: STOP with your honest reason.
4. SPECIFY IMPLEMENTATION, INTEGRATION, AND VERIFICATION:
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

If the operation cannot proceed or you decline/refuse the task:
ORCHES_STATUS: STOP

Reason: <A concise and truthful explanation of why the operation cannot proceed or your reason for declining>

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
  // No domain-specific templates: they invented entities and endpoints the user never asked for.
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
  void domain;

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
      sections.push("### Unresolved Issues & Feedback to Address:");
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
 * Synthesizes a comprehensive, rigorous Full-System Quality & Readiness Audit Brief.
 * Dispatched to Antigravity following initial requirements acceptance.
 */
export function synthesizeSystemAuditBrief(ctx: InstructionContext): string {
  const title = ctx.taskText.trim().split(/\r?\n/)[0].replace(/^#+\s*/, "").slice(0, 80) || "Project";
  const checks = ctx.profile.checks.map((c) => c.label).join(", ") || "none detected (standard file and syntax checks)";

  return [
    `# ${title} — Mandatory Post-Acceptance Full-System Quality & Architecture Audit`,
    "",
    "## 1. Executive Mission: Full-System Audit",
    "The original implementation requirements have passed initial acceptance.",
    "You are now tasked with executing a comprehensive, evidence-based quality audit across the entire system.",
    "Do NOT make speculative edits. Inspect the actual workspace files, architecture, test suites, and configurations.",
    "",
    "## 2. Required Subsystem Audit Dimensions",
    "Thoroughly inspect and evaluate each of the following dimensions:",
    "1. **Frontend Architecture & UX**: Layout integrity, responsive behavior, component contracts, input validation, state transitions, error boundaries, user feedback, and accessibility.",
    "2. **Backend & Service Layer**: Endpoint contracts, request validation, business logic integrity, error handling, status codes, session management, and boundary resilience.",
    "3. **Database & Data Persistence**: Schema integrity, constraints, relations, migration validity, transaction safety, query efficiency, and data sanitization.",
    "4. **AI / ML / Reasoning Integrations (where present)**: Provider adapters, model fallbacks, schema parsing, prompt resilience, token budgeting, and protocol handling.",
    "5. **Security & Vulnerability Posture**: Injection risks (SQL/XSS/Command), secret handling, credential exposure, path traversal safeguards, authentication/authorization boundaries, and dependency vulnerabilities.",
    "6. **Architecture & Maintainability**: Modularity, separation of concerns, coupling, code duplication, circular dependencies, type safety, and error propagations.",
    "7. **Performance & Reliability**: Resource utilization, memory leaks, concurrency handling, database index usage, and edge-case behavior under load.",
    "8. **Automated Verification & Test Coverage**: Test coverage adequacy, edge case coverage, deterministic test pass rates, mock fidelity, and automated checks (`" + checks + "`).",
    "9. **Deployment & Runtime Readiness**: Build integrity, environment configuration, container/process management, port safety, logging, and startup diagnostics.",
    "",
    "## 3. Required Output: Evidence-Based Audit Report",
    "Execute all automated checks and inspect workspace files using your tools.",
    "Provide an exhaustive markdown audit report with:",
    "- An executive readiness verdict (READINESS_VERDICT: READY | DEFECTS_DETECTED).",
    "- Concrete findings categorized by subsystem with file paths, line numbers, and root causes.",
    "- Detailed verification results from running test suites and linters.",
    "- Clear, prioritized corrective actions for any identified deficiencies.",
  ].join("\n");
}

/**
 * The instruction prompt for the current iteration (see instruction-prompt.ts for its structure).
 * `options` is accepted for compatibility and ignored.
 */
export function buildInstructionPrompt(
  ctx: InstructionContext,
  inventory?: RequirementInventory,
  _options: { filesRepresentation?: string; historyRepresentation?: string[] } = {}
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
  return buildInstructionPromptV2(ctx, inv);
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

  const prompt = buildInstructionPromptV2(ctx, inventory);
  const maxOutputTokens = 8000;

  const operation = ctx.iteration === 1 ? "code_generation" : "repair_diagnosis";

  let response = await provider.generate(
    {
      operation,
      operationId: operation,
      attempt: ctx.iteration,
      stage: ctx.stage || (ctx.iteration === 1 ? "implementation" : "repair"),
      systemInstruction: INSTRUCTION_SYSTEM,
        skipSourceDelivery: true,
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
  let extracted = ResponseReader.extractInstruction(response.text || "", {
    allowLegacyJson: true,
  });

  // 2. Check for explicit STOP status or refusal. A refusal is never forwarded to the agent and never
  // replaced by a locally written brief. If the model offered an alternative, ask it (once) to author the
  // brief for exactly that alternative; otherwise the run stops.
  if (extracted.action === "stop") {
    const combinedRationale = extracted.stopReason && extracted.rationale && extracted.stopReason !== extracted.rationale
      ? `${extracted.stopReason}: ${extracted.rationale}`
      : extracted.stopReason || extracted.rationale || "The reasoning model stopped the run.";
    const parsedStop = (response.parsed ?? null) as Record<string, unknown> | null;
    const alternative =
      (typeof parsedStop?.alternative_offered === "string" && parsedStop.alternative_offered) || extracted.alternativeOffered || null;
    if (alternative) {
      return requestOfferedAlternative(provider, ctx, operation, maxOutputTokens, alternative, combinedRationale);
    }
    return {
      action: "stop",
      instruction: "",
      rationale: combinedRationale,
      source: "model",
      refusal: extracted.isRefusal ?? true,
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
  let warning: string | undefined = response.warnings?.length ? response.warnings.join("; ") : undefined;

  // Quality Gate: Check if the model emitted a meta-instruction, task descriptor, thought fragment, or under-specified brief
  const isTargetedStage = ctx.stage === "audit" || ctx.stage === "audit_remediation" || ctx.iteration > 1;
  const isRepair = ctx.iteration > 1 || ctx.stage === "audit_remediation";
  const isDescriptor = (response.text && isTaskDescriptor(response.text)) || (rawInstruction && isTaskDescriptor(rawInstruction));
  const isThought = (response.text && isThoughtOrStatusFragment(response.text)) || (rawInstruction && isThoughtOrStatusFragment(rawInstruction));
  const minLength = isTargetedStage ? 15 : 30;
  const isSubstanceInvalid = rawInstruction
    ? isTargetedStage
      ? rawInstruction.length < minLength
      : !validateInstructionSubstance(rawInstruction, ctx.taskText).valid
    : true;

  // Recovery attempt for audit and audit_remediation stages to preserve GPT-Web prompt ownership
  const isAuditWorkflowStage = ctx.stage === "audit" || ctx.stage === "audit_remediation";
  let isRawUnusable =
    !rawInstruction ||
    rawInstruction.length < minLength ||
    isDescriptor ||
    isThought ||
    isMetaInstruction(rawInstruction) ||
    isUnderSpecified(rawInstruction, ctx.taskText, { isRepair: isTargetedStage }) ||
    isSubstanceInvalid;

  // Recovery: ask GPT-Web itself to re-author an unusable reply before anything else happens. In the
  // audit stages a still-unusable reply ends the run as unverified; Orches never writes those briefs.
  if (isRawUnusable) {
    try {
      const recoveryClarification = isThought
        ? "Your previous output (just above in this conversation) was an interim thought fragment or status update. You must author the complete, substantive engineering instruction inside [ORCHES_ANTIGRAVITY_INSTRUCTION] ... [/ORCHES_ANTIGRAVITY_INSTRUCTION] for Antigravity to execute, preceded by the line ORCHES_STATUS: INSTRUCT. If you cannot proceed, reply ORCHES_STATUS: STOP with Reason: <why>."
        : "Your previous response (just above in this conversation) did not provide a usable instruction. You must author the complete, substantive engineering instruction inside [ORCHES_ANTIGRAVITY_INSTRUCTION] ... [/ORCHES_ANTIGRAVITY_INSTRUCTION], preceded by the line ORCHES_STATUS: INSTRUCT. If you cannot proceed, reply ORCHES_STATUS: STOP with Reason: <why>.";

      const retryResponse = await provider.generate(
        {
          operation,
          operationId: `${operation}_recovery`,
          attempt: ctx.iteration,
          stage: ctx.stage || (ctx.iteration === 1 ? "implementation" : "repair"),
          systemInstruction: INSTRUCTION_SYSTEM,
        skipSourceDelivery: true,
          messages: [{ role: "user", content: recoveryClarification }],
          json: false,
          temperature: 0.1,
          maxOutputTokens,
          projectId: ctx.projectId,
          runId: ctx.runId,
        },
        ctx.signal
      );

      if (retryResponse.text) {
        response = retryResponse;
        const retryExtracted = ResponseReader.extractInstruction(retryResponse.text, { allowLegacyJson: true });
        if (retryExtracted.action === "stop") {
          const stopRationale = retryExtracted.stopReason || retryExtracted.rationale || "The reasoning model stopped the run.";
          const retryParsedStop = (retryResponse.parsed ?? null) as Record<string, unknown> | null;
          const retryAlternative =
            (typeof retryParsedStop?.alternative_offered === "string" && retryParsedStop.alternative_offered) || retryExtracted.alternativeOffered || null;
          if (retryAlternative) {
            return requestOfferedAlternative(provider, ctx, operation, maxOutputTokens, retryAlternative, stopRationale);
          }
          return {
            action: "stop",
            instruction: "",
            rationale: stopRationale,
            source: "model",
            refusal: retryExtracted.isRefusal ?? true,
          };
        }
        let retryRaw = retryExtracted.instructionText.trim();
        const retryParsed = (retryResponse.parsed ?? extractJsonFromText(retryResponse.text)) as Record<string, unknown> | null;
        if (!retryRaw && retryParsed) {
          if (typeof retryParsed.instruction === "string") retryRaw = retryParsed.instruction.trim();
          else if (typeof retryParsed.prompt === "string") retryRaw = retryParsed.prompt.trim();
        }
        if (retryRaw) {
          const mStart = retryRaw.indexOf("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
          const mEnd = retryRaw.indexOf("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
          if (mStart !== -1 && mEnd !== -1 && mEnd > mStart) {
            retryRaw = retryRaw.slice(mStart + 32, mEnd).trim();
          } else if (mStart !== -1) {
            retryRaw = retryRaw.slice(mStart + 32).trim();
          }
        }
        if (retryRaw && !isTaskDescriptor(retryRaw)) {
          rawInstruction = retryRaw;
          candidateInstruction = retryRaw;
          extracted = retryExtracted;
        }
      }
    } catch (recoveryErr) {
      if (ctx.signal?.aborted) throw recoveryErr;
      console.warn(`[instructor] GPT-Web recovery request failed: ${(recoveryErr as Error).message}`);
    }
  }

  if (isAuditWorkflowStage && isRawUnusable) {
    const postDescriptor = (response.text && isTaskDescriptor(response.text)) || (rawInstruction && isTaskDescriptor(rawInstruction));
    const postThought = (response.text && isThoughtOrStatusFragment(response.text)) || (rawInstruction && isThoughtOrStatusFragment(rawInstruction));
    const postSubstanceInvalid = rawInstruction ? rawInstruction.length < minLength : true;
    const postMeta = isMetaInstruction(rawInstruction);
    const postUnder = isUnderSpecified(rawInstruction, ctx.taskText, { isRepair: true });

    if (
      !rawInstruction ||
      rawInstruction.length < minLength ||
      postDescriptor ||
      postThought ||
      postMeta ||
      postUnder ||
      postSubstanceInvalid
    ) {
      // GPT-Web prompt ownership strictly enforced:
      // Never substitute a locally synthesized brief for GPT-Web-authored audit/remediation prompt.
      // Mark as unrecoverable so the workflow preserves work and concludes incomplete/unverified.
      return {
        action: "instruct",
        instruction: "",
        rationale: `GPT-Web did not author a usable prompt for ${ctx.stage} after recovery attempt`,
        source: "model",
        unrecoverable: true,
        warning: `GPT-Web response for ${ctx.stage} was empty, malformed, or unusable after recovery attempt`,
      };
    }
  }

  const currentDescriptor = (response.text && isTaskDescriptor(response.text)) || (rawInstruction && isTaskDescriptor(rawInstruction));
  const currentThought = (response.text && isThoughtOrStatusFragment(response.text)) || (rawInstruction && isThoughtOrStatusFragment(rawInstruction));
  const currentSubstanceInvalid = rawInstruction
    ? isTargetedStage
      ? rawInstruction.length < minLength
      : !validateInstructionSubstance(rawInstruction, ctx.taskText).valid
    : true;

  if (
    !isAuditWorkflowStage &&
    (!rawInstruction ||
      rawInstruction.length < minLength ||
      currentDescriptor ||
      currentThought ||
      isMetaInstruction(rawInstruction) ||
      isUnderSpecified(rawInstruction, ctx.taskText, { isRepair: isTargetedStage }) ||
      currentSubstanceInvalid)
  ) {
    // Never paper over a refusal with a locally written brief.
    const rawReply = (response.text || "").trim();
    if (analyzeRefusal(rawReply).isRefusal && !rawReply.includes("[ORCHES_ANTIGRAVITY_INSTRUCTION]")) {
      return { action: "stop", instruction: "", rationale: rawReply.slice(0, 4000), source: "model", refusal: true };
    }
    source = "fallback";
    const fragmentSnippet = (rawInstruction || response.text || "").trim().slice(0, 90);
    const fallbackWarning = currentThought
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
    warning = warning ? `${warning}; ${fallbackWarning}` : fallbackWarning;

    candidateInstruction = ctx.iteration > 1
      ? synthesizeRepairBrief(ctx, inventory)
      : synthesizeSubstantiveBrief(ctx, inventory, warning);
  }

  // Coverage: the first implementation brief must address every in-scope requirement and constraint.
  // If it does not, GPT-Web is asked once for a complete revised brief; Orches never edits the brief.
  let finalBrief = candidateInstruction;
  let coverage = checkBriefCoverage(finalBrief, inventory);
  const initialCoverage = coverage.report;
  void combinedSource;
  if (source === "model" && ctx.iteration === 1 && (!ctx.stage || ctx.stage === "implementation") && coverage.missing.length && !ctx.adoptedScope) {
    try {
      const amend = await provider.generate(
        {
          operation,
          operationId: `${operation}_coverage_amend`,
          attempt: ctx.iteration,
          stage: ctx.stage || "implementation",
          systemInstruction: INSTRUCTION_SYSTEM,
          skipSourceDelivery: true,
          messages: [{ role: "user", content: buildCoverageAmendment(coverage.missing) }],
          json: false,
          temperature: 0.1,
          maxOutputTokens,
          projectId: ctx.projectId,
          runId: ctx.runId,
        },
        ctx.signal
      );
      const ax = ResponseReader.extractInstruction(amend.text || "", { allowLegacyJson: true });
      let revised = ax.action === "instruct" ? ax.instructionText.trim() : "";
      const ms = revised.indexOf("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
      const me = revised.indexOf("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
      if (ms !== -1 && me > ms) revised = revised.slice(ms + 32, me).trim();
      if (revised.length >= Math.min(200, finalBrief.length) && !isTaskDescriptor(revised) && !isThoughtOrStatusFragment(revised)) {
        const revisedCoverage = checkBriefCoverage(revised, inventory);
        if (revisedCoverage.missing.length < coverage.missing.length) {
          finalBrief = revised;
          coverage = revisedCoverage;
        }
      }
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      console.warn(`[instructor] Coverage amendment request failed: ${(err as Error).message}`);
    }
  }

  const coverageNote = coverage.missing.length ? coverage.report.summary : undefined;
  return {
    action: "instruct",
    instruction: finalBrief,
    rationale: extracted.rationale || (typeof parsed?.rationale === "string" && parsed.rationale ? parsed.rationale : "Engineering brief from the reasoning model"),
    source,
    warning: [warning, coverageNote].filter(Boolean).join(" ") || undefined,
    fidelityReport: coverage.report,
    initialFidelityReport: initialCoverage,
    residualUncertainties: coverage.missing.map((r) => `${r.id} not covered by the brief`),
  };
}

/**
 * The model declined the request but offered a narrower alternative (e.g. "a simulator instead").
 * Ask the model to author the brief for exactly that alternative. Orches does not write it, does not
 * widen it, and stops the run if the model declines again or gives no usable brief.
 */
async function requestOfferedAlternative(
  provider: ReasoningProvider,
  ctx: InstructionContext,
  operation: "code_generation" | "repair_diagnosis",
  maxOutputTokens: number,
  alternative: string,
  originalRefusal: string
): Promise<Instruction> {
  const declinedNote = `${provider.displayName} declined the request as written: ${originalRefusal.slice(0, 600)}`;
  let followUp;
  try {
    followUp = await provider.generate(
      {
        operation,
        operationId: `${operation}_offered_alternative`,
        attempt: ctx.iteration,
        stage: ctx.stage || (ctx.iteration === 1 ? "implementation" : "repair"),
        systemInstruction: INSTRUCTION_SYSTEM,
        skipSourceDelivery: true,
        messages: [{ role: "user", content: buildAlternativeFollowUp(alternative, ctx.taskText) }],
        json: false,
        temperature: 0.1,
        maxOutputTokens,
        projectId: ctx.projectId,
        runId: ctx.runId,
      },
      ctx.signal
    );
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    return {
      action: "stop",
      instruction: "",
      rationale: `${declinedNote} It offered an alternative, but the follow-up request failed: ${(err as Error).message}`,
      source: "model",
      refusal: true,
    };
  }

  const fx = ResponseReader.extractInstruction(followUp.text || "", { allowLegacyJson: true });
  if (fx.action === "stop") {
    return {
      action: "stop",
      instruction: "",
      rationale: `${declinedNote} When asked to proceed with the alternative it offered, it also declined: ${(fx.stopReason || fx.rationale || "").slice(0, 600)}`,
      source: "model",
      refusal: true,
    };
  }
  let text = fx.instructionText.trim();
  const mStart = text.indexOf("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
  const mEnd = text.indexOf("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
  if (mStart !== -1 && mEnd > mStart) text = text.slice(mStart + 32, mEnd).trim();
  if (!text || text.length < 60 || isTaskDescriptor(text) || isThoughtOrStatusFragment(text) || isMetaInstruction(text)) {
    return {
      action: "stop",
      instruction: "",
      rationale: `${declinedNote} It offered an alternative but did not provide a usable brief for it.`,
      source: "model",
      refusal: true,
    };
  }
  return {
    action: "instruct",
    instruction: text,
    rationale: fx.rationale || "Brief for the alternative scope proposed by the reasoning model",
    source: "model",
    refusal: true,
    adoptedAlternative: alternative,
    warning: `${provider.displayName} declined the request as written and proceeded with the alternative it offered: "${alternative.slice(0, 300)}${alternative.length > 300 ? "…" : ""}". Work is limited to that scope.`,
  };
}
