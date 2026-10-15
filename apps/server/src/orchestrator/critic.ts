import { ReasoningProvider } from "../providers/reasoning/provider.js";
import type { CheckResult } from "../verification/runner.js";
import {
  formatDiffEvidence,
  formatChecksEvidence,
  calculateDiffCharBudget,
  splitDiffIntoReviewChunks,
  splitSingleFileDiffIntoSubchunks,
  createCoverageLedger,
  CHATGPT_WEB_SAFE_DIFF_CHUNK_CHARS,
  ReviewDiffChunk,
  ReviewCoverageLedger,
} from "./evidence-formatter.js";
import {
  parseReviewProtocol,
  isSubstantiveReviewCommentary,
  buildProtocolRecoveryPrompt,
  buildContradictoryVerdictRecoveryPrompt,
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
  /** Why the review is unavailable: the provider/transport failed, or a reply arrived but broke the protocol. */
  errorKind?: "provider" | "protocol";
  verdict: "accept" | "repair" | "blocked";
  criteria: CriticCriterion[];
  findings: CriticFinding[];
  repairInstructions: string[];
  summary: string;
  rawText?: string;
  coverageLedger?: ReviewCoverageLedger;
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
  auditStage?: boolean;
  auditReport?: string;
  /** Narrower scope the reasoning model proposed and Orches adopted after the full request was declined. */
  scopeNote?: string;
  /** Constraints from the requirement register. */
  constraints?: Array<{ id: string; text: string }>;
  /** One-paragraph goal from the requirement register. */
  goal?: string;
}

export const REVIEWER_SYSTEM = `You are the independent reviewer in Orches. You judge code changes against acceptance criteria and constraints using only the diff and the check results Orches ran; reports from the coding agent are unverified claims. Reply in the Orches review format, never JSON.`;

