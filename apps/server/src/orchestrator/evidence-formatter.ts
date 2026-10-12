import type { CheckResult } from "../verification/runner.js";

export interface FormattedDiffResult {
  formattedText: string;
  isTruncated: boolean;
  status: "complete" | "partial" | "empty";
  filesIncluded: string[];
  filesOmitted: string[];
}

export const DEFAULT_MAX_DIFF_CHARS = 24_000;

/**
 * Deterministic, file-aware diff formatting that explicitly states whether the diff
 * is complete or partial, which files are included, and which are omitted.
 */
export function formatDiffEvidence(
  changes: Array<{ path: string; kind: string; additions?: number; deletions?: number }>,
  diffText: string,
  maxChars = DEFAULT_MAX_DIFF_CHARS
): FormattedDiffResult {
  const cleanDiff = (diffText || "").trim();
  if (changes.length === 0 || !cleanDiff) {
    return {
      formattedText: "DIFF STATUS: EMPTY\nNo changes detected on disk.",
      status: "empty",
      isTruncated: false,
      filesIncluded: [],
      filesOmitted: [],
    };
  }

  const fileListHeader = [
    "CHANGED FILES SUMMARY:",
    ...changes.map(
      (c) =>
        `- ${c.path} (${c.kind}${c.additions !== undefined && c.deletions !== undefined ? `, +${c.additions}/-${c.deletions}` : ""})`
    ),
    "",
  ].join("\n");

  // If entire diff fits comfortably
  if (fileListHeader.length + diffText.length <= maxChars) {
    return {
      formattedText: `DIFF STATUS: COMPLETE (All ${changes.length} changed file(s) included in full)\n\n${fileListHeader}FULL DIFF:\n${diffText}`,
      status: "complete",
      isTruncated: false,
      filesIncluded: changes.map((c) => c.path),
      filesOmitted: [],
    };
  }

  // Split diff into per-file chunks
  const fileChunks = splitDiffByFiles(diffText);
  const includedChunks: string[] = [];
  const filesIncluded: string[] = [];
  const filesOmitted: string[] = [];

  let currentBudget = maxChars - fileListHeader.length - 800; // safety margin for headers

  for (const chunk of fileChunks) {
    if (chunk.text.length <= currentBudget) {
      includedChunks.push(chunk.text);
      filesIncluded.push(chunk.path);
      currentBudget -= chunk.text.length;
    } else if (currentBudget > 800 && filesIncluded.length === 0) {
      // If even the first file exceeds budget, include bounded excerpt of it
      const boundedLines = chunk.text.slice(0, currentBudget).split("\n");
      boundedLines.pop(); // avoid broken last line
      const boundedText = `${boundedLines.join("\n")}\n\n[Diff for ${chunk.path} truncated at context budget — remaining lines omitted for review]`;
      includedChunks.push(boundedText);
      filesIncluded.push(chunk.path);
      currentBudget = 0;
    } else {
      filesOmitted.push(chunk.path);
    }
  }

  const omissionNotice = filesOmitted.length > 0
    ? `\n\nOMITTED FILES (Exceeded payload budget):\n${filesOmitted.map((f) => `- ${f} (diff omitted)`).join("\n")}\n> [!NOTE] Review Notice: Criteria depending on omitted or truncated files cannot be confirmed from this partial diff and must be evaluated as 'unverified'.`
    : "";

  const formattedText = [
    `DIFF STATUS: PARTIAL (${filesIncluded.length} of ${changes.length} changed file(s) included; ${filesOmitted.length} omitted)`,
    "",
    fileListHeader,
    "INCLUDED DIFFS:",
    includedChunks.join("\n\n"),
    omissionNotice,
  ].join("\n");

  return {
    formattedText,
    status: "partial",
    isTruncated: true,
    filesIncluded,
    filesOmitted,
  };
}

/**
 * Splits unified diff text into individual file chunks.
 */
function splitDiffByFiles(diffText: string): Array<{ path: string; text: string }> {
  const lines = diffText.split("\n");
  const chunks: Array<{ path: string; text: string }> = [];

  let currentPath = "unknown";
  let currentLines: string[] = [];

  for (const line of lines) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (gitMatch) {
      if (currentLines.length > 0) {
        chunks.push({ path: currentPath, text: currentLines.join("\n") });
        currentLines = [];
      }
      currentPath = gitMatch[2] || gitMatch[1];
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      if (currentPath === "unknown") {
        const pMatch = line.match(/^[+-]{3}\s+[ab]\/(.+)$/);
        if (pMatch) currentPath = pMatch[1];
      }
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    chunks.push({ path: currentPath, text: currentLines.join("\n") });
  }

  return chunks.length > 0 ? chunks : [{ path: "changes", text: diffText }];
}

/**
 * Formats automated check results with truthful representation of execution state.
 */
export function formatChecksEvidence(checks: CheckResult[]): string {
  if (checks.length === 0) {
    return [
      "AUTOMATED CHECKS STATUS: NOT RUN / NO AUTOMATED CHECKS DETECTED",
      "> [!IMPORTANT] Truthful Evidence Notice:",
      "> The project has no automated checks or tests were not executed for this attempt.",
      "> Absence of check execution means system behavior has NOT been empirically verified.",
      "> Do NOT claim tests passed or report tests as passing in your review.",
    ].join("\n");
  }

  const passed = checks.filter((c) => c.status === "passed");
  const failed = checks.filter((c) => c.status !== "passed");

  const lines: string[] = [];
  lines.push(`AUTOMATED CHECKS STATUS: ${failed.length === 0 ? "ALL PASSED" : "FAILURES DETECTED"} (${passed.length} passed, ${failed.length} failed)`);
  lines.push("");

  for (const c of checks) {
    const exitInfo = c.exitCode !== null ? ` (exit code ${c.exitCode})` : "";
    lines.push(`- **${c.label}**: ${c.status.toUpperCase()}${exitInfo}`);
    if (c.status !== "passed" && c.output) {
      lines.push("  ```");
      const outputTail = c.output.split("\n").slice(-20).join("\n  ");
      lines.push(`  ${outputTail}`);
      lines.push("  ```");
    }
  }

  return lines.join("\n");
}
