import { extractJsonFromText } from "./json-extractor.js";

export type ReviewVerdict = "accept" | "repair" | "blocked";

export interface ParsedReviewCriterion {
  id: string; // e.g. "AC-1", "AC-2", "REQ-001"
  status: "passed" | "failed" | "unverified";
  reason: string;
}

export interface ParsedReviewFinding {
  severity: "low" | "medium" | "high" | "critical";
  message: string;
}

export interface ParsedReview {
  status: "ACCEPT" | "REPAIR" | "BLOCKED" | "INVALID";
  verdict: ReviewVerdict;
  criteria: ParsedReviewCriterion[];
  findings: ParsedReviewFinding[];
  repairInstructions: string[];
  summary: string;
  rawText: string;
  validationError?: string;
  isLegacyJson?: boolean;
}

export const REVIEW_STATUS_PREFIX = "ORCHES_REVIEW_STATUS:";
export const REVIEW_MARKER_START = "[ORCHES_REVIEW]";
export const REVIEW_MARKER_END = "[/ORCHES_REVIEW]";

/**
 * Deterministic parser for the Orches natural-language review protocol.
 * Validates protocol status, delimiters, required sections, and logical consistency.
 */
export function parseReviewProtocol(
  rawText: string,
  options: { allowLegacyJson?: boolean } = {}
): ParsedReview {
  const clean = (rawText || "").trim();

  if (!clean) {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: "Review response text is empty",
    };
  }

  // 1. Detect protocol status line: ORCHES_REVIEW_STATUS: ACCEPT | REPAIR | BLOCKED
  const statusMatch = clean.match(/(?:^|\r?\n)\s*ORCHES_REVIEW_STATUS:\s*([A-Za-z0-9_-]+)/i);

  if (!statusMatch) {
    // If protocol marker is absent, test for legacy JSON double fallback if permitted
    if (options.allowLegacyJson) {
      const parsedJson = extractJsonFromText(clean);
      if (parsedJson && typeof parsedJson === "object" && parsedJson.verdict) {
        return parseLegacyJsonReview(parsedJson, clean);
      }
    }

    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: "Missing protocol status line: ORCHES_REVIEW_STATUS: ACCEPT | REPAIR | BLOCKED",
    };
  }

  const statusHeader = statusMatch[1].toUpperCase().trim();
  if (statusHeader !== "ACCEPT" && statusHeader !== "REPAIR" && statusHeader !== "BLOCKED") {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: `Unrecognized review status '${statusHeader}'. Expected ACCEPT, REPAIR, or BLOCKED.`,
    };
  }

  // 2. Validate delimiter presence and integrity
  const startIdx = clean.indexOf(REVIEW_MARKER_START);
  const endIdx = clean.indexOf(REVIEW_MARKER_END);

  if (startIdx === -1) {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: "Missing opening review delimiter [ORCHES_REVIEW]",
    };
  }

  if (endIdx === -1) {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: "Missing closing review delimiter [/ORCHES_REVIEW] (response may be truncated)",
    };
  }

  if (endIdx <= startIdx) {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: "Reversed delimiters: closing delimiter [/ORCHES_REVIEW] appears before opening delimiter",
    };
  }

  const reviewBody = clean.slice(startIdx + REVIEW_MARKER_START.length, endIdx).trim();

  // 3. Parse Sections inside [ORCHES_REVIEW]
  const parsedSections = parseSections(reviewBody);

  // The status line is authoritative. Free text in the Verdict section ("REPAIR — not acceptable",
  // "cannot accept") must never flip a REPAIR into an ACCEPT; a real disagreement is sent for recovery.
  const verdict: ReviewVerdict = statusHeader === "ACCEPT" ? "accept" : statusHeader === "BLOCKED" ? "blocked" : "repair";
  const sectionWord = (parsedSections["verdict"] || "").trim().toUpperCase().match(/^[^A-Z]*(ACCEPT|REPAIR|BLOCKED)\b/)?.[1];
  if (verdict === "accept" && sectionWord && sectionWord !== "ACCEPT") {
    return {
      status: "INVALID",
      verdict: "repair",
      criteria: [],
      findings: [],
      repairInstructions: [],
      summary: "",
      rawText: clean,
      validationError: `Contradictory review: status line says ACCEPT but the Verdict section says ${sectionWord}`,
    };
  }

  // Acceptance Criteria section
  const criteria = parseCriteriaList(parsedSections["acceptance criteria"] || "");

  // Findings section
  const findings = parseFindingsList(parsedSections["findings"] || "");

  // Repair Instructions section
  const repairInstructions = parseListItems(parsedSections["repair instructions"] || parsedSections["repairs"] || "");

  // Summary section
  let summary = (parsedSections["summary"] || "").trim();
  if (!summary) {
    // If summary header was missing, look for a trailing line
    const lines = reviewBody.split("\n").map((l) => l.trim()).filter(Boolean);
    summary = lines[lines.length - 1] || `${verdict.toUpperCase()} review verdict recorded.`;
  }

  // 4. Integrity and Consistency Rules
  if (verdict === "accept") {
    const failedCriteria = criteria.filter((c) => c.status === "failed");
    if (failedCriteria.length > 0) {
      return {
        status: "INVALID",
        verdict: "repair",
        criteria,
        findings,
        repairInstructions,
        summary,
        rawText: clean,
        validationError: `Contradictory review: Verdict is ACCEPT but criterion ${failedCriteria.map((c) => c.id).join(", ")} is marked failed`,
      };
    }

    const severeFindings = findings.filter((f) => f.severity === "high" || f.severity === "critical");
    if (severeFindings.length > 0) {
      return {
        status: "INVALID",
        verdict: "repair",
        criteria,
        findings,
        repairInstructions,
        summary,
        rawText: clean,
        validationError: `Contradictory review: Verdict is ACCEPT but high/critical findings were reported: ${severeFindings.map((f) => f.message).join("; ")}`,
      };
    }

    if (repairInstructions.length > 0) {
      return {
        status: "INVALID",
        verdict: "repair",
        criteria,
        findings,
        repairInstructions,
        summary,
        rawText: clean,
        validationError: `Contradictory review: Verdict is ACCEPT but actionable repair instructions were provided: ${repairInstructions.join("; ")}`,
      };
    }

    // Semantic Contradiction Detection: Check if summary or substantive review commentary
    // explicitly declares unmet criteria, required changes before acceptance, or fundamental defects.
    const contradiction = detectAcceptContradiction(summary, reviewBody, criteria, findings);
    if (contradiction) {
      return {
        status: "INVALID",
        verdict: "repair",
        criteria,
        findings,
        repairInstructions,
        summary,
        rawText: clean,
        validationError: `Contradictory review: Verdict is ACCEPT but substantive review states: ${contradiction}`,
      };
    }
  }

  return {
    status: statusHeader as "ACCEPT" | "REPAIR" | "BLOCKED",
    verdict,
    criteria,
    findings,
    repairInstructions,
    summary,
    rawText: clean,
  };
}

