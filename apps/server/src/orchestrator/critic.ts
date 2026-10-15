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

  if (input.scopeNote) {
    sections.push(
      "",
      "## AGREED SCOPE (proposed by the reasoning model after declining part of the original request)",
      input.scopeNote.slice(0, 2000),
      "Judge the work against this agreed scope. Do NOT score the omission of declined parts as defects."
    );
  }

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

  if (input.auditStage) {
    sections.push(
      "",
      "## POST-ACCEPTANCE FULL-SYSTEM QUALITY AUDIT REPORT",
      input.auditReport || report || "(Full-system audit executed; verify findings and system readiness.)"
    );
  }

  sections.push(
    "",
    "## 7. Reviewer Instructions & Output Protocol",
    input.auditStage
      ? "You are conducting the FINAL AUDIT ASSESSMENT following the full-system quality inspection.\n" +
        "- If all subsystems (frontend, backend, database, security, performance, tests) are verified production-ready and NO remediation is required, issue ORCHES_REVIEW_STATUS: ACCEPT.\n" +
        "- An ACCEPT verdict MUST NOT contain actionable repair instructions or implementation prompts. Any actionable fix required means you MUST issue REPAIR.\n" +
        "- If any deficiency, bug, missing test, or quality issue remains, issue ORCHES_REVIEW_STATUS: REPAIR with concrete repair instructions for Antigravity to implement."
      : "Evaluate each active acceptance criterion based solely on the evidence in the diff and check results.\n" +
        "- If all active criteria are satisfied and no defects or test failures exist, issue an ACCEPT verdict.\n" +
        "- If any criterion is not met, automated checks failed, or a bug is found in the diff, issue a REPAIR verdict with concrete findings and specific repair instructions.\n" +
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
