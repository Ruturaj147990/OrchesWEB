import type { CheckResult } from "../verification/runner.js";

export interface FormattedDiffResult {
  formattedText: string;
  isTruncated: boolean;
  status: "complete" | "partial" | "empty";
  filesIncluded: string[];
  filesOmitted: string[];
}

/**
 * Calculates a dynamic diff character budget based on model context window.
 * Allocates available context tokens to diff payload while reserving room for
 * system prompt, task text, active criteria, check outputs, and reviewer response.
 */
export function calculateDiffCharBudget(contextWindowTokens = 32_768): number {
  const reserveTokens = 6_000;
  const availableTokens = Math.max(8_000, contextWindowTokens - reserveTokens);
  return Math.max(32_000, Math.floor(availableTokens * 3.8));
}

export const DEFAULT_MAX_DIFF_CHARS = calculateDiffCharBudget();

export const CHATGPT_WEB_SAFE_DIFF_CHUNK_CHARS = 24_000;

export interface ReviewDiffChunk {
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  files: string[];
  lineRangeDesc?: string;
  formattedEvidence: string;
}

export interface ChunkCoverageRecord {
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  files: string[];
  lineRangeDesc?: string;
  submitted: boolean;
  usableAssessment: boolean;
  verdict?: "accept" | "repair" | "blocked";
  findings: Array<{ severity: string; message: string }>;
  unresolvedIssues: string[];
  error?: string;
}

export interface ReviewCoverageLedger {
  manifest: Array<{ path: string; kind: string; additions?: number; deletions?: number }>;
  allFiles: string[];
  chunks: ChunkCoverageRecord[];
  isComplete(): boolean;
  unreviewedFiles(): string[];
  failedChunks(): ChunkCoverageRecord[];
}