/**
 * Splits markdown content by ## Headings into normalized section keys.
 */
function parseSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let currentKey = "general";
  let currentLines: string[] = [];

  for (const line of lines) {
    // Replies read from the rendered chat lose "##"; a known section name on its own line is a heading too.
    const headingMatch =
      line.match(/^#{1,3}\s+(.+)$/) ??
      line.trim().match(/^\**\s*(verdict|acceptance criteria|findings|repair instructions|repairs|summary)\s*\**\s*:?\s*\**$/i);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections[currentKey] = currentLines.join("\n").trim();
        currentLines = [];
      }
      currentKey = headingMatch[1].toLowerCase().trim();
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections[currentKey] = currentLines.join("\n").trim();
  }

  return sections;
}

/**
 * Parses acceptance criteria bullet items:
 * - AC-1 — passed — concise evidence
 * - AC-2: failed: reason
 */
function parseCriteriaList(text: string): ParsedReviewCriterion[] {
  const results: ParsedReviewCriterion[] = [];
  // Bulleted lines, or (rendered replies lose list markers) lines that start with a criterion id.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•\d\.)]/.test(l) || /^[A-Z][A-Z0-9]{0,6}-[A-Z0-9]+\b/.test(l));

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/^[-*•\d\.)\s]+/, "");
    // Match ID, status, and reason across common separators: "—", "-", ":", "|"
    const parts = line.split(/\s*(?:—|–| - |:\s+|\|\s*)\s*/);
    const rawId = parts[0]?.trim() || `AC-${idx + 1}`;
    const idMatch = rawId.match(/([A-Za-z0-9_-]+)/);
    const id = idMatch ? idMatch[1] : `AC-${idx + 1}`;

    const rawStatus = (parts[1] || "").toLowerCase().trim();
    let status: "passed" | "failed" | "unverified" = "unverified";

    // Negative forms first: "not met" / "unmet" / "not passed" contain the positive words.
    if (/\b(fail(ed|s|ing)?|not\s+met|unmet|not\s+pass(ed)?|not\s+satisfied|unsatisfied|reject(ed)?|missing|broken)\b/.test(rawStatus)) {
      status = "failed";
    } else if (/\b(unverified|not\s+verified|unknown|partial(ly)?|pending|not\s+(tested|shown))\b/.test(rawStatus)) {
      status = "unverified";
    } else if (/\b(pass(ed|es)?|met|satisfied|ok|verified|done|completed?)\b/.test(rawStatus)) {
      status = "passed";
    }

    const reason = parts.slice(2).join(" — ").trim() || (parts[1] ? parts[1].trim() : "");
    results.push({ id, status, reason });
  }

  return results;
}

