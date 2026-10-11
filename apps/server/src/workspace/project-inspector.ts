import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../platform/process-runner.js";

export type CheckKind = "test" | "lint" | "typecheck" | "build" | "custom";

/** A verification command chosen by the orchestrator from project files (never by a model). */
export interface PlannedCheck {
  id: string;
  kind: CheckKind;
  label: string;
  /** Argument vector run without a shell. */
  argv?: string[];
  /** Shell command line; only for commands the user configured explicitly. */
  shellCommand?: string;
  source: string;
  timeoutMs: number;
}

export interface ProjectProfile {
  rootPath: string;
  isEmpty: boolean;
  fileCount: number;
  languages: string[];
  manifests: string[];
  checks: PlannedCheck[];
  notes: string[];
}

const PLACEHOLDER_TEST_SCRIPT = /no test specified/i;
const toolCache = new Map<string, boolean>();

async function toolAvailable(argv: string[]): Promise<boolean> {
  const key = argv.join(" ");
  if (!toolCache.has(key)) {
    const res = await runCommand(argv, { cwd: process.cwd(), timeoutMs: 10_000 });
    toolCache.set(key, res.exitCode === 0);
  }
  return toolCache.get(key)!;
}

/** Python launcher available on this machine ("python" or "python3"), or null. */
export async function findPython(): Promise<string | null> {
  for (const exe of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    if (await toolAvailable([exe, "--version"])) return exe;
  }
  return null;
}

function listTopLevel(root: string, limit = 4000): string[] {
  const out: string[] = [];
  const skip = new Set([".git", ".orchestrator", "node_modules", ".venv", "venv", "__pycache__", "target", "dist", "build", ".next"]);
  const walk = (dir: string, rel: string, depth: number) => {
    if (out.length >= limit || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(path.join(dir, e.name), r, depth + 1);
      } else if (e.isFile()) {
        out.push(r);
      }
    }
  };
  walk(root, "", 0);
  return out;
}

export async function inspectProject(rootPath: string, customCommands: string[] = []): Promise<ProjectProfile> {
  const files = fs.existsSync(rootPath) ? listTopLevel(rootPath) : [];
  const has = (rel: string) => fs.existsSync(path.join(rootPath, rel));
  const languages = new Set<string>();
  const manifests: string[] = [];
  const checks: PlannedCheck[] = [];
  const notes: string[] = [];

  const extCount = (exts: string[]) => files.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e))).length;
  if (extCount([".js", ".mjs", ".cjs", ".jsx"]) > 0) languages.add("javascript");
  if (extCount([".ts", ".tsx"]) > 0) languages.add("typescript");
  if (extCount([".py"]) > 0) languages.add("python");
  if (extCount([".go"]) > 0) languages.add("go");
  if (extCount([".rs"]) > 0) languages.add("rust");
  if (extCount([".html", ".css"]) > 0) languages.add("web");
  if (extCount([".md", ".txt", ".rst"]) > 0 && languages.size === 0) languages.add("documentation");

  // User-configured commands take precedence over detection.
  if (customCommands.length > 0) {
    customCommands.forEach((cmd, i) =>
      checks.push({
        id: `custom-${i + 1}`,
        kind: "custom",
        label: cmd,
        shellCommand: cmd,
        source: "project settings",
        timeoutMs: 10 * 60_000,
      })
    );
    return { rootPath, isEmpty: files.length === 0, fileCount: files.length, languages: [...languages], manifests, checks, notes };
  }

  if (has("package.json")) {
    manifests.push("package.json");
    languages.add("javascript");
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
      const scripts = pkg.scripts || {};
      const depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
      if (depCount > 0 && !has("node_modules")) {
        notes.push(`package.json declares ${depCount} dependencies but node_modules is missing; run '${pm} install' so checks can execute.`);
      }
      const scriptArgv = (name: string) => (name === "test" ? [pm, "test"] : [pm, "run", name]);
      if (scripts.test && !PLACEHOLDER_TEST_SCRIPT.test(scripts.test)) {
        checks.push({ id: "npm-test", kind: "test", label: `${pm} test`, argv: scriptArgv("test"), source: "package.json script 'test'", timeoutMs: 10 * 60_000 });
      }
      for (const name of ["typecheck", "type-check", "lint"]) {
        if (scripts[name]) {
          checks.push({
            id: `npm-${name}`,
            kind: name === "lint" ? "lint" : "typecheck",
            label: `${pm} run ${name}`,
            argv: scriptArgv(name),
            source: `package.json script '${name}'`,
            timeoutMs: 10 * 60_000,
          });
        }
      }
    } catch {
      notes.push("package.json is not valid JSON; no npm checks could be derived.");
    }
  }

  const pyTests = files.filter((f) => /(^|\/)(test_[^/]*\.py|[^/]*_test\.py)$/.test(f));
  for (const m of ["pyproject.toml", "setup.py", "requirements.txt"]) if (has(m)) manifests.push(m);
  if (languages.has("python") && pyTests.length > 0) {
    const py = await findPython();
    if (!py) {
      notes.push("Python test files exist but no Python interpreter was found.");
    } else if (await toolAvailable([py, "-c", "import pytest"])) {
      checks.push({ id: "pytest", kind: "test", label: `${py} -m pytest -q`, argv: [py, "-m", "pytest", "-q", "-p", "no:cacheprovider"], source: `${pyTests.length} Python test file(s)`, timeoutMs: 10 * 60_000 });
    } else {
      checks.push({ id: "unittest", kind: "test", label: `${py} -m unittest discover`, argv: [py, "-B", "-m", "unittest", "discover", "-p", pyTests.some((f) => f.endsWith("_test.py")) ? "*_test.py" : "test_*.py"], source: `${pyTests.length} Python test file(s) (pytest not installed)`, timeoutMs: 10 * 60_000 });
    }
  }

  if (has("go.mod")) {
    manifests.push("go.mod");
    if (await toolAvailable(["go", "version"])) {
      checks.push({ id: "go-test", kind: "test", label: "go test ./...", argv: ["go", "test", "./..."], source: "go.mod", timeoutMs: 10 * 60_000 });
    } else notes.push("go.mod found but the Go toolchain is not installed.");
  }

  if (has("Cargo.toml")) {
    manifests.push("Cargo.toml");
    if (await toolAvailable(["cargo", "--version"])) {
      checks.push({ id: "cargo-test", kind: "test", label: "cargo test", argv: ["cargo", "test"], source: "Cargo.toml", timeoutMs: 15 * 60_000 });
    } else notes.push("Cargo.toml found but cargo is not installed.");
  }

  return { rootPath, isEmpty: files.length === 0, fileCount: files.length, languages: [...languages], manifests, checks, notes };
}

/** A compact file tree for prompts. */
export function projectFileList(rootPath: string, limit = 300): string[] {
  return listTopLevel(rootPath, limit);
}
