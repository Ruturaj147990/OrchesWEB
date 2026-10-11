import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";
import type { CheckResult } from "../verification/runner.js";

export interface CriticCriterion {
  id: string;
  status: "passed" | "failed" | "unverified";
  reason: string;
}

export interface CriticFinding {
  severity: "low" | "medium" | "high" | "critical";
  message: string;
}

export interface CriticOutcome {
  available: boolean;
  error?: string;
  verdict: "accept" | "repair";
  criteria: CriticCriterion[];
  findings: CriticFinding[];
  repairInstructions: string[];
  summary: string;
}

const SYSTEM = `You are an independent code reviewer. You judge whether a diff completes a task.
You only trust the diff and the check results shown to you, not anyone's claims. Reply with one JSON object.`;

const MAX_DIFF_CHARS = 20_000;

export function normalizeCriticJson(raw: unknown): Omit<CriticOutcome, "available"> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const verdictRaw = String(obj.verdict ?? "").toLowerCase();
  if (!verdictRaw) return null;
  const verdict: "accept" | "repair" = verdictRaw.startsWith("accept") || verdictRaw === "pass" || verdictRaw === "approve" ? "accept" : "repair";

  const crit: CriticCriterion[] = (Array.isArray(obj.criteria) ? obj.criteria : []).map((c: any, i: number) => {
    const status = String(c?.status ?? "").toLowerCase();
    return {
      id: String(c?.id ?? `AC-${i + 1}`),
      status: status === "passed" || status === "pass" || status === "met" ? "passed" : status === "failed" || status === "fail" || status === "not met" ? "failed" : "unverified",
      reason: typeof c?.reason === "string" ? c.reason : "",
    } as CriticCriterion;
  });
  const findings: CriticFinding[] = (Array.isArray(obj.findings) ? obj.findings : [])
    .map((f: any) => {
      const sev = String(f?.severity ?? "low").toLowerCase();
      return {
        severity: (["low", "medium", "high", "critical"].includes(sev) ? sev : "low") as CriticFinding["severity"],
        message: typeof f === "string" ? f : String(f?.message ?? ""),
      };
    })
    .filter((f: CriticFinding) => f.message.trim().length > 0);
  const repairInstructions = (Array.isArray(obj.repair_instructions) ? obj.repair_instructions : []).filter((r): r is string => typeof r === "string");
  return { verdict, criteria: crit, findings, repairInstructions, summary: typeof obj.summary === "string" ? obj.summary : "" };
}

/**
 * Independent review of an attempt. Its verdict is advisory input to the
 * deterministic gate: it can block with concrete reasons, but it can never
 * turn failing checks into a pass.
 */
export async function reviewAttempt(
  provider: ReasoningProvider,
  input: {
    projectId: string;
    runId: string;
    taskId: string;
    taskText: string;
    criteria: string[];
    diffText: string;
    checks: CheckResult[];
    signal?: AbortSignal;
  }
): Promise<CriticOutcome> {
  const diff = input.diffText.length > MAX_DIFF_CHARS ? `${input.diffText.slice(0, MAX_DIFF_CHARS)}\n…(diff truncated)` : input.diffText;
  const checks = input.checks.length
    ? input.checks.map((c) => `- ${c.label}: ${c.status}${c.exitCode !== null ? ` (exit ${c.exitCode})` : ""}${c.status !== "passed" && c.output ? `\n  ${c.output.split("\n").slice(-8).join("\n  ")}` : ""}`).join("\n")
    : "- none (the project has no automated checks)";
  const prompt = `TASK:
${input.taskText.trim()}

ACCEPTANCE CRITERIA:
${input.criteria.map((c, i) => `AC-${i + 1}: ${c}`).join("\n")}

CHECK RESULTS (run by the orchestrator, trustworthy):
${checks}

DIFF OF ALL CHANGES:
${diff || "(no changes)"}

Judge each criterion from the diff. Respond with JSON:
{
  "verdict": "accept" or "repair",
  "criteria": [{"id": "AC-1", "status": "passed" | "failed" | "unverified", "reason": "short evidence from the diff"}],
  "findings": [{"severity": "low" | "medium" | "high" | "critical", "message": "real bug or problem in the diff"}],
  "repair_instructions": ["specific fix, only if verdict is repair"],
  "summary": "one sentence"
}
Use "repair" only for a concrete problem you can point to in the diff (a criterion clearly not met, or a real bug). Style preferences are "low" findings.`;

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await provider.generate(
        {
          operation: "result_review",
          systemInstruction: SYSTEM,
          messages: [{ role: "user", content: prompt }],
          json: true,
          temperature: 0,
          maxOutputTokens: 1200,
          projectId: input.projectId,
          runId: input.runId,
          taskId: input.taskId,
        },
        input.signal
      );
      const normalized = normalizeCriticJson(response.parsed ?? extractJsonFromText(response.text));
      if (normalized) return { available: true, ...normalized };
      lastError = "review response was not valid JSON with a verdict";
    } catch (err) {
      lastError = (err as Error).message;
      if (input.signal?.aborted) break;
    }
  }
  return { available: false, error: lastError, verdict: "repair", criteria: [], findings: [], repairInstructions: [], summary: "" };
}
