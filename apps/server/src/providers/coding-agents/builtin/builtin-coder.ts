import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult, CodingAgentAvailability } from "../adapter.js";
import { ReasoningProvider } from "../../reasoning/provider.js";
import { resolveModelPath } from "../../../workspace/path-safety.js";
import { projectFileList } from "../../../workspace/project-inspector.js";
import { parseFileOperations } from "../../../prompts/file-operations.js";

const SYSTEM = `You are a careful senior software engineer working inside an existing project folder.
You complete the task by writing files. You answer ONLY with file blocks in the exact format requested.
You never invent unrelated features, never write secrets, and never use placeholders such as "rest of code unchanged".`;

const CONTEXT_CHAR_BUDGET = 24_000;
const MAX_FILE_CHARS = 12_000;
const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|md|txt|py|go|rs|java|cs|rb|php|html|css|scss|yml|yaml|toml|ini|cfg|sh|ps1|sql|xml|svg|vue|svelte)$/i;

function readText(abs: string): string | null {
  try {
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 4000).includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Pick the files whose current content the model should see. */
export function selectContextFiles(root: string, allFiles: string[], requested: string[]): string[] {
  const textFiles = allFiles.filter((f) => TEXT_EXT.test(f) && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f));
  const lowerMap = new Map(textFiles.map((f) => [f.toLowerCase(), f]));
  const chosen: string[] = [];
  const add = (f: string | undefined) => {
    if (f && !chosen.includes(f)) chosen.push(f);
  };
  for (const r of requested) add(lowerMap.get(r.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase()));
  for (const m of ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "README.md"]) add(lowerMap.get(m.toLowerCase()));
  // Small projects: include everything that fits.
  const totalSize = textFiles.reduce((sum, f) => {
    try {
      return sum + fs.statSync(path.join(root, f)).size;
    } catch {
      return sum;
    }
  }, 0);
  if (totalSize <= CONTEXT_CHAR_BUDGET) textFiles.forEach(add);
  return chosen;
}

/** Short, factual notes for toolchains small models commonly confuse. Added only when relevant. */
const TOOLCHAIN_NOTES: Array<{ when: RegExp; note: string }> = [
  {
    when: /node:test|node --test/i,
    note: "node:test: import helpers with `const { test, describe, it } = require('node:test')` and assertions with `const assert = require('node:assert/strict')` (e.g. assert.equal(add(1, 2), 3)). node:test has NO expect(); `node --test` runs files named *.test.js or in a test/ folder.",
  },
  {
    when: /pytest/i,
    note: "pytest: test files are named test_*.py, test functions start with test_, and use plain `assert` statements; import the module under test normally.",
  },
  {
    when: /unittest/i,
    note: "unittest: subclass unittest.TestCase in files named test_*.py and use self.assertEqual and friends.",
  },
];

