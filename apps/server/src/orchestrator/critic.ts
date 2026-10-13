import { ReasoningProvider } from "../providers/reasoning/provider.js";
import type { CheckResult } from "../verification/runner.js";
import {
  formatDiffEvidence,
  formatChecksEvidence,
  calculateDiffCharBudget,
  splitDiffIntoReviewChunks,
} from "./evidence-formatter.js";
import {
  parseReviewProtocol,
  type ParsedReview,
  type ParsedReviewCriterion,
  type ParsedReviewFinding,
} from "../prompts/review-validator.js";
import type {
  AuthoritativeTaskContext,
  AuthoritativeAcceptanceCriterion,
  AuthoritativeExcludedRequirement,
} from "./task-context.js";

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
  verdict: "accept" | "repair" | "blocked";
  criteria: CriticCriterion[];
  findings: CriticFinding[];
  repairInstructions: string[];
  summary: string;
  rawText?: string;
}

export interface ReviewAttemptInput {
  projectId?: string;
  runId?: string;
  taskId?: string;
  iteration?: number;
  taskText?: string;
  criteria?: string[];
  taskContext?: AuthoritativeTaskContext;
  activeCriteria?: AuthoritativeAcceptanceCriterion[];
  excludedRequirements?: AuthoritativeExcludedRequirement[];
  diffText?: string;
  diffEvidence?: string;
  changes?: Array<{ path: string; kind: string; additions?: number; deletions?: number }>;
  checks?: CheckResult[];
  checksEvidence?: string;
  /** The coding agent's own description of its work (an unverified claim). */
  agentReport?: string;
  agentReply?: string;
  previousFindings?: CriticFinding[];
  signal?: AbortSignal;
  maxDiffChars?: number;
}

export const REVIEWER_SYSTEM = `You are an independent, rigorous code reviewer in the Orches autonomous development system.
You judge whether an implementation diff completes the assigned task and satisfies all active acceptance criteria.
You only trust the actual diff and the automated check results shown to you, not anyone's unverified claims.
You must reply using the Orches natural-language review protocol.
Do NOT return a JSON object. Do NOT wrap your response in JSON.`;

/**
 * Builds the complete, deterministic review prompt for iteration 2 onward.
 * Eliminates JSON instructions, presents canonical criteria, and truthfully represents
 * diff and test execution evidence.
 */