/**
 * Parses finding bullets:
 * - High, issue with database connection, backend
 * - Medium: concrete issue
 */
function parseFindingsList(text: string): ParsedReviewFinding[] {
  const results: ParsedReviewFinding[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•\d\.)]/.test(l) || /^(critical|high|medium|low)\b/i.test(l));

  for (const line of lines) {
    const clean = line.replace(/^[-*•\d\.)\s]+/, "");
    if (!clean || EMPTY_LIST_ITEM.test(clean)) continue;

    const lower = clean.toLowerCase();
    let severity: ParsedReviewFinding["severity"] = "low";
    if (lower.startsWith("critical") || lower.includes("severity: critical") || lower.includes("severity:critical")) {
      severity = "critical";
    } else if (lower.startsWith("high") || lower.includes("severity: high") || lower.includes("severity:high")) {
      severity = "high";
    } else if (lower.startsWith("medium") || lower.includes("severity: medium") || lower.includes("severity:medium")) {
      severity = "medium";
    }

    // Strip leading severity prefix if present
    const message = clean.replace(/^(critical|high|medium|low)[:,\s—–-]+/i, "").trim() || clean;
    results.push({ severity, message });
  }

  return results;
}

/** "None", "(none).", "N/A", "No repairs required." and similar mean the list is empty. */
const EMPTY_LIST_ITEM = /^[\s(*_`"']*(none|n\/a|na|nil|nothing|not applicable|no (repairs?|repair instructions|changes|fixes|findings|issues|action)( are)?( (needed|required|necessary))?)[\s).*_`"'.!]*$/i;

function parseListItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•\d\.)\s]+/, ""))
    .filter((l) => l.length > 0 && !EMPTY_LIST_ITEM.test(l));
}

