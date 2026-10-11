import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";
import type { ProjectProfile } from "../workspace/project-inspector.js";

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

const SYSTEM = `You are the technical lead directing an autonomous coding agent (the Antigravity Agent) that can read files, edit files and run commands inside one project folder.
You do NOT write the code yourself. The agent is a capable engineer: tell it WHAT must be true when it is done (files, behaviour, how it will be tested), not full file contents.
When asking for a fix, quote the exact failing check output and name the files involved, and ask the agent to run the project's tests itself before finishing.
Reply with one JSON object only.`;

/**
 * The reasoning provider decides what the coding agent should do next: the first instruction for the
 * task, or — after a rejected iteration — a correction based on the observed diff, check output and
 * review. Provider errors propagate; malformed output falls back to a deterministic instruction.
 */
export async function composeInstruction(
  provider: ReasoningProvider,
  ctx: {
    projectId: string;
    runId: string;
    taskText: string;
    criteria: string[];
    profile: ProjectProfile;
    files: string[];
    iteration: number;
    maxIterations: number;
    history: IterationEvidence[];
    guidance?: string[];
    signal?: AbortSignal;
  }
): Promise<Instruction> {
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

  const prompt = `OBJECTIVE FROM THE USER:
${ctx.taskText.trim()}

ACCEPTANCE CRITERIA:
${ctx.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

PROJECT: ${ctx.profile.isEmpty ? "empty folder" : `${ctx.profile.fileCount} files; languages: ${ctx.profile.languages.join(", ") || "unknown"}`}. Checks the orchestrator runs afterwards: ${checks}.
FILES: ${ctx.files.slice(0, 150).join(", ") || "(none)"}

ITERATION ${ctx.iteration} of at most ${ctx.maxIterations}.
${history.length ? `PREVIOUS ITERATIONS:\n${history.join("\n\n")}` : "This is the first iteration."}
${ctx.guidance?.length ? `\nOPERATOR GUIDANCE:\n${ctx.guidance.map((g) => `- ${g}`).join("\n")}` : ""}

Write the next instruction for the agent. It must be self-contained: restate the full objective and every acceptance criterion that is not yet met, name the files involved, and${history.length ? " quote the exact errors above that must be fixed" : " say how the result will be checked"}. Do not paste complete code; the agent writes the code.
Respond with JSON:
{"action": "instruct" or "stop", "instruction": "text for the agent", "rationale": "one sentence", "stop_reason": "only if action is stop: the genuine blocker"}
Use "stop" only when the objective cannot be achieved (e.g. it is impossible or needs information only the user has).`;

  const response = await provider.generate(
    {
      operation: "repair_diagnosis",
      systemInstruction: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      json: true,
      temperature: 0.2,
      maxOutputTokens: 1500,
      projectId: ctx.projectId,
      runId: ctx.runId,
    },
    ctx.signal
  );
  const parsed = (response.parsed ?? extractJsonFromText(response.text)) as Record<string, unknown> | null;
  const action = String(parsed?.action ?? "").toLowerCase();
  const instruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim() : "";
  if (action === "stop") {
    return { action: "stop", instruction: "", rationale: String(parsed?.stop_reason ?? parsed?.rationale ?? "The reasoning model stopped the run."), source: "model" };
  }
  if (instruction.length >= 10) {
    return { action: "instruct", instruction, rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "", source: "model" };
  }

  const last = ctx.history[ctx.history.length - 1];
  const fallback = last
    ? `${ctx.taskText.trim()}\n\nThe previous attempt was rejected. Fix these problems:\n${last.blockers.map((b) => `- ${b}`).join("\n")}`
    : `${ctx.taskText.trim()}\n\nAcceptance criteria:\n${ctx.criteria.map((c) => `- ${c}`).join("\n")}`;
  return {
    action: "instruct",
    instruction: fallback,
    rationale: "",
    source: "fallback",
    warning: "The reasoning model's instruction was not usable JSON; the orchestrator sent the task and known problems directly.",
  };
}
