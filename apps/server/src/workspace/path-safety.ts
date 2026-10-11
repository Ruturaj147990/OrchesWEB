import fs from "node:fs";
import path from "node:path";
import { ORCHESTRATOR_ROOT } from "../config/env.js";
import { SettingsManager } from "../platform/settings-manager.js";

/** Folders a project may never point at (or contain): this installation and its data directory. */
export function forbiddenWorkspaceRoots(): string[] {
  return [ORCHESTRATOR_ROOT, SettingsManager.getDataDir()];
}

export type PathResolution =
  | { ok: true; relPath: string; absPath: string }
  | { ok: false; reason: string };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_SEGMENT_CHARS = /[<>:"|?*\u0000-\u001f]/;
const ALLOWED_ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

function samePath(a: string, b: string): boolean {
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `child` equals `parent` or is inside it (segment-aware, not a string prefix test). */
export function isInsideOrEqual(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Reserved locations that no coding mechanism may write to. */
export function reservedPathReason(relPosix: string): string | null {
  const segments = relPosix.split("/");
  const lower = segments.map((s) => s.toLowerCase());
  if (lower.includes(".git")) return "the .git directory is managed by Git";
  if (lower[0] === ".orchestrator") return ".orchestrator is reserved for orchestrator metadata";
  const base = lower[lower.length - 1];
  if ((base === ".env" || base.startsWith(".env.")) && !ALLOWED_ENV_TEMPLATES.has(base)) {
    return "environment files may contain secrets";
  }
  if (/\.(pem|key|p12|pfx)$/.test(base)) return "key material may not be written";
  return null;
}

/**
 * Resolve a file path proposed by an untrusted source (a language model) to a
 * location inside `workspaceRoot`. Absolute paths are only accepted when they
 * point inside the workspace; parent traversal is rejected, never "repaired".
 */
export function resolveModelPath(workspaceRoot: string, rawPath: unknown): PathResolution {
  if (typeof rawPath !== "string") return { ok: false, reason: "path is not a string" };
  let p = rawPath.trim().replace(/^[`'"]+|[`'"]+$/g, "").trim();
  if (!p) return { ok: false, reason: "path is empty" };
  if (p.includes("\u0000")) return { ok: false, reason: "path contains a null byte" };

  const root = path.resolve(workspaceRoot);
  const rootPosix = root.replace(/\\/g, "/");
  p = p.replace(/\\/g, "/");

  if (p.startsWith("//")) return { ok: false, reason: "UNC/network paths are not allowed" };

  if (/^[a-zA-Z]:/.test(p)) {
    if (!/^[a-zA-Z]:\//.test(p)) return { ok: false, reason: "drive-relative paths are not allowed" };
    const abs = path.win32.normalize(p);
    if (process.platform !== "win32" || !isInsideOrEqual(root, abs)) {
      return { ok: false, reason: `absolute path is outside the workspace (${rawPath})` };
    }
    p = path.relative(root, abs).replace(/\\/g, "/");
  } else if (p.startsWith("/")) {
    // Models often write project-rooted paths like "/src/app.js". Absolute paths that
    // spell out the workspace itself (with or without a drive letter) are relativized.
    const rootNoDrive = rootPosix.replace(/^[a-zA-Z]:/, "");
    if (samePath(p, rootNoDrive) || (p.length > rootNoDrive.length && samePath(p.slice(0, rootNoDrive.length + 1), rootNoDrive + "/"))) {
      p = p.slice(rootNoDrive.length);
    }
    p = p.replace(/^\/+/, "");
  }

  const segments: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return { ok: false, reason: "parent-directory traversal ('..') is not allowed" };
    if (INVALID_SEGMENT_CHARS.test(seg)) return { ok: false, reason: `invalid character in path segment '${seg}'` };
    if (/[. ]$/.test(seg)) return { ok: false, reason: `path segment '${seg}' ends with a dot or space` };
    if (WINDOWS_RESERVED.test(seg)) return { ok: false, reason: `'${seg}' is a reserved device name on Windows` };
    segments.push(seg);
  }
  if (segments.length === 0) return { ok: false, reason: "path does not name a file" };

  // "myproject/src/x.js" when the workspace itself is "myproject": strip the repeated folder
  // name, unless the workspace genuinely contains a sub-folder with that name.
  const wsName = path.basename(root);
  if (segments.length > 1 && samePath(segments[0], wsName) && !fs.existsSync(path.join(root, segments[0]))) {
    segments.shift();
  }

  const relPath = segments.join("/");
  const reserved = reservedPathReason(relPath);
  if (reserved) return { ok: false, reason: `writing '${relPath}' is blocked: ${reserved}` };

  const absPath = path.join(root, ...segments);
  if (!isInsideOrEqual(root, absPath) || samePath(absPath, root)) {
    return { ok: false, reason: "path resolves outside the workspace" };
  }

  // Symlink/junction escape: the deepest existing ancestor must still be inside the real workspace.
  try {
    const realRoot = fs.realpathSync.native(root);
    let probe = path.dirname(absPath);
    while (!fs.existsSync(probe) && isInsideOrEqual(root, probe) && probe !== root) {
      probe = path.dirname(probe);
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync.native(probe);
      if (!isInsideOrEqual(realRoot, realProbe)) {
        return { ok: false, reason: "path escapes the workspace through a symbolic link" };
      }
    }
    if (fs.existsSync(absPath) && fs.lstatSync(absPath).isSymbolicLink()) {
      return { ok: false, reason: "refusing to write through a symbolic link" };
    }
  } catch {
    // Workspace root missing: callers validate the root separately.
  }

  return { ok: true, relPath, absPath };
}

export interface WorkspaceRootCheck {
  ok: boolean;
  canonicalPath: string;
  reason?: string;
}

/**
 * Validate a folder the user selected as a project workspace. Refuses drive
 * roots, system folders, the user's home folder itself, and the orchestrator's
 * own installation or data directories.
 */
export function validateWorkspaceRoot(
  rawPath: string,
  forbiddenRoots: string[],
  opts: { allowCreate?: boolean } = {}
): WorkspaceRootCheck {
  const trimmed = (rawPath || "").trim().replace(/^"+|"+$/g, "");
  if (!trimmed) return { ok: false, canonicalPath: "", reason: "A workspace folder path is required." };
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, canonicalPath: trimmed, reason: "Workspace path must be absolute (for example C:\\Users\\you\\projects\\app)." };
  }
  let canonical = path.resolve(trimmed);
  if (fs.existsSync(canonical)) {
    try {
      canonical = fs.realpathSync.native(canonical);
    } catch {}
    if (!fs.statSync(canonical).isDirectory()) {
      return { ok: false, canonicalPath: canonical, reason: "Workspace path points to a file, not a folder." };
    }
  } else if (!opts.allowCreate) {
    return { ok: false, canonicalPath: canonical, reason: "Workspace folder does not exist." };
  } else if (!fs.existsSync(path.dirname(canonical))) {
    return { ok: false, canonicalPath: canonical, reason: "Parent folder of the new workspace does not exist." };
  }

  if (path.parse(canonical).root === canonical) {
    return { ok: false, canonicalPath: canonical, reason: "A drive or filesystem root cannot be used as a workspace." };
  }
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home && samePath(path.resolve(home), canonical)) {
    return { ok: false, canonicalPath: canonical, reason: "Your home folder itself cannot be used; choose a project folder inside it." };
  }
  const systemDirs = [process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData]
    .filter(Boolean)
    .map((d) => path.resolve(d as string));
  if (process.platform !== "win32") systemDirs.push("/usr", "/bin", "/etc", "/System", "/Library");
  for (const sys of systemDirs) {
    if (isInsideOrEqual(sys, canonical)) {
      return { ok: false, canonicalPath: canonical, reason: `System folder ${sys} cannot be used as a workspace.` };
    }
  }
  for (const forbidden of forbiddenRoots) {
    const f = path.resolve(forbidden);
    if (isInsideOrEqual(f, canonical) || isInsideOrEqual(canonical, f)) {
      return {
        ok: false,
        canonicalPath: canonical,
        reason: `This folder overlaps the orchestrator's own files (${f}); choose a separate project folder.`,
      };
    }
  }
  return { ok: true, canonicalPath: canonical };
}
