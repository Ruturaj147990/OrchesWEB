import { spawn, spawnSync, ChildProcess } from "node:child_process";

export interface RunCommandOptions {
  cwd: string;
  /** Hard timeout; the whole process tree is killed when exceeded. */
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Data written to stdin (stdin is closed afterwards). */
  input?: string;
  /** Maximum characters retained per stream (tail is kept). */
  maxOutputChars?: number;
  onOutput?: (chunk: string) => void;
}

export interface RunCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
  durationMs: number;
  truncated: boolean;
}

const isWin = process.platform === "win32";

/** Executables that are .cmd/.bat shims on Windows and therefore need cmd.exe. */
const WINDOWS_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "tsc", "vitest", "jest", "eslint"]);

/**
 * Quote one argument for a cmd.exe command line. Arguments come from the
 * orchestrator (never from model output); characters that cmd.exe would
 * interpret are rejected rather than escaped.
 */
export function quoteWindowsArg(arg: string): string {
  if (/["%^&|<>!\r\n]/.test(arg)) {
    throw new Error(`Refusing to pass argument with shell metacharacters to cmd.exe: ${arg}`);
  }
  if (arg === "" || /[\s(),;=]/.test(arg)) {
    return `"${arg}"`;
  }
  return arg;
}

/** Kill a child and all of its descendants. */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
}

function spawnArgv(argv: string[], opts: RunCommandOptions): ChildProcess {
  const [exe, ...args] = argv;
  const base = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    windowsHide: true,
    detached: !isWin,
  };
  if (isWin && (WINDOWS_SHIMS.has(exe.toLowerCase()) || /\.(cmd|bat)$/i.test(exe))) {
    const line = [exe, ...args].map(quoteWindowsArg).join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
      ...base,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(exe, args, { ...base, shell: false });
}

function spawnShellLine(commandLine: string, opts: RunCommandOptions): ChildProcess {
  const base = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    windowsHide: true,
    detached: !isWin,
  };
  if (isWin) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], {
      ...base,
      windowsVerbatimArguments: true,
    });
  }
  return spawn("/bin/sh", ["-c", commandLine], base);
}

function collect(child: ChildProcess, opts: RunCommandOptions, start: number): Promise<RunCommandResult> {
  const maxChars = opts.maxOutputChars ?? 200_000;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;
  let cancelled = false;

  const append = (current: string, chunk: string): string => {
    const next = current + chunk;
    if (next.length > maxChars) {
      truncated = true;
      return next.slice(next.length - maxChars);
    }
    return next;
  };

  return new Promise((resolve) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    const finish = (result: Partial<RunCommandResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        cancelled,
        durationMs: Date.now() - start,
        truncated,
        ...result,
      });
    };

    // After a kill, 'close' waits for every holder of the output pipes; a descendant that escaped the
    // process tree would keep them open forever. Give up waiting after a short grace period.
    const killAndBound = () => {
      killProcessTree(child);
      if (!forceTimer) forceTimer = setTimeout(() => finish({ exitCode: child.exitCode ?? null }), 15_000);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killAndBound();
    }, opts.timeoutMs ?? 120_000);

    const onAbort = () => {
      cancelled = true;
      killAndBound();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Decode as a stream so multi-byte UTF-8 characters split across chunks stay intact.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (s: string) => {
      stdout = append(stdout, s);
      opts.onOutput?.(s);
    });
    child.stderr?.on("data", (s: string) => {
      stderr = append(stderr, s);
      opts.onOutput?.(s);
    });

    child.on("error", (err) => finish({ exitCode: null, spawnError: err.message }));
    child.on("close", (code) => finish({ exitCode: code }));

    if (child.stdin) {
      child.stdin.on("error", () => {});
      if (opts.input !== undefined) child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/** Run an executable with an argument vector (no shell interpretation of arguments). */
export function runCommand(argv: string[], opts: RunCommandOptions): Promise<RunCommandResult> {
  const start = Date.now();
  if (argv.length === 0) throw new Error("runCommand requires at least an executable");
  let child: ChildProcess;
  try {
    child = spawnArgv(argv, opts);
  } catch (err) {
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      spawnError: (err as Error).message,
      durationMs: Date.now() - start,
      truncated: false,
    });
  }
  return collect(child, opts, start);
}

/**
 * Run a command line through the platform shell. Only for commands the user
 * typed into project settings — never for model output.
 */
export function runShellCommand(commandLine: string, opts: RunCommandOptions): Promise<RunCommandResult> {
  const start = Date.now();
  let child: ChildProcess;
  try {
    child = spawnShellLine(commandLine, opts);
  } catch (err) {
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      spawnError: (err as Error).message,
      durationMs: Date.now() - start,
      truncated: false,
    });
  }
  return collect(child, opts, start);
}

/** Returns true when `exe` can be started (used to detect toolchains). */
export async function isExecutableAvailable(exe: string, versionArg = "--version"): Promise<boolean> {
  const res = await runCommand([exe, versionArg], { cwd: process.cwd(), timeoutMs: 8000 });
  return res.exitCode === 0;
}
