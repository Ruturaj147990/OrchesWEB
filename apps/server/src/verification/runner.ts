import fs from "node:fs";
import path from "node:path";
import { runCommand, runShellCommand } from "../platform/process-runner.js";
import { PlannedCheck, CheckKind, findPython } from "../workspace/project-inspector.js";
import type { WorkspaceChange } from "../workspace/snapshot-store.js";

export type CheckStatus = "passed" | "failed" | "timeout" | "error" | "cancelled";

export interface CheckResult {
  checkId: string;
  kind: CheckKind | "static";
  label: string;
  source: string;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  truncated: boolean;
}

const OUTPUT_TAIL = 6000;

function tail(text: string): string {
  return text.length > OUTPUT_TAIL ? text.slice(text.length - OUTPUT_TAIL) : text;
}

export async function runCheck(
  rootPath: string,
  check: PlannedCheck,
  opts: { signal?: AbortSignal; onLog?: (line: string) => void } = {}
): Promise<CheckResult> {
  const env = { ...process.env, CI: "true", PYTHONDONTWRITEBYTECODE: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
  const runOpts = { cwd: rootPath, timeoutMs: check.timeoutMs, signal: opts.signal, env };
  const res = check.shellCommand
    ? await runShellCommand(check.shellCommand, runOpts)
    : await runCommand(check.argv!, runOpts);

  const output = [res.stdout, res.stderr].filter((s) => s.trim()).join("\n");
  let status: CheckStatus;
  if (res.cancelled) status = "cancelled";
  else if (res.timedOut) status = "timeout";
  else if (res.spawnError) status = "error";
  else status = res.exitCode === 0 ? "passed" : "failed";

  opts.onLog?.(`[verify] ${check.label} → ${status}${res.exitCode !== null ? ` (exit ${res.exitCode})` : ""} in ${res.durationMs}ms`);
  return {
    checkId: check.id,
    kind: check.kind,
    label: check.label,
    source: check.source,
    status,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    output: res.spawnError ? `Could not start '${check.label}': ${res.spawnError}` : tail(output),
    truncated: res.truncated || output.length > OUTPUT_TAIL,
  };
}

export async function runChecks(
  rootPath: string,
  checks: PlannedCheck[],
  opts: { signal?: AbortSignal; onLog?: (line: string) => void } = {}
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (opts.signal?.aborted) break;
    results.push(await runCheck(rootPath, check, opts));
  }
  return results;
}

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".cs", ".rb", ".php", ".css", ".html", ".json", ".yml", ".yaml", ".toml", ".sh", ".ps1"]);

/**
 * Cheap, language-aware validation of files changed by an attempt: JSON must
 * parse, JavaScript and Python must be syntactically valid, and code files must
 * not be wrapped in markdown fences or contain "rest of code unchanged" stubs.
 */
export async function validateChangedFiles(
  rootPath: string,
  changes: WorkspaceChange[],
  opts: { signal?: AbortSignal } = {}
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const python = changes.some((c) => c.path.endsWith(".py") && c.kind !== "deleted") ? await findPython() : null;

  for (const change of changes) {
    if (change.kind === "deleted" || change.binary) continue;
    const abs = path.join(rootPath, change.path);
    const ext = path.extname(change.path).toLowerCase();
    const base = path.basename(change.path).toLowerCase();
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const problems: string[] = [];
    const started = Date.now();

    if (CODE_EXTENSIONS.has(ext) && /^\s*```/.test(content)) {
      problems.push("file content is wrapped in a markdown code fence");
    }
    if (CODE_EXTENSIONS.has(ext) && /^\s*(\/\/|#|\/\*)\s*\.\.\.\s*(rest|existing|remaining|other)\b.*(unchanged|code|here)/im.test(content)) {
      problems.push("file contains an elision placeholder (e.g. '// ... rest of code unchanged') instead of real code");
    }

    if (ext === ".json" && !/^(tsconfig|jsconfig)(\..*)?\.json$/.test(base) && !change.path.includes(".vscode/")) {
      try {
        JSON.parse(content);
      } catch (err) {
        problems.push(`invalid JSON: ${(err as Error).message}`);
      }
    }

    if ([".js", ".mjs", ".cjs"].includes(ext) && problems.length === 0) {
      const res = await runCommand([process.execPath, "--check", abs], { cwd: rootPath, timeoutMs: 30_000, signal: opts.signal });
      if (res.exitCode !== 0 && !res.cancelled) problems.push(`JavaScript syntax error:\n${tail(res.stderr || res.stdout).trim()}`);
    }

    if (ext === ".py" && python && problems.length === 0) {
      const res = await runCommand(
        [python, "-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), sys.argv[1])", abs],
        { cwd: rootPath, timeoutMs: 30_000, signal: opts.signal }
      );
      if (res.exitCode !== 0 && !res.cancelled) problems.push(`Python syntax error:\n${tail(res.stderr || res.stdout).trim()}`);
    }

    results.push({
      checkId: `static:${change.path}`,
      kind: "static",
      label: `validate ${change.path}`,
      source: "orchestrator static validation",
      status: problems.length === 0 ? "passed" : "failed",
      exitCode: problems.length === 0 ? 0 : 1,
      durationMs: Date.now() - started,
      output: problems.join("\n"),
      truncated: false,
    });
  }
  return results;
}
