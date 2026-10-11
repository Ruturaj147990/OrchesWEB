import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";
import { ProjectProfile, projectFileList } from "../workspace/project-inspector.js";
import type { ProjectProfileDefinition } from "../domain/profiles/project-profiles.js";
import type { AutonomyMode } from "@orchestrator/shared-types";
import type { CandidateRequirement } from "../domain/blueprints/requirement-extractor.js";

export interface TaskPlan {
  title: string;
  acceptanceCriteria: string[];
  filesToRead: string[];
  /** "model" when the provider produced a usable plan, "fallback" when the task text was used directly. */
  source: "model" | "fallback";
  warning?: string;
}

const SYSTEM = `You plan one software change. Reply with a single JSON object and nothing else.`;

function fallbackPlan(taskText: string, warning: string): TaskPlan {
  const firstLine = taskText.trim().split(/\r?\n/)[0];
  return {
    title: firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine,
    acceptanceCriteria: [taskText.trim()],
    filesToRead: [],
    source: "fallback",
    warning,
  };
}

/**
 * Turns the user's task, profile, and blueprint into a short title, checkable
 * acceptance criteria and the files worth reading.
 */
export async function planTask(
  provider: ReasoningProvider,
  input: {
    projectId: string;
    runId: string;
    taskText: string;
    workspacePath: string;
    profile: ProjectProfile;
    profileDefinition?: ProjectProfileDefinition;
    autonomyMode?: AutonomyMode;
    blueprintRequirements?: CandidateRequirement[];
    signal?: AbortSignal;
  }
): Promise<TaskPlan> {
  const files = projectFileList(input.workspacePath, 200);

  const profileNote = input.profileDefinition
    ? `\nPROJECT PROFILE: ${input.profileDefinition.name} (${input.profileDefinition.description})\nFocus areas: ${input.profileDefinition.focusAreas.join(", ")}`
    : "";

  const blueprintNote = input.blueprintRequirements && input.blueprintRequirements.length > 0
    ? `\nRELEVANT BLUEPRINT REQUIREMENTS:\n${input.blueprintRequirements
        .slice(0, 10)
        .map((r) => `- [${r.id}] ${r.title}`)
        .join("\n")}`
    : "";

  const prompt = `TASK FROM THE USER:
${input.taskText.trim()}
${profileNote}
${blueprintNote}

PROJECT FILES (${files.length}${files.length >= 200 ? "+" : ""}):
${files.join("\n") || "(empty folder)"}

Respond with JSON:
{
  "title": "short imperative title, max 10 words",
  "acceptance_criteria": ["2 to 5 concrete, checkable statements that must be true when the task is done"],
  "files_to_read": ["existing files from the list above that the engineer must read or change"]
}
Only include criteria relevant to the task and project requirements. Do not add unrelated features.`;

  const response = await provider.generate(
    {
      operation: "task_planning",
      systemInstruction: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      json: true,
      temperature: 0,
      maxOutputTokens: 800,
      projectId: input.projectId,
      runId: input.runId,
    },
    input.signal
  );

  const parsed = (response.parsed ?? extractJsonFromText(response.text)) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return fallbackPlan(input.taskText, "The planner's response was not valid JSON; the task text is used as the acceptance criterion.");
  }
  const criteria = (Array.isArray(parsed.acceptance_criteria) ? parsed.acceptance_criteria : [])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 3)
    .map((c) => c.trim())
    .slice(0, 6);
  const known = new Map(files.map((f) => [f.toLowerCase(), f]));
  const filesToRead = (Array.isArray(parsed.files_to_read) ? parsed.files_to_read : [])
    .filter((f): f is string => typeof f === "string")
    .map((f) => known.get(f.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase()))
    .filter((f): f is string => Boolean(f))
    .slice(0, 12);
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 100) : "";

  if (criteria.length === 0 || !title) {
    const fb = fallbackPlan(input.taskText, "The planner's response was incomplete; the task text is used as the acceptance criterion.");
    return { ...fb, title: title || fb.title, filesToRead };
  }
  return { title, acceptanceCriteria: criteria, filesToRead, source: "model" };
}