/** The review prompt: user request, criteria, constraints, scope, checks, diff, reports, verdict rules, format. */
export function buildReviewPrompt(input: ReviewAttemptInput): string {
  const taskText = (input.taskText || input.taskContext?.originalObjective || "").trim();
  const iter = input.iteration ?? input.taskContext?.iteration ?? 1;

  const acs = input.activeCriteria?.length ? input.activeCriteria : input.taskContext?.activeAcceptanceCriteria ?? [];
  const criteriaLines = acs.length
    ? acs.map((c) => `- ${c.id} ${c.description}${c.covers?.length ? ` (covers ${c.covers.join(", ")})` : ""}`)
    : input.criteria?.length
      ? input.criteria.map((c, i) => `- AC-${i + 1} ${c}`)
      : [`- AC-1 The task is fully implemented: ${taskText}`];

  let formattedDiffText: string;
  if (input.diffEvidence) {
    formattedDiffText = input.diffEvidence;
  } else {
    const changes = input.changes || input.taskContext?.latestChanges || [{ path: "workspace", kind: "modified" }];
    const rawDiff = input.diffText ?? input.taskContext?.latestDiffText ?? "";
    formattedDiffText = formatDiffEvidence(changes, rawDiff, input.maxDiffChars).formattedText;
  }
  const formattedChecksText = input.checksEvidence ?? formatChecksEvidence(input.checks || (input.taskContext?.latestChecks as any) || []);

  const s: string[] = [
    `# Orches review — iteration ${iter} — ${input.auditStage ? "AUDIT" : "IMPLEMENTATION"}`,
    "",
    "## Your task",
    input.auditStage
      ? "Judge the final audit: is the system complete and correct against every acceptance criterion and constraint, with nothing left to fix? Trust only the diff, Orches' check results and verifiable evidence; the agent's reports are unverified claims."
      : "Judge whether the changes meet every acceptance criterion and constraint. Trust only the diff and Orches' check results; the agent's report is an unverified claim.",
    "",
    "## User request (verbatim)",
    `"""\n${taskText}\n"""`,
  ];
  if (input.goal) s.push("", `Goal: ${input.goal}`);
  s.push("", "## Acceptance criteria (judge each one)", ...criteriaLines);
  if (input.constraints?.length) {
    s.push("", "## Constraints (a violation fails the criterion it affects and is a high finding)", ...input.constraints.map((c) => `- ${c.id} ${c.text}`));
  }
  const excluded = input.excludedRequirements || input.taskContext?.excludedRequirements || [];
  if (excluded.length) s.push("", "## Out of scope (do not require these)", ...excluded.map((e) => `- ${e.id} ${e.title}`));
  if (input.scopeNote) s.push("", "## Agreed scope (the request was narrowed to this; judge against it)", input.scopeNote.slice(0, 2000));
  const unresolved = input.previousFindings || input.taskContext?.unresolvedFindings || [];
  if (unresolved.length) s.push("", "## Findings from earlier reviews (check whether they are fixed)", ...unresolved.map((f) => `- [${(f.severity || "high").toUpperCase()}] ${f.message}`));
  s.push("", "## Checks run by Orches", formattedChecksText, "", "## Changes (diff)", formattedDiffText);
  const report = input.agentReport || input.agentReply;
  if (report?.trim()) s.push("", "## Agent report (unverified)", report.slice(0, 3000).trim());
  if (input.auditStage && (input.auditReport || "").trim() && input.auditReport !== report) s.push("", "## Audit report (unverified)", (input.auditReport || "").slice(0, 8000).trim());

  s.push(
    "",
    "## Verdict rules",
    "- ACCEPT: every criterion passed with evidence, no constraint violated, no high or critical finding, nothing left to fix.",
    "- REPAIR: anything the coding agent can fix. Give one specific repair instruction per problem.",
    "- BLOCKED: only when the evidence needed to judge the delivered code is missing (e.g. no diff).",
    "Judge from the code, the diff, the checks and the agent report. A runtime or platform constraint passes when the project declares and uses it correctly; facts about the machine or the workspace's history are not grounds to withhold acceptance.",
    "",
    "## Reply format (exact)",
    "ORCHES_REVIEW_STATUS: <ACCEPT | REPAIR | BLOCKED>",
    "[ORCHES_REVIEW]",
    "## Verdict",
    "<ACCEPT | REPAIR | BLOCKED>",
    "## Acceptance Criteria",
    "- AC-1 — <passed | failed | unverified> — <evidence>",
    "(one line for every criterion listed above)",
    "## Findings",
    "- <critical | high | medium | low>, <problem>, <file or component>",
    "(or (none))",
    "## Repair Instructions",
    "- <specific fix>",
    "(or (none))",
    "## Summary",
    "<one sentence>",
    "[/ORCHES_REVIEW]"
  );
  return s.join("\n");
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
 * Executes a single review prompt against the reasoning provider with retry handling
 * and dedicated protocol recovery when substantive commentary is returned without status headers.
 */
async function executeSingleReview(
  provider: ReasoningProvider,
  prompt: string,
  input: ReviewAttemptInput,
  options: {
    chunkIndex?: number;
    totalChunks?: number;
    operationId?: string;
  } = {}
): Promise<CriticOutcome> {
  let lastError = "";
  let lastErrorKind: "provider" | "protocol" = "protocol";
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: prompt },
  ];
  // ChatGPT Web keeps the whole conversation, so a follow-up only needs the short correction note; re-sending
  // the full review prompt would paste the (possibly very large) diff again. Stateless providers need it all.
  const statefulThread = provider.id === "chatgpt-web";
  let followUpNote: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const shortFollowUp = attempt > 1 && statefulThread && followUpNote;
      const response = await provider.generate(
        {
          operation: "result_review",
          operationId: shortFollowUp ? `${options.operationId || "result_review"}_format_retry` : options.operationId || "result_review",
          attempt: input.iteration ?? input.taskContext?.iteration ?? 1,
          stage: input.auditStage ? "audit" : "implementation",
          chunkIdentity: options.chunkIndex ? { chunkIndex: options.chunkIndex, totalChunks: options.totalChunks ?? 1 } : undefined,
          systemInstruction: REVIEWER_SYSTEM,
          messages: shortFollowUp ? [{ role: "user", content: followUpNote! }] : [...conversationMessages],
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

      // Protocol recovery: Handle either missing protocol delimiters OR contradictory review verdicts
      const isContradictory = parsedReview.validationError && parsedReview.validationError.includes("Contradictory review:");
      const needsRecovery = (isContradictory || isSubstantiveReviewCommentary(response.text)) && attempt === 1 && !input.signal?.aborted;

      if (needsRecovery) {
        const recoveryReason = isContradictory ? "contradictory verdict" : "missing protocol header";
        console.log(`[critic] GPT-Web returned ${recoveryReason}. Initiating protocol recovery...`);
        const recoveryPrompt = isContradictory
          ? buildContradictoryVerdictRecoveryPrompt(response.text, parsedReview.validationError || "")
          : buildProtocolRecoveryPrompt(response.text);
        const recoveryMessages: Array<{ role: "user" | "assistant"; content: string }> = statefulThread
          ? [{ role: "user", content: recoveryPrompt }]
          : [...conversationMessages, { role: "assistant", content: response.text }, { role: "user", content: recoveryPrompt }];

        try {
          const recoveredResponse = await provider.generate(
            {
              operation: "result_review",
              systemInstruction: REVIEWER_SYSTEM,
              messages: recoveryMessages,
              json: false,
              temperature: 0,
              maxOutputTokens: 2000,
              projectId: input.projectId || input.taskContext?.projectId || "default-project",
              runId: input.runId || input.taskContext?.runId,
              taskId: input.taskId || input.taskContext?.taskId,
            },
            input.signal
          );

          const recoveredParsed = parseReviewProtocol(recoveredResponse.text, { allowLegacyJson: true });
          if (recoveredParsed.status !== "INVALID") {
            console.log(`[critic] Protocol recovery successful: verdict ${recoveredParsed.verdict}`);
            return {
              available: true,
              verdict: recoveredParsed.verdict,
              criteria: recoveredParsed.criteria,
              findings: recoveredParsed.findings,
              repairInstructions: recoveredParsed.repairInstructions,
              summary: recoveredParsed.summary,
              rawText: `${response.text}\n\n[RECOVERED PROTOCOL]:\n${recoveredResponse.text}`,
            };
          }
        } catch (recErr) {
          console.warn(`[critic] Protocol recovery follow-up failed: ${(recErr as Error).message}`);
        }
      }

      lastError = parsedReview.validationError || "Review response did not adhere to review protocol";
      lastErrorKind = "protocol";
      followUpNote = buildProtocolRecoveryPrompt(response.text);
    } catch (err) {
      lastError = (err as Error).message;
      lastErrorKind = "provider";
      // A transport failure may have happened before the prompt reached ChatGPT: send the full prompt
      // again (the provider reconciles it if it was in fact submitted).
      followUpNote = null;
      if (input.signal?.aborted) break;
      if (lastError.includes("404") || lastError.includes("not found") || lastError.includes("ECONNREFUSED") || lastError.includes("unreachable")) break;
    }
  }

  return {
    available: false,
    error: lastError,
    errorKind: lastErrorKind,
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
  const isWebProvider = provider.id === "chatgpt-web";
  if (isWebProvider) {
    // For ChatGPT Web, large diffs are seamlessly digested in a single prompt via the browser's attachment card.
    // Keep only a single unified prompt containing the complete diff without fragmenting into multiple parts.
    const prompt = buildReviewPrompt({ ...input, maxDiffChars: Number.MAX_SAFE_INTEGER });
    return executeSingleReview(provider, prompt, input);
  }

  const contextTokens = typeof provider.getContextWindow === "function" ? provider.getContextWindow() : 32_768;
  const defaultBudget = calculateDiffCharBudget(contextTokens);
  const diffBudget = input.maxDiffChars || defaultBudget;

  const changes = input.changes || input.taskContext?.latestChanges || [];
  const rawDiff = input.diffText ?? input.taskContext?.latestDiffText ?? "";

  // Split diff into manageable chunks without dropping any evidence
  let chunks = splitDiffIntoReviewChunks(changes, rawDiff, diffBudget, input.taskId || "rev");

  if (chunks.length <= 1) {
    const prompt = buildReviewPrompt({ ...input, maxDiffChars: diffBudget });
    let singleResult = await executeSingleReview(provider, prompt, input);

    // If message is too long, retry by dividing into smaller subchunks
    const isTooLong = singleResult.error && (
      singleResult.error.toLowerCase().includes("too long") ||
      singleResult.error.toLowerCase().includes("message you submitted was too long") ||
      singleResult.error.toLowerCase().includes("context length exceeded")
    );

    if (!singleResult.available && isTooLong && rawDiff.length > 3_000) {
      console.warn("[critic] Single review failed with 'too long' error. Splitting diff into smaller subchunks and retrying...");
      const halvedBudget = Math.max(3_000, Math.floor(diffBudget / 2));
      chunks = splitDiffIntoReviewChunks(changes, rawDiff, halvedBudget, input.taskId || "rev");
      if (chunks.length <= 1) {
        return singleResult;
      }
      // Fall through to multi-chunk handling below
    } else {
      return singleResult;
    }
  }

  // Multi-chunk review with Coverage Ledger
  const ledger = createCoverageLedger(changes, chunks);
  const aggregatedCriteria: Map<string, CriticCriterion> = new Map();
  const aggregatedFindings: CriticFinding[] = [];
  const aggregatedRepairs: Set<string> = new Set();
  const summaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (input.signal?.aborted) break;
    const chunk = chunks[i];
    const ledgerRecord = ledger.chunks[i];

    console.log(`[critic] Evaluating diff evidence Part ${chunk.chunkIndex} of ${chunk.totalChunks} (files: ${chunk.files.join(", ")})...`);

    // Build chunk-specific review prompt
    const chunkPrompt = buildReviewPrompt({
      ...input,
      diffEvidence: chunk.formattedEvidence,
      maxDiffChars: diffBudget,
    });

    let chunkResult = await executeSingleReview(provider, chunkPrompt, input, {
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      operationId: `chunk_review_${chunk.chunkIndex}`,
    });

    // Retry further splitting if this specific chunk triggers a size error
    const isChunkTooLong = chunkResult.error && (
      chunkResult.error.toLowerCase().includes("too long") ||
      chunkResult.error.toLowerCase().includes("message you submitted was too long")
    );

    if (!chunkResult.available && isChunkTooLong && chunk.formattedEvidence.length > 4_000) {
      console.warn(`[critic] Chunk ${chunk.chunkIndex} failed with size error. Subdividing chunk evidence...`);
      const subChunks = splitDiffIntoReviewChunks(
        changes.filter((c) => chunk.files.includes(c.path)),
        chunk.formattedEvidence,
        Math.floor(diffBudget / 2),
        `${chunk.chunkId}-sub`
      );

      let subAllSuccess = true;
      for (const sc of subChunks) {
        const scPrompt = buildReviewPrompt({ ...input, diffEvidence: sc.formattedEvidence, maxDiffChars: diffBudget });
        const scResult = await executeSingleReview(provider, scPrompt, input);
        if (!scResult.available) {
          subAllSuccess = false;
          chunkResult = scResult;
          break;
        }
        for (const c of scResult.criteria) aggregatedCriteria.set(c.id, c);
        for (const f of scResult.findings) aggregatedFindings.push(f);
        for (const r of scResult.repairInstructions) aggregatedRepairs.add(r);
      }

      if (subAllSuccess) {
        ledgerRecord.submitted = true;
        ledgerRecord.usableAssessment = true;
        ledgerRecord.verdict = "accept";
        continue;
      }
    }

    if (!chunkResult.available) {
      ledgerRecord.submitted = true;
      ledgerRecord.usableAssessment = false;
      ledgerRecord.error = chunkResult.error;
      // If any required chunk is unavailable or fails transport/protocol, overall review cannot ACCEPT
      return {
        available: false,
        error: `Chunk review failed on Part ${chunk.chunkIndex}/${chunk.totalChunks}: ${chunkResult.error}`,
        errorKind: chunkResult.errorKind,
        verdict: "repair",
        criteria: [...aggregatedCriteria.values()],
        findings: aggregatedFindings,
        repairInstructions: [...aggregatedRepairs],
        summary: `Review incomplete: Chunk ${chunk.chunkIndex} could not be evaluated.`,
        coverageLedger: ledger,
      };
    }

    ledgerRecord.submitted = true;
    ledgerRecord.usableAssessment = true;
    ledgerRecord.verdict = chunkResult.verdict;
    ledgerRecord.findings = [...chunkResult.findings];
    ledgerRecord.unresolvedIssues = [...chunkResult.repairInstructions];

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

    if (chunkResult.summary) {
      summaries.push(`[Part ${chunk.chunkIndex}/${chunk.totalChunks}]: ${chunkResult.summary}`);
    }
  }

  // Synthesis verification: Check if all chunks and files were covered
  if (!ledger.isComplete()) {
    const unreviewed = ledger.unreviewedFiles();
    return {
      available: false,
      error: `Incomplete diff evidence coverage. Unreviewed files: ${unreviewed.join(", ")}`,
      errorKind: "protocol",
      verdict: "repair",
      criteria: [...aggregatedCriteria.values()],
      findings: aggregatedFindings,
      repairInstructions: [...aggregatedRepairs],
      summary: `Review halted: ${unreviewed.length} changed files were not successfully reviewed.`,
      coverageLedger: ledger,
    };
  }

  // Cross-file synthesis review pass when multi-file changes exist and there are findings/unverified items to synthesize
  const hasItemsToSynthesize = aggregatedFindings.length > 0 || [...aggregatedCriteria.values()].some((c) => c.status !== "passed");
  if (chunks.length > 1 && hasItemsToSynthesize && !input.signal?.aborted) {
    const crossFileSynthesisPrompt = [
      "# CROSS-FILE INTEGRATION & SYNTHESIS REVIEW",
      "",
      `Task: ${(input.taskText || "").trim()}`,
      "",
      `All ${chunks.length} evidence chunks covering ${ledger.allFiles.length} file(s) have been individually reviewed.`,
      "Review Findings Across Chunks:",
      ...aggregatedFindings.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`),
      "",
      "Active Criteria Status Across Chunks:",
      ...[...aggregatedCriteria.values()].map((c) => `- ${c.id}: ${c.status} (${c.reason})`),
      "",
      "Review the cross-file interactions, imports, shared contracts, and integration risks across these files.",
      "Issue the final synthesis verdict in the standard Orches review protocol:",
      "ORCHES_REVIEW_STATUS: <ACCEPT | REPAIR | BLOCKED>",
      "",
      "[ORCHES_REVIEW]",
      "## Verdict",
      "<ACCEPT | REPAIR | BLOCKED>",
      "## Acceptance Criteria",
      "- AC-1 — <passed | failed | unverified> — <cross-file evidence>",
      "## Findings",
      "- <Severity>, <cross-file issue>, <component>",
      "## Repair Instructions",
      "- <repair instruction or (none)>",
      "## Summary",
      "<Overall integration synthesis summary>",
      "[/ORCHES_REVIEW]",
    ].join("\n");

    try {
      const synthesisResult = await executeSingleReview(provider, crossFileSynthesisPrompt, input, {
        operationId: "cross_file_synthesis",
      });
      if (synthesisResult.available) {
        // Merge synthesis criteria & findings
        for (const c of synthesisResult.criteria) {
          if (c.status === "failed") aggregatedCriteria.set(c.id, c);
        }
        for (const f of synthesisResult.findings) {
          if (!aggregatedFindings.some((af) => af.message === f.message)) {
            aggregatedFindings.push(f);
          }
        }
        for (const r of synthesisResult.repairInstructions) {
          aggregatedRepairs.add(r);
        }
        if (synthesisResult.summary) {
          summaries.push(`[Synthesis]: ${synthesisResult.summary}`);
        }
      }
    } catch (synthErr) {
      console.warn(`[critic] Cross-file synthesis pass warning: ${(synthErr as Error).message}`);
    }
  }

  const allCriteria = [...aggregatedCriteria.values()];
  const hasFailedCriterion = allCriteria.some((c) => c.status === "failed");
  const hasUnverifiedCriterion = allCriteria.some((c) => c.status === "unverified");
  const hasCriticalFinding = aggregatedFindings.some((f) => f.severity === "high" || f.severity === "critical");
  const hasRepairs = aggregatedRepairs.size > 0;
  const anyChunkSummaryDemandsChanges = summaries.some((s) =>
    /before (?:it can be accepted|acceptance|accepting)/i.test(s) ||
    /cannot be accepted/i.test(s) ||
    /remains (?:unmet|failed)/i.test(s) ||
    /must (?:be reduced|be removed|be fixed|remove|fix) before/i.test(s) ||
    /fundamental (?:defect|violation)/i.test(s)
  );

  const verdict = (hasFailedCriterion || hasCriticalFinding || hasRepairs || anyChunkSummaryDemandsChanges)
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
    coverageLedger: ledger,
  };
}