export function buildReviewPrompt(input: ReviewAttemptInput): string {
  const taskText = (input.taskText || input.taskContext?.originalObjective || "").trim();
  const iter = input.iteration ?? (input.taskContext?.iteration ? input.taskContext.iteration : 2);

  // 1. Acceptance Criteria: prioritize canonical authoritative criteria
  const criteriaLines: string[] = [];
  if (input.activeCriteria && input.activeCriteria.length > 0) {
    for (const c of input.activeCriteria) {
      criteriaLines.push(`- **[${c.id}]** ${c.title}: ${c.description} (Expected: ${c.expectedResult})`);
    }
  } else if (input.taskContext?.activeAcceptanceCriteria && input.taskContext.activeAcceptanceCriteria.length > 0) {
    for (const c of input.taskContext.activeAcceptanceCriteria) {
      criteriaLines.push(`- **[${c.id}]** ${c.title}: ${c.description} (Expected: ${c.expectedResult})`);
    }
  } else if (input.criteria && input.criteria.length > 0) {
    input.criteria.forEach((c, i) => {
      criteriaLines.push(`- **[AC-${i + 1}]** ${c}`);
    });
  } else {
    criteriaLines.push(`- **[AC-1]** Complete implementation of task: ${taskText}`);
  }

  // 2. Excluded Requirements: present so reviewer does not mistakenly treat omitted out-of-scope items as defects
  const excludedLines: string[] = [];
  const excludedItems = input.excludedRequirements || input.taskContext?.excludedRequirements || [];
  if (excludedItems.length > 0) {
    for (const ex of excludedItems) {
      excludedLines.push(`- **[${ex.id}]** (EXCLUDED / ${ex.scopeStatus.toUpperCase()}): ${ex.title} — *${ex.reason}*`);
    }
  }

  // 3. Diff Evidence Formatting
  let formattedDiffText: string;
  if (input.diffEvidence) {
    formattedDiffText = input.diffEvidence;
  } else {
    const changes = input.changes || input.taskContext?.latestChanges || [{ path: "workspace", kind: "modified" }];
    const rawDiff = input.diffText ?? input.taskContext?.latestDiffText ?? "";
    formattedDiffText = formatDiffEvidence(changes, rawDiff, input.maxDiffChars).formattedText;
  }

  // 4. Automated Checks Formatting
  let formattedChecksText: string;
  if (input.checksEvidence) {
    formattedChecksText = input.checksEvidence;
  } else {
    const checks = input.checks || (input.taskContext?.latestChecks as any) || [];
    formattedChecksText = formatChecksEvidence(checks);
  }

  const sections: string[] = [
    `# INDEPENDENT IMPLEMENTATION REVIEW (ITERATION ${iter})`,
    "",
    "## 1. Task Objective",
    taskText,
    "",
    "## 2. Active Acceptance Criteria to Verify",
    criteriaLines.join("\n"),
  ];

  if (excludedLines.length > 0) {
    sections.push(
      "",
      "## 3. Scope Boundaries & Excluded Requirements (DO NOT SCORE AS DEFECTS)",
      "The following items from the source specification are explicitly out of scope or in safety conflict for this task.",
      "Do NOT flag their omission as a failure:",
      excludedLines.join("\n")
    );
  }

  const unresolved = input.previousFindings || input.taskContext?.unresolvedFindings || [];
  if (unresolved.length > 0) {
    sections.push(
      "",
      "## PREVIOUS UNRESOLVED REVIEW FINDINGS",
      "The following findings from earlier review iterations remain unresolved and must be verified in the latest diff:",
      ...unresolved.map((f) => `- **[${f.severity?.toUpperCase() || "HIGH"}]** ${f.message}`)
    );
  }

  sections.push(
    "",
    "## 4. Automated Verification Results (Run by Orchestrator)",
    formattedChecksText,
    "",
    "## 5. Implementation Changes & Diff Evidence",
    formattedDiffText
  );

  const report = input.agentReport || input.agentReply;
  if (report && report.trim()) {
    sections.push(
      "",
      "## 6. Coding Agent Report (Unverified Claim — Verify Against Diff)",
      report.slice(0, 2000).trim()
    );
  }

  sections.push(
    "",
    "## 7. Reviewer Instructions & Output Protocol",
    "Evaluate each active acceptance criterion based solely on the evidence in the diff and check results.",
    "- If all active criteria are satisfied and no defects or test failures exist, issue an ACCEPT verdict.",
    "- If any criterion is not met, automated checks failed, or a bug is found in the diff, issue a REPAIR verdict with concrete findings and specific repair instructions.",
    "- If evidence is genuinely missing/blocked, issue a BLOCKED verdict.",
    "",
    "Do NOT return a JSON object. You MUST reply using the following natural-language review protocol:",
    "",
    "For a REPAIR decision:",
    "ORCHES_REVIEW_STATUS: REPAIR",
    "",
    "[ORCHES_REVIEW]",
    "",
    "## Verdict",
    "REPAIR",
    "",
    "## Acceptance Criteria",
    "- AC-1 — <passed | failed | unverified> — <concise evidence from diff>",
    "- AC-2 — <passed | failed | unverified> — <concise evidence from diff>",
    "",
    "## Findings",
    "- <Severity (low|medium|high|critical)>, <concrete issue>, <affected component>",
    "",
    "## Repair Instructions",
    "- <Specific, actionable repair supported by the evidence>",
    "",
    "## Summary",
    "<One concise sentence describing the review outcome.>",
    "",
    "[/ORCHES_REVIEW]",
    "",
    "For an ACCEPT decision:",
    "ORCHES_REVIEW_STATUS: ACCEPT",
    "",
    "[ORCHES_REVIEW]",
    "",
    "## Verdict",
    "ACCEPT",
    "",
    "## Acceptance Criteria",
    "- AC-1 — passed — <concise evidence from diff>",
    "",
    "## Findings",
    "(none)",
    "",
    "## Repair Instructions",
    "(none)",
    "",
    "## Summary",
    "<One concise sentence confirming all acceptance criteria are verified.>",
    "",
    "[/ORCHES_REVIEW]",
    "",
    "For a BLOCKED decision:",
    "ORCHES_REVIEW_STATUS: BLOCKED",
    "",
    "[ORCHES_REVIEW]",
    "",
    "## Verdict",
    "BLOCKED",
    "",
    "## Acceptance Criteria",
    "- AC-1 — unverified — <reason>",
    "",
    "## Findings",
    "- Critical, <blocker issue>, <component>",
    "",
    "## Repair Instructions",
    "- <Action required to unblock>",
    "",
    "## Summary",
    "<Clear explanation of why review is blocked.>",
    "",
    "[/ORCHES_REVIEW]"
  );

  return sections.join("\n");
}

/**
 * Normalizes legacy JSON critic responses (kept strictly for backward compatibility
 * with internal test doubles and unit tests).
 */
export function normalizeCriticJson(raw: unknown): Omit<CriticOutcome, "available"> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const verdictRaw = String(obj.verdict ?? "").toLowerCase();
  if (!verdictRaw) return null;
  const verdict: "accept" | "repair" | "blocked" =
    verdictRaw.startsWith("accept") || verdictRaw === "pass" || verdictRaw === "approve"
      ? "accept"
      : verdictRaw.includes("block")
        ? "blocked"
        : "repair";

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
 * Independent review of an attempt using the deterministic natural-language review protocol.
/**
 * Executes a single review prompt against the reasoning provider with retry handling.
 */
