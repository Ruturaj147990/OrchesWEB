import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";
import type { ProjectProfile } from "../workspace/project-inspector.js";
import type { ProjectProfileDefinition } from "../domain/profiles/project-profiles.js";
import type { AutonomyMode } from "@orchestrator/shared-types";
import type { CandidateRequirement } from "../domain/blueprints/requirement-extractor.js";
import type { ImportedDocument } from "../domain/blueprints/importer.js";

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
  files: string[];
  iteration: number;
  maxIterations: number;
  history: IterationEvidence[];
  guidance?: string[];
  signal?: AbortSignal;
}

export interface Instruction {
  action: "instruct" | "stop";
  instruction: string;
  rationale: string;
  source: "model" | "fallback";
  warning?: string;
}

const SYSTEM = `You are the Systems Architect and Technical Lead directing an autonomous coding agent (the Antigravity Agent) operating inside a project workspace.
Your responsibility is to synthesize the comprehensive, production-grade Implementation Prompt (Master Engineering Brief) in Markdown that the Antigravity Agent will directly read and execute.

CRITICAL DIRECTIVES:
1. YOUR OUTPUT IS THE DIRECT IMPLEMENTATION PROMPT FOR THE CODING AGENT.
   DO NOT output meta-instructions telling the agent to "construct a brief", "write a plan", "draft a proposal", or "implement according to guidelines".
   YOU MUST WRITE THE ACTUAL SPECIFICATION DIRECTLY.
2. Supply the actual functional requirements, domain entities, workflows, architecture, API contracts, constraints, and acceptance criteria in your Markdown output.
3. DO NOT write the source code yourself. DO NOT output full copy-paste source files or micro-manage single file contents. The agent is a capable engineer that will independently inspect existing code conventions, edit files, and run tests.
4. If the user's task is a high-level title (e.g. "Library Management System"), EXPAND IT into a complete, detailed specification: define core entities, workflows, business rules, routes/endpoints, data models, error handling, and test expectations.
5. If the user provided explicit technology stacks, API contracts, or constraints, PRESERVE THEM EXACTLY without generic dilution.
6. When repairing a rejected iteration, conduct a root-cause analysis of the orchestrator's verification failure, quote the exact error output, and provide targeted corrective guidance while preserving the original objective and constraints.

Reply with one JSON object only:
{"action": "instruct" or "stop", "instruction": "the complete substantive markdown implementation prompt for Antigravity", "rationale": "one sentence summary of approach", "stop_reason": "only if action is stop: the genuine blocker"}`;

const MODE_DIRECTIVES: Record<AutonomyMode, string> = {
  creative_within_constraints: `MODE: Creative within constraints (Default).
Encourage innovative, robust, and clean technical solutions while strictly adhering to user requirements, existing project architecture, technical boundaries, and safety policies. Suggest modern patterns, effective abstractions, and algorithms while respecting the requested scope.`,
  creative_exploration: `MODE: Creative exploration (Soft constraints).
Grant greater autonomy in architectural design, technical approach, and alternative exploration. Requirements designated as preferences or soft constraints may be reconsidered if a superior, cleaner, or more performant alternative exists. Articulate trade-offs and rationale clearly. Mandatory core objectives and workspace safety remain strictly non-negotiable.`,
  strict_blueprint_adherence: `MODE: Strict instruction & blueprint adherence.
Prioritize exact, faithful implementation of the user's explicit requirements and blueprint specifications. Strictly discourage unsolicited features, speculative redesigns, scope expansion, or unrequested architectural restructuring. Fulfill the exact acceptance criteria with minimal, targeted changes.`,
};

/**
 * Detects whether the model produced a shallow meta-instruction (e.g. telling the agent
 * to construct a brief) instead of the actual substantive engineering brief.
 */
