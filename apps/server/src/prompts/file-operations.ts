import { extractJsonFromText } from "./json-extractor.js";

export interface ParsedFileOperations {
  writes: Array<{ path: string; content: string }>;
  deletes: string[];
  summary: string;
  /** Blocks that were started but never closed (usually a truncated response). */
  incomplete: string[];
  format: "blocks" | "json" | "markdown" | "none";
}

const FENCE_WRAPPED = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/;

function unwrapFence(content: string): string {
  const m = content.match(FENCE_WRAPPED);
  return m ? m[1] : content;
}

function parseBlocks(text: string): ParsedFileOperations | null {
  if (!/<<<\s*(FILE|DELETE)\b/i.test(text)) return null;
  const writes: ParsedFileOperations["writes"] = [];
  const deletes: string[] = [];
  const incomplete: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let current: { path: string; body: string[] } | null = null;
  let summary = "";

  for (const line of lines) {
    if (current) {
      if (/^\s*<<<\s*END(\s+FILE)?\s*>>>\s*$/i.test(line)) {
        writes.push({ path: current.path, content: unwrapFence(current.body.join("\n")) });
        current = null;
      } else if (/^\s*<<<\s*FILE\s+.+>>>\s*$/i.test(line)) {
        // A new block started without closing the previous one: treat the previous as incomplete.
        incomplete.push(current.path);
        current = { path: line.replace(/^\s*<<<\s*FILE\s+/i, "").replace(/>>>\s*$/, "").trim(), body: [] };
      } else {
        current.body.push(line);
      }
      continue;
    }
    const file = line.match(/^\s*<<<\s*FILE\s+(.+?)\s*>>>\s*$/i);
    if (file) {
      current = { path: file[1].trim(), body: [] };
      continue;
    }
    const del = line.match(/^\s*<<<\s*DELETE\s+(.+?)\s*>>>\s*$/i);
    if (del) {
      deletes.push(del[1].trim());
      continue;
    }
    const sum = line.match(/^\s*<<<\s*SUMMARY\s*>>>\s*(.*)$/i);
    if (sum) summary = sum[1].trim();
  }
  if (current) incomplete.push(current.path);
  return { writes, deletes, summary, incomplete, format: "blocks" };
}

function parseJson(text: string): ParsedFileOperations | null {
  const parsed = extractJsonFromText<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return null;
  const list = (Array.isArray(parsed) ? parsed : (parsed.files ?? parsed.Files ?? parsed.changes)) as unknown;
  if (!Array.isArray(list)) return null;
  const writes: ParsedFileOperations["writes"] = [];
  const deletes: string[] = [];
  for (const item of list as Array<Record<string, unknown>>) {
    const p = (item?.path ?? item?.file ?? item?.filename) as unknown;
    if (typeof p !== "string") continue;
    if (item.delete === true || item.action === "delete") deletes.push(p);
    else if (typeof item.content === "string") writes.push({ path: p, content: unwrapFence(item.content) });
  }
  const summary = typeof (parsed as Record<string, unknown>).summary === "string" ? String((parsed as Record<string, unknown>).summary) : "";
  return { writes, deletes, summary, incomplete: [], format: "json" };
}

/** Last resort: "### path/to/file" or "**path**" followed by a fenced code block. */
function parseMarkdown(text: string): ParsedFileOperations | null {
  const writes: ParsedFileOperations["writes"] = [];
  const re = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*|\*\*|`|File:[ \t]*|Filename:[ \t]*)?([\w./\\-]+\.[\w]+)(?:\*\*|`)?[ \t]*:?[ \t]*\n```[^\n]*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    writes.push({ path: m[1], content: m[2] });
  }
  return writes.length > 0 ? { writes, deletes: [], summary: "", incomplete: [], format: "markdown" } : null;
}

export function parseFileOperations(text: string): ParsedFileOperations {
  return (
    parseBlocks(text) ??
    parseJson(text) ??
    parseMarkdown(text) ?? { writes: [], deletes: [], summary: "", incomplete: [], format: "none" }
  );
}