async function executeSingleReview(
  provider: ReasoningProvider,
  prompt: string,
  input: ReviewAttemptInput
): Promise<CriticOutcome> {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await provider.generate(
        {
          operation: "result_review",
          systemInstruction: REVIEWER_SYSTEM,
          messages: [{ role: "user", content: prompt }],
          json: false, // MANDATORY: ChatGPT Web must never be told to produce JSON-only responses
          temperature: 0,
          maxOutputTokens: 2000,
          projectId: input.projectId || input.taskContext?.projectId || "default-project",
          runId: input.runId || input.taskContext?.runId,
          taskId: input.taskId || input.taskContext?.taskId,
        },
        input.signal
      );

      // Check if provider returned already parsed object (e.g. test double)
      if (response.parsed && typeof response.parsed === "object") {
        const normalized = normalizeCriticJson(response.parsed);
        if (normalized) {
          return { available: true, rawText: response.text, ...normalized };
        }
      }

      // Parse the natural-language review protocol
      const parsedReview: ParsedReview = parseReviewProtocol(response.text, { allowLegacyJson: true });

      if (parsedReview.status !== "INVALID") {
        return {
          available: true,
          verdict: parsedReview.verdict,
          criteria: parsedReview.criteria,
          findings: parsedReview.findings,
          repairInstructions: parsedReview.repairInstructions,
          summary: parsedReview.summary,
          rawText: response.text,
        };
      }

      lastError = parsedReview.validationError || "Review response did not adhere to review protocol";
    } catch (err) {
      lastError = (err as Error).message;
      if (input.signal?.aborted) break;
      if (lastError.includes("404") || lastError.includes("not found") || lastError.includes("ECONNREFUSED") || lastError.includes("unreachable")) break;
    }
  }

  return {
    available: false,
    error: lastError,
    verdict: "repair",
    criteria: [],
    findings: [],
    repairInstructions: [],
    summary: "",
  };
}

/**
 * Independent review of an attempt using the deterministic natural-language review protocol.
 * Evaluates the actual diff and automated checks without demanding JSON from ChatGPT Web.
 * Uses dynamic context budgeting and chunked review for large diffs.
 */
export async function reviewAttempt(
  provider: ReasoningProvider,
  input: ReviewAttemptInput
): Promise<CriticOutcome> {
  const contextTokens = typeof provider.getContextWindow === "function" ? provider.getContextWindow() : 32_768;
  const diffBudget = input.maxDiffChars || calculateDiffCharBudget(contextTokens);

  const changes = input.changes || input.taskContext?.latestChanges || [];
  const rawDiff = input.diffText ?? input.taskContext?.latestDiffText ?? "";

  // Check if chunked review is needed
  const chunks = splitDiffIntoReviewChunks(changes, rawDiff, diffBudget);

  if (chunks.length <= 1) {
    const prompt = buildReviewPrompt({ ...input, maxDiffChars: diffBudget });
    return executeSingleReview(provider, prompt, input);
  }

  // Multi-chunk review: review all chunks and synthesize evidence
  const aggregatedCriteria: Map<string, CriticCriterion> = new Map();
  const aggregatedFindings: CriticFinding[] = [];
  const aggregatedRepairs: Set<string> = new Set();
  const summaries: string[] = [];
  const reviewedFiles: string[] = [];

  for (const chunk of chunks) {
    if (input.signal?.aborted) break;
    const chunkPrompt = buildReviewPrompt({
      ...input,
      diffEvidence: chunk.formattedEvidence,
      maxDiffChars: diffBudget,
    });
    const chunkResult = await executeSingleReview(provider, chunkPrompt, input);
    if (!chunkResult.available) {
      return chunkResult; // Return early if provider unavailable
    }
    reviewedFiles.push(...chunk.files);
    for (const c of chunkResult.criteria) {
      const existing = aggregatedCriteria.get(c.id);
      if (!existing || c.status === "failed") {
        aggregatedCriteria.set(c.id, c);
      } else if (existing.status === "unverified" && c.status === "passed") {
        aggregatedCriteria.set(c.id, c);
      }
    }
    for (const f of chunkResult.findings) {
      if (!aggregatedFindings.some((af) => af.message === f.message)) {
        aggregatedFindings.push(f);
      }
    }
    for (const r of chunkResult.repairInstructions) {
      aggregatedRepairs.add(r);
    }
    if (chunkResult.summary) summaries.push(`[Part ${chunk.chunkIndex}/${chunk.totalChunks}]: ${chunkResult.summary}`);
  }

  const allCriteria = [...aggregatedCriteria.values()];
  const hasFailedCriterion = allCriteria.some((c) => c.status === "failed");
  const hasUnverifiedCriterion = allCriteria.some((c) => c.status === "unverified");
  const hasCriticalFinding = aggregatedFindings.some((f) => f.severity === "high" || f.severity === "critical");

  const verdict = (hasFailedCriterion || hasCriticalFinding)
    ? "repair"
    : hasUnverifiedCriterion
      ? "repair"
      : "accept";

  return {
    available: true,
    verdict,
    criteria: allCriteria,
    findings: aggregatedFindings,
    repairInstructions: [...aggregatedRepairs],
    summary: summaries.join("; ") || (verdict === "accept" ? "All diff chunks reviewed and criteria verified." : "Review completed across chunks with repair items noted."),
  };
}
