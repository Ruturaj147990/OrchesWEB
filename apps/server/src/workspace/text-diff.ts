/**
 * Minimal unified diff (LCS based) for review and display. Large inputs fall
 * back to a whole-file replacement hunk to keep memory bounded.
 */
const MAX_LCS_CELLS = 4_000_000;
const CONTEXT = 3;

type Op = { kind: " " | "-" | "+"; line: string; oldNo: number; newNo: number };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffOps(a: string[], b: string[]): Op[] {
  // Trim common prefix/suffix first; it keeps the LCS table small for typical edits.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: " ", line: a[i], oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_LCS_CELLS) {
    midA.forEach((line, i) => ops.push({ kind: "-", line, oldNo: start + i + 1, newNo: 0 }));
    midB.forEach((line, j) => ops.push({ kind: "+", line, oldNo: 0, newNo: start + j + 1 }));
  } else {
    const table: Uint32Array[] = [];
    for (let i = 0; i <= n; i++) table.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ kind: " ", line: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) {
        ops.push({ kind: "+", line: midB[j], oldNo: 0, newNo: start + j + 1 });
        j++;
      } else {
        ops.push({ kind: "-", line: midA[i], oldNo: start + i + 1, newNo: 0 });
        i++;
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ kind: " ", line: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return ops;
}

export interface FileDiffStats {
  additions: number;
  deletions: number;
}

export function unifiedDiff(relPath: string, oldText: string | null, newText: string | null): { text: string; stats: FileDiffStats } {
  const a = oldText === null ? [] : splitLines(oldText);
  const b = newText === null ? [] : splitLines(newText);
  const ops = diffOps(a, b);
  const additions = ops.filter((o) => o.kind === "+").length;
  const deletions = ops.filter((o) => o.kind === "-").length;

  const header = [
    `diff --git a/${relPath} b/${relPath}`,
    oldText === null ? "new file" : newText === null ? "deleted file" : null,
    `--- ${oldText === null ? "/dev/null" : `a/${relPath}`}`,
    `+++ ${newText === null ? "/dev/null" : `b/${relPath}`}`,
  ].filter(Boolean) as string[];

  // Group changes into hunks with surrounding context.
  const changeIdx = ops.map((o, idx) => (o.kind === " " ? -1 : idx)).filter((idx) => idx >= 0);
  const hunks: string[] = [];
  let k = 0;
  while (k < changeIdx.length) {
    let from = Math.max(0, changeIdx[k] - CONTEXT);
    let to = Math.min(ops.length - 1, changeIdx[k] + CONTEXT);
    while (k + 1 < changeIdx.length && changeIdx[k + 1] - CONTEXT <= to + 1) {
      k++;
      to = Math.min(ops.length - 1, changeIdx[k] + CONTEXT);
    }
    k++;
    const slice = ops.slice(from, to + 1);
    const oldStart = slice.find((o) => o.oldNo > 0)?.oldNo ?? 0;
    const newStart = slice.find((o) => o.newNo > 0)?.newNo ?? 0;
    const oldLen = slice.filter((o) => o.kind !== "+").length;
    const newLen = slice.filter((o) => o.kind !== "-").length;
    hunks.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of slice) hunks.push(`${o.kind}${o.line}`);
    from = to + 1;
  }
  return { text: [...header, ...hunks].join("\n"), stats: { additions, deletions } };
}