function parseLegacyJsonReview(obj: any, rawText: string): ParsedReview {
  const verdictRaw = String(obj.verdict ?? "").toLowerCase();
  const verdict: ReviewVerdict =
    verdictRaw.startsWith("accept") || verdictRaw === "pass" || verdictRaw === "approve"
      ? "accept"
      : verdictRaw.includes("block")
        ? "blocked"
        : "repair";

  const crit: ParsedReviewCriterion[] = (Array.isArray(obj.criteria) ? obj.criteria : []).map((c: any, i: number) => {
    const status = String(c?.status ?? "").toLowerCase();
    return {
      id: String(c?.id ?? `AC-${i + 1}`),
      status: status === "passed" || status === "pass" || status === "met" ? "passed" : status === "failed" || status === "fail" || status === "not met" ? "failed" : "unverified",
      reason: typeof c?.reason === "string" ? c.reason : "",
    };
  });

  const findings: ParsedReviewFinding[] = (Array.isArray(obj.findings) ? obj.findings : [])
    .map((f: any) => {
      const sev = String(f?.severity ?? "low").toLowerCase();
      return {
        severity: (["low", "medium", "high", "critical"].includes(sev) ? sev : "low") as ParsedReviewFinding["severity"],
        message: typeof f === "string" ? f : String(f?.message ?? ""),
      };
    })
    .filter((f: ParsedReviewFinding) => f.message.trim().length > 0);

  const repairInstructions = (Array.isArray(obj.repair_instructions) ? obj.repair_instructions : []).filter(
    (r: any): r is string => typeof r === "string"
  );

  return {
    status: verdict.toUpperCase() as "ACCEPT" | "REPAIR" | "BLOCKED",
    verdict,
    criteria: crit,
    findings,
    repairInstructions,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    rawText,
    isLegacyJson: true,
  };
}

/**
 * Checks if raw response contains substantive review commentary despite missing the
 * protocol status header or delimiters.
 */
export function isSubstantiveReviewCommentary(text: string): boolean {
  const clean = (text || "").trim();
  if (clean.length < 50) return false;

  const reviewKeywords = [
    /\b(acceptance criteri[aa]|criterion|criteria)\b/i,
    /\b(verdict|findings?|repair instructions?|passed|failed|unverified)\b/i,
    /\b(diff|implementation|code review|audit)\b/i,
    /\b(ac-\d+|req-\d+)\b/i,
    /\b(remediat(e|ion)|defect|bug)\b/i,
  ];

  let matches = 0;
  for (const re of reviewKeywords) {
    if (re.test(clean)) matches++;
  }

  return matches >= 2;
}

/**
 * Builds a focused follow-up prompt asking GPT-Web to classify its existing substantive
 * review commentary into the required review protocol without changing its findings.
 */
export function buildProtocolRecoveryPrompt(previousResponseText: string): string {
  const excerpt = previousResponseText.trim().slice(0, 4_000);
  return [
    "PROTOCOL RECOVERY NOTICE:",
    "You provided substantive code review commentary above, but omitted the mandatory Orches review protocol status header and delimiters.",
    "",
    "Based strictly on your evaluation already provided below, classify your assessment using the required Orches review protocol.",
    "Do NOT fabricate a new verdict. Preserve your exact findings, criticisms, and any uncertainty.",
    "",
    "--- YOUR PREVIOUS ASSESSMENT EXCERPT ---",
    excerpt,
    "--- END OF PREVIOUS ASSESSMENT ---",
    "",
    "You MUST output your response in this EXACT format (select ACCEPT, REPAIR, or BLOCKED based on your assessment):",
    "",
    "ORCHES_REVIEW_STATUS: <ACCEPT | REPAIR | BLOCKED>",
    "",
    "[ORCHES_REVIEW]",
    "",
    "## Verdict",
    "<ACCEPT | REPAIR | BLOCKED>",
    "",
    "## Acceptance Criteria",
    "- AC-1 — <passed | failed | unverified> — <evidence from diff>",
    "",
    "## Findings",
    "- <Severity (low|medium|high|critical)>, <concrete issue>, <affected component>",
    "",
    "## Repair Instructions",
    "- <Specific actionable fix supported by your assessment, or (none) if ACCEPT>",
    "",
    "## Summary",
    "<One sentence summarizing the review decision>",
    "",
    "[/ORCHES_REVIEW]",
  ].join("\n");
}

/**
 * Builds a focused protocol recovery prompt when GPT-Web returned ORCHES_REVIEW_STATUS: ACCEPT,
 * but its summary or body substantively stated that acceptance criteria are unmet or changes are required.
 */