export function buildCoderPrompt(input: AgentExecutionInput): string {
  const root = input.workspacePath;
  const allFiles = projectFileList(root, 400);
  const contextFiles = selectContextFiles(root, allFiles, input.filesToRead);

  let budget = CONTEXT_CHAR_BUDGET;
  const contents: string[] = [];
  for (const rel of contextFiles) {
    const text = readText(path.join(root, rel));
    if (text === null) continue;
    const clipped = text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n…(file truncated in this view; do not rewrite it unless necessary)` : text;
    if (clipped.length > budget) continue;
    budget -= clipped.length;
    contents.push(`<<<FILE ${rel}>>>\n${clipped}\n<<<END>>>`);
  }

  const p = input.profile;
  const checks = p.checks.map((c) => c.label).join(", ");
  const haystack = [input.taskText, checks, ...contents].join("\n");
  const notes = TOOLCHAIN_NOTES.filter((n) => n.when.test(haystack)).map((n) => `- ${n.note}`);
  return [
    `TASK:\n${input.taskText.trim()}`,
    input.acceptanceCriteria.length ? `ACCEPTANCE CRITERIA:\n${input.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
    `PROJECT: folder "${path.basename(root)}"; ${p.isEmpty ? "the folder is currently EMPTY (new project)" : `${p.fileCount} files`}; languages: ${p.languages.join(", ") || "none detected"}; manifests: ${p.manifests.join(", ") || "none"}.`,
    `AUTOMATED CHECKS THE ORCHESTRATOR WILL RUN AFTERWARDS: ${checks || "none currently (only syntax validation of changed files)"}.`,
    allFiles.length ? `FILES IN PROJECT:\n${allFiles.slice(0, 300).join("\n")}${allFiles.length > 300 ? "\n…" : ""}` : "",
    contents.length ? `CURRENT CONTENT OF RELEVANT FILES:\n${contents.join("\n\n")}` : "",
    input.previousFailure ? `YOUR PREVIOUS ATTEMPT REQUIRED REVISION. Its files are still in the project (current content shown above). Fix exactly these problems:\n${input.previousFailure}` : "",
    notes.length ? `TOOLCHAIN NOTES:\n${notes.join("\n")}` : "",
    input.guidance?.length ? `GUIDANCE FROM THE OPERATOR:\n${input.guidance.map((g) => `- ${g}`).join("\n")}` : "",
    `RESPONSE FORMAT (follow exactly):
For every file you create or change, output its COMPLETE new content:
<<<FILE relative/path/from/project/root.ext>>>
complete file content
<<<END>>>
To delete a file: <<<DELETE relative/path.ext>>>
End with one line: <<<SUMMARY>>> one sentence describing what you changed.

RULES:
- Paths are relative to the project root and use forward slashes. Never use absolute paths or "..".
- Only touch files the task needs. Keep existing code that is unrelated to the task.
- Follow the project's existing language, style and tooling. Do not add a new toolchain unless the task asks for one or the folder is empty and the task requires it.
- If you add or change behaviour and the project has tests, add or update tests using the existing test setup.
- Every identifier you use must be defined or imported (for example test helpers from the test framework).
- Never write .env files, keys, or the .git folder. No markdown fences inside file blocks.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Built-in coding mechanism: the selected reasoning provider generates complete
 * file contents, which the orchestrator writes after path-safety checks.
 */
export class BuiltinCoderAdapter implements CodingAgentAdapter {
  public id = "builtin";
  public displayName = "Built-in coder";
  public description = "The selected reasoning model writes complete files; the orchestrator applies them inside the workspace after path-safety checks.";
  public usesReasoningProvider = true;

  constructor(private provider: ReasoningProvider) {}

  public async detect(): Promise<CodingAgentAvailability> {
    return { available: true, detail: `Uses ${this.provider.displayName} (${this.provider.getModel()}).` };
  }

  public async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const result: AgentExecutionResult = {
      status: "failed",
      summary: "",
      filesWritten: [],
      filesDeleted: [],
      rejectedWrites: [],
      modelId: this.provider.getModel(),
      warnings: [],
    };
    const prompt = buildCoderPrompt(input);
    input.onLog(`[coder] Asking ${this.provider.displayName} (${this.provider.getModel()}) for file changes (${prompt.length} chars of context)…`);

    let text: string;
    try {
      const response = await this.provider.generate(
        {
          operation: "code_generation",
          systemInstruction: SYSTEM,
          messages: [{ role: "user", content: prompt }],
          // Repairs get a little more variety so the model does not repeat the rejected answer verbatim.
          temperature: input.attemptNumber > 1 ? 0.5 : 0.2,
          maxOutputTokens: 8192,
          projectId: input.projectId,
          runId: input.runId,
          taskId: input.taskId,
        },
        input.signal
      );
      text = response.text;
      result.warnings.push(...response.warnings);
      input.onLog(`[coder] Model answered in ${(response.durationMs / 1000).toFixed(1)}s (${response.usage?.outputTokens ?? "?"} output tokens).`);
    } catch (err) {
      result.error = (err as Error).message;
      return result;
    }

    const ops = parseFileOperations(text);
    result.summary = ops.summary;
    for (const p of ops.incomplete) {
      result.rejectedWrites.push({ path: p, reason: "the model's response ended before this file was complete (output truncated)" });
    }
    if (ops.writes.length === 0 && ops.deletes.length === 0) {
      result.error = `The model did not return any file changes in a recognizable format. Response began: ${JSON.stringify(text.slice(0, 300))}`;
      return result;
    }
    if (ops.format !== "blocks") result.warnings.push(`Model ignored the requested block format; parsed ${ops.format} output instead.`);

    const seen = new Set<string>();
    for (const w of ops.writes) {
      const resolved = resolveModelPath(input.workspacePath, w.path);
      if (!resolved.ok) {
        result.rejectedWrites.push({ path: w.path, reason: resolved.reason });
        input.onLog(`[coder] Blocked write to '${w.path}': ${resolved.reason}`);
        continue;
      }
      if (seen.has(resolved.relPath.toLowerCase())) continue;
      seen.add(resolved.relPath.toLowerCase());
      try {
        let content = w.content;
        if (fs.existsSync(resolved.absPath)) {
          const existing = fs.readFileSync(resolved.absPath, "utf8");
          if (existing.includes("\r\n") && !content.includes("\r\n")) content = content.replace(/\n/g, "\r\n");
        }
        if (content.length > 0 && !content.endsWith("\n")) content += content.includes("\r\n") ? "\r\n" : "\n";
        fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
        fs.writeFileSync(resolved.absPath, content, "utf8");
        result.filesWritten.push(resolved.relPath);
        input.onLog(`[coder] Wrote ${resolved.relPath} (${content.length} chars)`);
      } catch (err) {
        result.rejectedWrites.push({ path: w.path, reason: `write failed: ${(err as Error).message}` });
      }
    }
    for (const d of ops.deletes) {
      const resolved = resolveModelPath(input.workspacePath, d);
      if (!resolved.ok) {
        result.rejectedWrites.push({ path: d, reason: resolved.reason });
        continue;
      }
      if (!fs.existsSync(resolved.absPath)) continue;
      try {
        fs.rmSync(resolved.absPath);
        result.filesDeleted.push(resolved.relPath);
        input.onLog(`[coder] Deleted ${resolved.relPath}`);
      } catch (err) {
        result.rejectedWrites.push({ path: d, reason: `delete failed: ${(err as Error).message}` });
      }
    }

    if (result.filesWritten.length === 0 && result.filesDeleted.length === 0) {
      result.error = "Every file operation proposed by the model was rejected.";
      return result;
    }
    result.status = "completed";
    if (!result.summary) result.summary = `Wrote ${result.filesWritten.length} file(s)${result.filesDeleted.length ? `, deleted ${result.filesDeleted.length}` : ""}.`;
    return result;
  }
}
