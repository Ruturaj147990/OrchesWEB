import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./process-runner.js";

export interface AntigravityStatus {
  installed: boolean;
  cliPath: string | null;
  running: boolean;
  /** Folders open in IDE windows, according to the IDE's own window state. */
  openFolders: string[];
  /** True when the project workspace is one of the open folders. */
  workspaceOpen: boolean;
  nativeAgent: { available: false; reason: string };
}

/**
 * What this installation can and cannot do with Antigravity IDE. Verified on
 * Antigravity IDE 1.107 (Windows):
 * - `antigravity-ide <folder>` (documented VS Code-style CLI) opens a folder; works.
 * - `antigravity-ide chat -m agent <prompt>` opens the Agent panel but does not submit the prompt.
 * - The language server's `agentapi new-conversation` refuses to run unless the IDE itself supplies
 *   ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN, which it only gives to processes it launches.
 * So the orchestrator cannot drive the IDE's built-in agent; it can show the workspace in the IDE,
 * where file changes made by the orchestrator appear live.
 */
export const NATIVE_AGENT_UNAVAILABLE_REASON =
  "Antigravity's built-in agent has no supported interface for external programs: its agent API requires credentials the IDE only passes to processes it launches. Tasks are executed by the orchestrator's built-in coder; open the workspace in Antigravity to watch the files change.";

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export function findAntigravityCli(): string | null {
  const candidates =
    process.platform === "win32"
      ? [path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd")]
      : ["/usr/local/bin/antigravity-ide", "/usr/bin/antigravity-ide", "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let p = decodeURIComponent(uri.slice("file://".length));
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  return path.normalize(p);
}

export function readOpenFolders(storageDir?: string): string[] {
  const appData = process.env.APPDATA || path.join(process.env.HOME || "", ".config");
  const file = path.join(storageDir ?? path.join(appData, "Antigravity IDE", "User"), "globalStorage", "storage.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      windowsState?: { lastActiveWindow?: { folder?: string }; openedWindows?: Array<{ folder?: string }> };
    };
    const uris = [data.windowsState?.lastActiveWindow?.folder, ...(data.windowsState?.openedWindows ?? []).map((w) => w.folder)].filter(
      (u): u is string => typeof u === "string"
    );
    const out: string[] = [];
    for (const uri of uris) {
      const p = fileUriToPath(uri);
      if (p && !out.some((o) => samePath(o, p))) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

async function isRunning(): Promise<boolean> {
  if (process.platform === "win32") {
    const res = await runCommand(["tasklist", "/FI", "IMAGENAME eq Antigravity IDE.exe", "/FO", "CSV", "/NH"], { cwd: process.cwd(), timeoutMs: 8000 });
    return res.exitCode === 0 && res.stdout.toLowerCase().includes("antigravity ide.exe");
  }
  const res = await runCommand(["pgrep", "-f", "antigravity"], { cwd: process.cwd(), timeoutMs: 5000 });
  return res.exitCode === 0;
}

export async function getAntigravityStatus(workspaceRoot?: string): Promise<AntigravityStatus> {
  const cliPath = findAntigravityCli();
  const running = await isRunning();
  const openFolders = running ? readOpenFolders() : [];
  return {
    installed: Boolean(cliPath),
    cliPath,
    running,
    openFolders,
    workspaceOpen: Boolean(workspaceRoot && openFolders.some((f) => samePath(f, workspaceRoot))),
    nativeAgent: { available: false, reason: NATIVE_AGENT_UNAVAILABLE_REASON },
  };
}

/** Open (or focus) a folder in Antigravity IDE using its documented command-line interface. */
export async function openInAntigravity(folder: string): Promise<{ ok: boolean; message: string }> {
  const cli = findAntigravityCli();
  if (!cli) return { ok: false, message: "Antigravity IDE command-line launcher was not found." };
  const res = await runCommand([cli, folder], { cwd: folder, timeoutMs: 30_000 });
  return res.exitCode === 0
    ? { ok: true, message: `Opened ${folder} in Antigravity IDE.` }
    : { ok: false, message: `Antigravity IDE launcher failed: ${(res.stderr || res.spawnError || `exit ${res.exitCode}`).trim()}` };
}