export function buildContradictoryVerdictRecoveryPrompt(
  rawResponseText: string,
  contradictionReason: string
): string {
  const excerpt = rawResponseText.trim().slice(0, 4_000);
  return [
    "PROTOCOL CONSISTENCY RECOVERY NOTICE:",
    `Your review indicated an 'ACCEPT' verdict, but your substantive review assessment explicitly noted that changes or unmet requirements remain:`,
    `"${contradictionReason}"`,
    "",
    "Under Orches review protocol, an ACCEPT verdict cannot contradict your own substantive findings or acceptance criteria status.",
    "Please reconcile your review verdict with your substantive assessment below.",
    "If requirements or criteria remain unmet, or changes are required before acceptance, the verdict MUST be REPAIR.",
    "If the implementation is genuinely complete and acceptable as-is, your summary must reflect that.",
    "",
    "--- YOUR PREVIOUS ASSESSMENT EXCERPT ---",
    excerpt,
    "--- END OF PREVIOUS ASSESSMENT ---",
    "",
    "Return a reconciled, consistent response using this EXACT format (select ACCEPT, REPAIR, or BLOCKED):",
    "",
    "ORCHES_REVIEW_STATUS: <ACCEPT | REPAIR | BLOCKED>",
    "",
    "[ORCHES_REVIEW]",
    "",
    "## Verdict",
    "<ACCEPT | REPAIR | BLOCKED>",
    "",
    "## Acceptance Criteria",
    "- AC-1 — <passed | failed | unverified> — <evidence from diff>",
    "",
    "## Findings",
    "- <Severity (low|medium|high|critical)>, <concrete issue>, <affected component>",
    "",
    "## Repair Instructions",
    "- <Specific actionable fix supported by your assessment, or (none) if ACCEPT>",
    "",
    "## Summary",
    "<Reconciled one sentence summarizing the review decision>",
    "",
    "[/ORCHES_REVIEW]",
  ].join("\n");
}

/**
 * Detects whether an ACCEPT verdict contradicts the substantive text in the summary or review body.
 * Distinguishes genuine defects / unmet requirements from benign historical remarks or suggestions.
 */
export function detectAcceptContradiction(
  summary: string,
  reviewBody: string,
  criteria: ParsedReviewCriterion[],
  findings: ParsedReviewFinding[]
): string | null {
  // Check criteria reasons for unmet/failed statements even if status was labeled 'passed'
  for (const c of criteria) {
    const reasonLower = (c.reason || "").toLowerCase();
    if (
      reasonLower.includes("unmet") ||
      reasonLower.includes("not met") ||
      reasonLower.includes("remains unmet") ||
      reasonLower.includes("remains failed") ||
      reasonLower.includes("criterion failed") ||
      reasonLower.includes("does not satisfy") ||
      reasonLower.includes("must be removed before") ||
      reasonLower.includes("must be fixed before")
    ) {
      return `Criterion ${c.id} indicates an unmet requirement: "${c.reason}"`;
    }
  }

  // Check findings for critical remarks
  for (const f of findings) {
    const fLower = f.message.toLowerCase();
    if (
      fLower.includes("fundamental defect") ||
      fLower.includes("fundamental violation") ||
      fLower.includes("must be removed before acceptance") ||
      fLower.includes("cannot be accepted")
    ) {
      return `Finding states: "${f.message}"`;
    }
  }

  const combined = `${summary}\n${reviewBody}`.toLowerCase();

  // Explicit statements that acceptance is not yet possible
  const explicitBlockers = [
    /before (?:it can be accepted|acceptance|accepting)/i,
    /cannot be accepted/i,
    /can(?:not|'t) accept/i,
    /must (?:be reduced|be removed|be fixed|be changed|remove|fix|eliminate) before (?:it can be accepted|acceptance)/i,
    /core acceptance criterion remains (?:unmet|failed)/i,
    /primary acceptance criterion remains (?:unmet|failed)/i,
    /acceptance criterion remains (?:unmet|failed)/i,
    /fundamental (?:defect|violation)/i,
    /changes are required before (?:acceptance|accepting)/i,
    /not (?:ready for|eligible for) acceptance/i,
  ];

  for (const pattern of explicitBlockers) {
    const match = summary.match(pattern) || reviewBody.match(pattern);
    if (match) {
      return `Review explicitly states: "${match[0]}"`;
    }
  }

  return null;
}
