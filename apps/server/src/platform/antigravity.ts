import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./process-runner.js";
import { getBridgeStatus } from "./antigravity-agent.js";
import { findCli, samePath, userSettingsDirs, PRODUCT_VARIANTS } from "./antigravity-locations.js";

export interface AntigravityStatus {
  installed: boolean;
  cliPath: string | null;
  running: boolean;
  /** Folders open in IDE windows, according to the IDE's own window state. */
  openFolders: string[];
  /** True when the project workspace is one of the open folders. */
  workspaceOpen: boolean;
  /** Whether the native Antigravity Agent can be driven for this workspace (via the Orches Bridge). */
  nativeAgent: { available: boolean; reason: string; bridgeInstalled: boolean };
}

/**
 * Antigravity IDE facts verified on version 1.107 (Windows):
 * - `antigravity-ide <folder>` (documented VS Code-style CLI) opens a folder.
 * - `antigravity-ide chat -m agent <prompt>` opens the Agent panel but does not submit the prompt.
 * - The language server's `agentapi` needs credentials the IDE only passes to processes it launches.
 * - The workbench command `antigravity.sendPromptToAgentPanel` submits a prompt to the Agent panel;
 *   the Orches Bridge extension (apps/antigravity-bridge) invokes it inside the IDE. See antigravity-agent.ts.
 */
/** Antigravity IDE or Antigravity command-line launcher (any platform; see antigravity-locations.ts). */
export function findAntigravityCli(): string | null {
  return findCli();
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let p = decodeURIComponent(uri.slice("file://".length));
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  return path.normalize(p);
}

export function readOpenFolders(storageDir?: string): string[] {
  const out: string[] = [];
  for (const dir of storageDir ? [storageDir] : userSettingsDirs()) {
    for (const p of readOpenFoldersFrom(path.join(dir, "globalStorage", "storage.json"))) {
      if (!out.some((o) => samePath(o, p))) out.push(p);
    }
  }
  return out;
}

function readOpenFoldersFrom(file: string): string[] {
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
    for (const v of PRODUCT_VARIANTS) {
      const res = await runCommand(["tasklist", "/FI", `IMAGENAME eq ${v.winExe}`, "/FO", "CSV", "/NH"], { cwd: process.cwd(), timeoutMs: 8000 });
      if (res.exitCode === 0 && res.stdout.toLowerCase().includes(v.winExe.toLowerCase())) return true;
    }
    return false;
  }
  // Match the IDE's own executable (deb/rpm/tarball/Snap installs), not any process that mentions "antigravity".
  for (const v of PRODUCT_VARIANTS) {
    const byName = await runCommand(["pgrep", "-x", v.cli], { cwd: process.cwd(), timeoutMs: 5000 });
    if (byName.exitCode === 0) return true;
  }
  const byPath = await runCommand(["pgrep", "-f", "/(antigravity|antigravity-ide)( |$)"], { cwd: process.cwd(), timeoutMs: 5000 });
  return byPath.exitCode === 0;
}

export async function getAntigravityStatus(workspaceRoot?: string): Promise<AntigravityStatus> {
  const cliPath = findAntigravityCli();
  const running = await isRunning();
  const openFolders = running ? readOpenFolders() : [];
  const bridge = await getBridgeStatus(workspaceRoot);
  return {
    installed: Boolean(cliPath),
    cliPath,
    running,
    openFolders,
    workspaceOpen: Boolean(workspaceRoot && (openFolders.some((f) => samePath(f, workspaceRoot)) || bridge.matchingWindow)),
    nativeAgent: {
      available: Boolean(bridge.matchingWindow?.canSubmit) || (!workspaceRoot && bridge.windows.some((w) => w.canSubmit)),
      reason: bridge.message,
      bridgeInstalled: bridge.bridgeInstalled,
    },
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
