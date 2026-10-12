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

  // Verdict section
  const verdictText = (parsedSections["verdict"] || statusHeader).toLowerCase();
  const verdict: ReviewVerdict =
    verdictText.includes("accept") || verdictText.includes("pass")
      ? "accept"
      : verdictText.includes("block")
        ? "blocked"
        : "repair";

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
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
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
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•\d\.)]/.test(l));

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/^[-*•\d\.)\s]+/, "");
    // Match ID, status, and reason across common separators: "—", "-", ":", "|"
    const parts = line.split(/\s*(?:—|–| - |:\s+|\|\s*)\s*/);
    const rawId = parts[0]?.trim() || `AC-${idx + 1}`;
    const idMatch = rawId.match(/([A-Za-z0-9_-]+)/);
    const id = idMatch ? idMatch[1] : `AC-${idx + 1}`;

    const rawStatus = (parts[1] || "").toLowerCase().trim();
    let status: "passed" | "failed" | "unverified" = "unverified";

    if (rawStatus.includes("pass") || rawStatus.includes("met") || rawStatus.includes("ok")) {
      status = "passed";
    } else if (rawStatus.includes("fail") || rawStatus.includes("not met") || rawStatus.includes("reject")) {
      status = "failed";
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
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•\d\.)]/.test(l));

  for (const line of lines) {
    const clean = line.replace(/^[-*•\d\.)\s]+/, "");
    if (!clean || clean.toLowerCase() === "(none)" || clean.toLowerCase() === "none") continue;

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

function parseListItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•\d\.)\s]+/, ""))
    .filter((l) => l.length > 0 && l.toLowerCase() !== "(none)" && l.toLowerCase() !== "none");
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
