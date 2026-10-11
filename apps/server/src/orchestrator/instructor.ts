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

export interface Instruction {
  action: "instruct" | "stop";
  instruction: string;
  rationale: string;
  source: "model" | "fallback";
  warning?: string;
}

const SYSTEM = `You are the Systems Architect and Technical Lead directing an autonomous coding agent (the Antigravity Agent) operating inside a project workspace.
Your responsibility is to synthesize a comprehensive, cohesive Engineering Brief in Markdown that guides the agent to implement the user's objective as an integrated whole.
DO NOT write the source code yourself. DO NOT output complete file contents, copy-paste templates, or micro-instructions like 'create file X with content Y'. The agent is a capable engineer that will inspect existing code conventions, decide necessary edits, implement the solution using its native tools, and run verification tests.
When repairing a rejected iteration, conduct a root-cause analysis of the orchestrator's verification failure, quote the exact error output, and provide targeted corrective guidance.
Reply with one JSON object only: {"action": "instruct" or "stop", "instruction": "comprehensive markdown engineering brief", "rationale": "one sentence", "stop_reason": "only if action is stop: the genuine blocker"}`;

const MODE_DIRECTIVES: Record<AutonomyMode, string> = {
  creative_within_constraints: `MODE: Creative within constraints (Default).
Encourage innovative, robust, and clean technical solutions while strictly adhering to user requirements, existing project architecture, technical boundaries, and safety policies. Suggest modern patterns, effective abstractions, and algorithms while respecting the requested scope.`,
  creative_exploration: `MODE: Creative exploration (Soft constraints).
Grant greater autonomy in architectural design, technical approach, and alternative exploration. Requirements designated as preferences or soft constraints may be reconsidered if a superior, cleaner, or more performant alternative exists. Articulate trade-offs and rationale clearly. Mandatory core objectives and workspace safety remain strictly non-negotiable.`,
  strict_blueprint_adherence: `MODE: Strict instruction & blueprint adherence.
Prioritize exact, faithful implementation of the user's explicit requirements and blueprint specifications. Strictly discourage unsolicited features, speculative redesigns, scope expansion, or unrequested architectural restructuring. Fulfill the exact acceptance criteria with minimal, targeted changes.`,
};

/**
 * The reasoning provider decides what the coding agent should do next: synthesizing
 * a comprehensive Engineering Brief for the task, or — after a rejected iteration —
 * a targeted corrective brief based on observed diffs, check outputs, and review.
 */
export async function composeInstruction(
  provider: ReasoningProvider,
  ctx: {
    projectId: string;
    runId: string;
    taskText: string;
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

  const prompt = [
    "OBJECTIVE FROM THE USER:",
    ctx.taskText.trim(),
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
    `Construct a cohesive Engineering Brief in Markdown for the Antigravity Agent.
It must communicate:
1. Executive Objective & Expected Outcome: Restate the full objective and target behavior.
2. Architecture & Design Direction: Outline design patterns, interfaces, integration points, and algorithmic approach.
3. Applicable Constraints & Profile Guidelines: Incorporate the profile guidelines and autonomy mode rules above.
4. Scope of Implementation: Guide the agent on areas to inspect and coordinate without prescribing file-by-file source dumps.
5. Verification Expectations: Explicitly state how the agent must validate its work before finishing (e.g. running the project's tests).
${history.length ? "6. Root Cause Analysis & Fix Directions: Quote the exact failing checks above and specify the technical correction required." : ""}

CRITICAL: Do NOT generate full source code files or paste complete file contents. The agent will independently inspect the workspace and write the code.
Respond with JSON:
{"action": "instruct" or "stop", "instruction": "markdown engineering brief for the agent", "rationale": "one sentence", "stop_reason": "only if action is stop: the genuine blocker"}
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
  const instruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim() : "";
  if (action === "stop") {
    return {
      action: "stop",
      instruction: "",
      rationale: String(parsed?.stop_reason ?? parsed?.rationale ?? "The reasoning model stopped the run."),
      source: "model",
    };
  }
  if (instruction.length >= 10) {
    return {
      action: "instruct",
      instruction,
      rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
      source: "model",
    };
  }

  const last = ctx.history[ctx.history.length - 1];
  const fallback = last
    ? `### Engineering Brief: Corrective Iteration\n\n**Objective:**\n${ctx.taskText.trim()}\n\n**Identified Defects from Verification:**\n${last.blockers.map((b) => `- ${b}`).join("\n")}\n\n**Action Required:**\nInspect the affected files, apply the necessary corrections, and verify with automated tests before completing.`
    : `### Engineering Brief\n\n**Objective:**\n${ctx.taskText.trim()}\n\n**Acceptance Criteria:**\n${ctx.criteria.map((c) => `- ${c}`).join("\n")}\n\n**Action Required:**\nInspect the workspace, implement the requested functionality according to project conventions, and verify with automated tests.`;

  return {
    action: "instruct",
    instruction: fallback,
    rationale: "",
    source: "fallback",
    warning: "The reasoning model's instruction was not usable JSON; the orchestrator synthesized an engineering brief from the task and known problems directly.",
  };
}