export function isMetaInstruction(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true;

  const metaPatterns = [
    /^(construct|create|generate|write|produce|draft|prepare|assemble|formulate)\s+(a\s+)?(comprehensive\s+|cohesive\s+|detailed\s+|markdown\s+)*(engineering\s+brief|implementation\s+prompt|brief|plan|specification|summary|roadmap)\s+(for|to|outlining|covering)/i,
    /^(please\s+)?(construct|create|generate|write|produce|draft)\s+(a\s+)?(comprehensive\s+|cohesive\s+|detailed\s+|markdown\s+)*(engineering\s+brief|plan|specification)/i,
    /^(implement|build)\s+the\s+(requested\s+)?(project|application|system|feature)\s+according\s+to\s+(the\s+)?(guidelines|requirements|criteria|specifications)/i,
    /^(the\s+agent\s+should\s+)?(construct|create|draft|prepare)\s+a\s+(brief|plan|specification)/i,
    /^as\s+the\s+systems\s+architect,\s+(i\s+instruct\s+the\s+agent\s+to\s+)?construct/i,
  ];

  if (metaPatterns.some((pattern) => pattern.test(trimmed))) return true;

  if (trimmed.length < 200 && /brief|guidelines and constraints|adhering to/i.test(trimmed) && !/#\s+/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Checks whether an instruction is hollow or lacks adequate domain specification for a broad task.
 */
export function isUnderSpecified(text: string, taskText: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 20) return true;
  // If the instruction merely echoes the task text verbatim without any actionable directives
  if (trimmed.toLowerCase() === taskText.trim().toLowerCase()) return true;
  return false;
}

/**
 * Enriches broad, high-level task concepts (like "Library Management System") with
 * domain-specific entities, workflows, business logic, endpoints, and test criteria.
 */
function synthesizeDomainDetails(taskText: string, profileId?: string): {
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
        "Persistence: SQLite database or structured JSON repository according to workspace conventions.",
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

  // General domain fallback
  return {
    entities: [
      `Domain entities tailored to ${taskText.slice(0, 60)} with unambiguous primary keys, audit timestamps, and field validations.`,
    ],
    workflows: [
      "Core CRUD operations: Create, Read/Query, Update, Delete with appropriate validation.",
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
 * Synthesizes a comprehensive, production-grade Engineering Implementation Brief
 * when the reasoning model emits a shallow meta-instruction, returns invalid JSON,
 * or requires fallback orchestration.
 */
export function synthesizeSubstantiveBrief(ctx: InstructionContext, reason?: string): string {
  const title = ctx.taskText.trim().split(/\r?\n/)[0].replace(/^#+\s*/, "").slice(0, 80) || "Project Implementation";
  const domain = synthesizeDomainDetails(ctx.taskText, ctx.profileDefinition?.id);
  const mode = ctx.autonomyMode ?? "creative_within_constraints";
  const modeDirective = MODE_DIRECTIVES[mode] || MODE_DIRECTIVES.creative_within_constraints;

  const checks = ctx.profile.checks.map((c) => c.label).join(", ") || "none detected (standard file and syntax validation)";

  const lastFailure = ctx.history[ctx.history.length - 1];

  const sections: string[] = [];

  sections.push(`# ${title} — Implementation Engineering Brief`);
  sections.push("");
  sections.push("## 1. Executive Objective & Scope");
  sections.push(ctx.taskText.trim());

  if (ctx.projectObjective && ctx.projectObjective.trim() && ctx.projectObjective.trim() !== ctx.taskText.trim()) {
    sections.push("");
    sections.push("### Universal Project Specification & Instructions");
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
  sections.push("## 3. Source-of-Truth Hierarchy & Assumptions");
  sections.push("- **Explicit User Requirements**: Mandatory hard constraints that must be preserved without dilution.");
  sections.push(`- **${modeDirective}**`);
  if (ctx.profileDefinition) {
    sections.push(`- **Profile Guidelines (${ctx.profileDefinition.name})**: ${ctx.profileDefinition.engineeringGuidelines.join("; ")}`);
  }
  sections.push("- **Inferred Design Assumptions**: Reasonable engineering choices made to fulfill underspecified requirements, labeled below.");

  if (ctx.blueprintRequirements && ctx.blueprintRequirements.length > 0) {
    sections.push("");
    sections.push("## 4. Master Blueprint Requirements");
    for (const req of ctx.blueprintRequirements.slice(0, 15)) {
      sections.push(`- **[${req.id}]** (${req.provenanceKind}) ${req.title}: ${req.description} *(Source: ${req.sourceReference})*`);
    }
  }

  sections.push("");
  sections.push("## 5. Functional Specifications & Domain Workflows");
  sections.push("### Core Entities & Data Models");
  for (const entity of domain.entities) {
    sections.push(`- ${entity}`);
  }
  sections.push("");
  sections.push("### Key Operational Workflows");
  for (const wf of domain.workflows) {
    sections.push(`- ${wf}`);
  }
  sections.push("");
  sections.push("### Business Logic & Validation Rules");
  for (const rule of domain.businessRules) {
    sections.push(`- ${rule}`);
  }

  sections.push("");
  sections.push("## 6. Architecture, Technology & Interfaces");
  for (const iface of domain.interfaces) {
    sections.push(`- ${iface}`);
  }
  if (ctx.profile.languages.length > 0) {
    sections.push(`- Workspace Language & Environment: ${ctx.profile.languages.join(", ")}`);
  }

  sections.push("");
  sections.push("## 7. Implementation Touchpoints");
  sections.push("Inspect the workspace layout to locate relevant entry points, routes, models, views, and test suites. Coordinate the necessary modifications across these components to deliver a fully functional system.");

  sections.push("");
  sections.push("## 8. Verification Strategy & Acceptance Criteria");
  if (ctx.criteria.length > 0) {
    sections.push("### Concrete Acceptance Criteria:");
    ctx.criteria.forEach((c, i) => sections.push(`${i + 1}. ${c}`));
  }
  sections.push(`### Automated Verification Checks: ${checks}`);
  sections.push("Ensure all unit and integration tests pass cleanly with exit code 0.");

  if (lastFailure) {
    sections.push("");
    sections.push("## 9. Corrective Iteration Guidance & Root Cause Analysis");
    sections.push(`The previous iteration (iteration ${lastFailure.iteration}) was rejected by the orchestrator verification gate.`);
    sections.push("### Failing Checks Output:");
    for (const c of lastFailure.checks.filter((chk) => chk.status !== "passed")) {
      sections.push(`- **${c.label} (${c.status})**:`);
      if (c.output) {
        sections.push("```");
        sections.push(c.output.split("\n").slice(-25).join("\n"));
        sections.push("```");
      }
    }
    if (lastFailure.blockers.length > 0) {
      sections.push("### Rejection Reasons:");
      for (const b of lastFailure.blockers) {
        sections.push(`- ${b}`);
      }
    }
    sections.push("### Corrective Directives:");
    sections.push("Inspect the exact failing assertions above, correct the defect in the code, and verify that the test suite passes before finishing.");
  }

  sections.push("");
  sections.push("## 10. Definition of Done");
  sections.push("The task is complete when all domain workflows operate as specified, required routes/APIs respond correctly, edge cases and validations are covered, and all automated checks pass cleanly.");

  return sections.join("\n");
}

/**
 * The reasoning provider decides what the coding agent should do next: synthesizing
 * a comprehensive Engineering Brief for the task, or — after a rejected iteration —
 * a targeted corrective brief based on observed diffs, check outputs, and review.
 */
export async function composeInstruction(
  provider: ReasoningProvider,
  ctx: InstructionContext
): Promise<Instruction> {
  const mode = ctx.autonomyMode ?? "creative_within_constraints";
  const modeDirective = MODE_DIRECTIVES[mode] || MODE_DIRECTIVES.creative_within_constraints;

  const checks = ctx.profile.checks.map((c) => c.label).join(", ") || "none detected (only file validation)";
  const history = ctx.history.slice(-2).map(
    (h) => `--- Iteration ${h.iteration} ---
INSTRUCTION YOU GAVE: ${h.instruction.slice(0, 1500)}
AGENT STATE: ${h.agentState}
AGENT'S OWN REPORT (unverified claim): ${h.agentReply.slice(0, 1500) || "(none)"}
FILES CHANGED SINCE THE RUN STARTED: ${h.changedFiles.join(", ") || "none"}
DIFF EXCERPT:
${h.diffExcerpt.slice(0, 5000) || "(no changes)"}
CHECKS RUN BY THE ORCHESTRATOR:
${h.checks.map((c) => `- ${c.label}: ${c.status}${c.status !== "passed" && c.output ? `\n${c.output.split("\n").slice(-25).join("\n")}` : ""}`).join("\n") || "- none"}
WHY THE ORCHESTRATOR REJECTED IT:
${h.blockers.map((b) => `- ${b}`).join("\n") || "- (not rejected)"}
REVIEWER NOTES: ${h.reviewer || "(none)"}`
  );

  const profileSection = ctx.profileDefinition
    ? `PROJECT PROFILE: ${ctx.profileDefinition.name}
${ctx.profileDefinition.description}
Engineering Guidelines:
${ctx.profileDefinition.engineeringGuidelines.map((g) => `- ${g}`).join("\n")}
Focus Areas: ${ctx.profileDefinition.focusAreas.join(", ")}`
    : "";

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

  const objectiveSection = ctx.projectObjective && ctx.projectObjective.trim() && ctx.projectObjective.trim() !== ctx.taskText.trim()
    ? `UNIVERSAL PROJECT SPECIFICATION & INSTRUCTIONS (Authoritative Source of Truth):
${ctx.projectObjective.trim()}`
    : "";

  const prompt = [
    "OBJECTIVE / TASK FROM THE USER:",
    ctx.taskText.trim(),
    "",
    objectiveSection,
    "",
    "AUTONOMY & CREATIVITY DIRECTIVE:",
    modeDirective,
    "",
    profileSection,
    "",
    blueprintSection,
    "",
    "ACCEPTANCE CRITERIA:",
    ctx.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    "",
    `PROJECT: ${ctx.profile.isEmpty ? "empty folder" : `${ctx.profile.fileCount} files; languages: ${ctx.profile.languages.join(", ") || "unknown"}`}. Checks the orchestrator runs afterwards: ${checks}.`,
    `EXISTING FILES (sample): ${ctx.files.slice(0, 100).join(", ") || "(none)"}`,
    "",
    `ITERATION ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    history.length ? `PREVIOUS ITERATIONS:\n${history.join("\n\n")}` : "This is the first iteration.",
    ctx.guidance?.length ? `\nOPERATOR GUIDANCE:\n${ctx.guidance.map((g) => `- ${g}`).join("\n")}` : "",
    "",
    `Construct the comprehensive Markdown Implementation Prompt for the Antigravity Agent.
It must communicate:
1. Executive Objective & Expected Outcome: Restate the full objective, scope boundaries, and target behavior.
2. Architecture & Design Direction: Outline design patterns, interfaces, integration points, and algorithmic approach.
3. Applicable Constraints & Profile Guidelines: Incorporate profile guidelines and autonomy mode directives.
4. Functional Specifications & Workflows: Define actual domain entities, workflows, business rules, and endpoints.
5. Scope of Implementation: Guide the agent on areas to inspect and coordinate without prescribing file-by-file copy-paste dumps.
6. Verification Expectations: Explicitly state how the agent must validate its work (e.g. running the project's tests).
${history.length ? "7. Root Cause Analysis & Fix Directions: Quote the exact failing checks above and specify the technical correction required." : ""}

CRITICAL RULES:
- DO NOT emit a meta-instruction telling the agent to "construct a brief" or "write a plan". Write the brief directly!
- If the task is a high-level title (e.g. "Library Management System"), EXPAND IT into a full specification with entities, endpoints, workflows, and test criteria.
- DO NOT output full copy-paste source files. The agent will independently inspect the workspace and write the code.
- Respond with JSON:
{"action": "instruct" or "stop", "instruction": "the complete substantive markdown implementation prompt for Antigravity", "rationale": "one sentence", "stop_reason": "only if action is stop: the genuine blocker"}
Use "stop" only when the objective cannot be achieved (e.g. it is impossible or requires external human credentials).`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await provider.generate(
    {
      operation: "repair_diagnosis",
      systemInstruction: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      json: true,
      temperature: 0.2,
      maxOutputTokens: 3500,
      projectId: ctx.projectId,
      runId: ctx.runId,
    },
    ctx.signal
  );

  const parsed = (response.parsed ?? extractJsonFromText(response.text)) as Record<string, unknown> | null;
  const action = String(parsed?.action ?? "").toLowerCase();
  const rawInstruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim() : typeof parsed?.prompt === "string" ? (parsed.prompt as string).trim() : "";

  if (action === "stop") {
    return {
      action: "stop",
      instruction: "",
      rationale: String(parsed?.stop_reason ?? parsed?.rationale ?? "The reasoning model stopped the run."),
      source: "model",
    };
  }

  // Quality Gate: Check if the model emitted a meta-instruction or under-specified brief
  if (rawInstruction.length >= 10 && !isMetaInstruction(rawInstruction) && !isUnderSpecified(rawInstruction, ctx.taskText)) {
    return {
      action: "instruct",
      instruction: rawInstruction,
      rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
      source: "model",
    };
  }

  // Model produced a meta-instruction, hollow prompt, or unparseable output:
  // Synthesize a substantive, structured Engineering Implementation Brief
  const warning = rawInstruction && isMetaInstruction(rawInstruction)
    ? `The reasoning model returned a meta-instruction ("${rawInstruction.slice(0, 90)}…"); the orchestrator synthesized a comprehensive, substantive engineering brief from the project specification, profile guidelines, and blueprint requirements.`
    : rawInstruction && isUnderSpecified(rawInstruction, ctx.taskText)
      ? `The reasoning model returned an under-specified brief; the orchestrator synthesized a complete, structured engineering brief.`
      : "The reasoning model's instruction was not usable JSON; the orchestrator synthesized a comprehensive engineering brief directly.";

  const synthesized = synthesizeSubstantiveBrief(ctx, warning);

  return {
    action: "instruct",
    instruction: synthesized,
    rationale: typeof parsed?.rationale === "string" && parsed.rationale ? parsed.rationale : "Synthesized comprehensive implementation brief",
    source: "fallback",
    warning,
  };
}