export function createCoverageLedger(
  changes: Array<{ path: string; kind: string; additions?: number; deletions?: number }>,
  chunks: ReviewDiffChunk[]
): ReviewCoverageLedger {
  const allFiles = changes.map((c) => c.path);
  const records: ChunkCoverageRecord[] = chunks.map((ch) => ({
    chunkId: ch.chunkId,
    chunkIndex: ch.chunkIndex,
    totalChunks: ch.totalChunks,
    files: [...ch.files],
    lineRangeDesc: ch.lineRangeDesc,
    submitted: false,
    usableAssessment: false,
    findings: [],
    unresolvedIssues: [],
  }));

  return {
    manifest: [...changes],
    allFiles,
    chunks: records,
    isComplete() {
      if (this.chunks.length === 0) return true;
      return this.chunks.every((c) => c.submitted && c.usableAssessment && !c.error);
    },
    unreviewedFiles() {
      const reviewed = new Set<string>();
      for (const c of this.chunks) {
        if (c.submitted && c.usableAssessment && !c.error) {
          for (const f of c.files) reviewed.add(f);
        }
      }
      return this.allFiles.filter((f) => !reviewed.has(f));
    },
    failedChunks() {
      return this.chunks.filter((c) => !c.submitted || !c.usableAssessment || !!c.error);
    },
  };
}

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
export function splitDiffByFiles(diffText: string): Array<{ path: string; text: string }> {
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
 * Splits a single oversized file diff into ordered logical hunk / line-range subchunks.
 * Preserves 100% of diff lines without loss or truncation.
 */
export function splitSingleFileDiffIntoSubchunks(
  filePath: string,
  fileDiffText: string,
  maxChars: number
): Array<{ path: string; text: string; lineRangeDesc: string }> {
  if (fileDiffText.length <= maxChars) {
    return [{ path: filePath, text: fileDiffText, lineRangeDesc: "all lines" }];
  }

  const lines = fileDiffText.split("\n");
  const headerLines: string[] = [];
  const bodyLines: string[] = [];

  let inHeader = true;
  for (const line of lines) {
    if (inHeader && (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode "))) {
      headerLines.push(line);
    } else {
      inHeader = false;
      bodyLines.push(line);
    }
  }

  const fileHeader = headerLines.join("\n");
  const subchunks: Array<{ path: string; text: string; lineRangeDesc: string }> = [];
  let currentHunkLines: string[] = [];
  let startLineNum = 1;
  let currentLineCount = 0;

  const headerReserve = fileHeader ? fileHeader.length + 200 : 200;
  const effectiveBudget = Math.max(2_000, maxChars - headerReserve);

  const flush = () => {
    if (currentHunkLines.length === 0) return;
    const endLineNum = startLineNum + currentLineCount - 1;
    const rangeDesc = `lines ${startLineNum}-${endLineNum}`;
    const chunkBody = currentHunkLines.join("\n");
    const fullText = fileHeader
      ? `${fileHeader}\n[File ${filePath} (Section ${rangeDesc})]:\n${chunkBody}`
      : `[File ${filePath} (Section ${rangeDesc})]:\n${chunkBody}`;
    subchunks.push({ path: filePath, text: fullText, lineRangeDesc: rangeDesc });
    startLineNum = endLineNum + 1;
    currentHunkLines = [];
    currentLineCount = 0;
  };

  for (const line of bodyLines) {
    const isHunkHeader = line.startsWith("@@ ");
    const wouldExceed = currentHunkLines.join("\n").length + line.length + 1 > effectiveBudget;

    if (wouldExceed && currentHunkLines.length > 0) {
      flush();
    }
    currentHunkLines.push(line);
    currentLineCount++;
  }

  flush();
  return subchunks.length > 0 ? subchunks : [{ path: filePath, text: fileDiffText, lineRangeDesc: "all lines" }];
}

/**
 * Splits diff into multi-chunk review packages when total diff exceeds single-turn budget.
 * Handles both multi-file diffs and oversized individual files by splitting into ordered subchunks.
 * Guarantees zero evidence reduction, zero file omissions, and full coverage ledger support.
 */
export function splitDiffIntoReviewChunks(
  changes: Array<{ path: string; kind: string; additions?: number; deletions?: number }>,
  diffText: string,
  maxCharsPerChunk = CHATGPT_WEB_SAFE_DIFF_CHUNK_CHARS,
  reviewId = "rev"
): ReviewDiffChunk[] {
  const fileChunks = splitDiffByFiles(diffText);
  if (fileChunks.length === 0 || !diffText.trim()) {
    return [{
      chunkId: `${reviewId}-c1`,
      chunkIndex: 1,
      totalChunks: 1,
      files: [],
      formattedEvidence: formatDiffEvidence(changes, diffText, maxCharsPerChunk).formattedText,
    }];
  }

  const manifestHeader = [
    "COMPLETE CHANGED FILES MANIFEST:",
    ...changes.map(
      (c) =>
        `- ${c.path} (${c.kind}${c.additions !== undefined && c.deletions !== undefined ? `, +${c.additions}/-${c.deletions}` : ""})`
    ),
    "",
  ].join("\n");

  const headerOverhead = manifestHeader.length + 400;
  // Ensure at least 65% of maxCharsPerChunk is dedicated to diff content rather than header overhead
  const effectiveMaxChunk = Math.max(6_000, maxCharsPerChunk - Math.min(headerOverhead, Math.floor(maxCharsPerChunk * 0.35)));

  // Expand any oversized files into subchunks
  const atomicChunks: Array<{ path: string; text: string; lineRangeDesc?: string }> = [];
  for (const fc of fileChunks) {
    if (fc.text.length > effectiveMaxChunk) {
      const sub = splitSingleFileDiffIntoSubchunks(fc.path, fc.text, effectiveMaxChunk);
      atomicChunks.push(...sub);
    } else {
      atomicChunks.push(fc);
    }
  }

  const intermediatePackages: Array<{ files: string[]; diffText: string; lineRangeDesc?: string }> = [];
  let currentFiles: string[] = [];
  let currentDiffs: string[] = [];
  let currentSize = 0;
  let currentRanges: string[] = [];

  for (const item of atomicChunks) {
    const itemSize = item.text.length + 10;
    if (currentDiffs.length > 0 && currentSize + itemSize > effectiveMaxChunk) {
      intermediatePackages.push({
        files: [...new Set(currentFiles)],
        diffText: currentDiffs.join("\n\n"),
        lineRangeDesc: currentRanges.filter(Boolean).join("; ") || undefined,
      });
      currentFiles = [item.path];
      currentDiffs = [item.text];
      currentRanges = item.lineRangeDesc ? [item.lineRangeDesc] : [];
      currentSize = itemSize;
    } else {
      currentFiles.push(item.path);
      currentDiffs.push(item.text);
      if (item.lineRangeDesc) currentRanges.push(item.lineRangeDesc);
      currentSize += itemSize;
    }
  }

  if (currentDiffs.length > 0) {
    intermediatePackages.push({
      files: [...new Set(currentFiles)],
      diffText: currentDiffs.join("\n\n"),
      lineRangeDesc: currentRanges.filter(Boolean).join("; ") || undefined,
    });
  }

  const totalChunks = intermediatePackages.length;

  return intermediatePackages.map((pkg, idx) => {
    const chunkNum = idx + 1;
    const chunkId = `${reviewId}-c${chunkNum}`;
    const rangeNote = pkg.lineRangeDesc ? ` (Sections: ${pkg.lineRangeDesc})` : "";
    return {
      chunkId,
      chunkIndex: chunkNum,
      totalChunks,
      files: pkg.files,
      lineRangeDesc: pkg.lineRangeDesc,
      formattedEvidence: [
        `DIFF STATUS: CHUNKED REVIEW (Part ${chunkNum} of ${totalChunks}: files ${pkg.files.join(", ")}${rangeNote})`,
        "",
        manifestHeader,
        `INCLUDED DIFF EVIDENCE FOR CHUNK ${chunkNum} OF ${totalChunks}:`,
        pkg.diffText,
      ].join("\n"),
    };
  });
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
