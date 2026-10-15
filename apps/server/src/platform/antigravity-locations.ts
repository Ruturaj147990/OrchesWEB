import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where Antigravity and the Orches Bridge keep their files, on every platform and product variant.
 *
 * Two products exist and both are supported:
 * - "Antigravity IDE": CLI `antigravity-ide`, data ~/.gemini/antigravity-ide, settings "<config>/Antigravity IDE".
 * - "Antigravity":     CLI `antigravity`,     data ~/.gemini/antigravity,     settings "<config>/Antigravity".
 * Both record agent conversations in the same SQLite format.
 *
 * Linux packaging also changes the paths: a Snap app sees HOME as ~/snap/<app>/<rev>, so the bridge
 * advertises itself (and Antigravity stores conversations) under that home instead of the real one.
 */

export const PRODUCT_VARIANTS = [
  { id: "antigravity-ide", displayName: "Antigravity IDE", cli: "antigravity-ide", dataDir: "antigravity-ide", configDir: "Antigravity IDE", winExe: "Antigravity IDE.exe" },
  { id: "antigravity", displayName: "Antigravity", cli: "antigravity", dataDir: "antigravity", configDir: "Antigravity", winExe: "Antigravity.exe" },
] as const;

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

function existingDirs(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    if (!d || out.some((o) => samePath(o, d))) continue;
    try {
      if (fs.statSync(d).isDirectory()) out.push(d);
    } catch {
      // not present
    }
  }
  return out;
}

/** Child directories of `dir` (empty when missing/unreadable). */
function subdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Home directories an Antigravity window may be using: the real home, plus Snap homes
 * (~/snap/<app>/current and ~/snap/<app>/<revision>) and any homes reported by running bridges.
 */
export function candidateHomes(extra: string[] = []): string[] {
  const home = os.homedir();
  const snapHomes = subdirs(path.join(home, "snap")).flatMap((app) => subdirs(app));
  return existingDirs([home, ...extra, ...snapHomes]);
}

/** Directories where bridge windows advertise themselves (<dir>/<pid>.json). */
export function bridgeDirs(): string[] {
  const fromEnv = process.env.ORCHES_BRIDGE_DIR ? [process.env.ORCHES_BRIDGE_DIR] : [];
  return existingDirs([...fromEnv, ...candidateHomes().map((h) => path.join(h, ".orches", "antigravity-bridge"))]);
}

/** Where the bridge would be expected when none was ever found (for messages). */
export function primaryBridgeDir(): string {
  return process.env.ORCHES_BRIDGE_DIR || path.join(os.homedir(), ".orches", "antigravity-bridge");
}

/** Agent conversation databases of both product variants, under every candidate home. */
export function conversationDirs(extraHomes: string[] = []): string[] {
  const fromEnv = process.env.ORCHES_ANTIGRAVITY_CONVERSATIONS_DIR ? [process.env.ORCHES_ANTIGRAVITY_CONVERSATIONS_DIR] : [];
  const dirs: string[] = [...fromEnv];
  for (const home of candidateHomes(extraHomes)) {
    for (const v of PRODUCT_VARIANTS) dirs.push(path.join(home, ".gemini", v.dataDir, "conversations"));
  }
  return existingDirs(dirs);
}

/** Per-variant user settings folders (for the IDE's own list of open windows). */
export function userSettingsDirs(): string[] {
  const configRoots =
    process.platform === "win32"
      ? [process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Library", "Application Support")]
        : [process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), ...candidateHomes().map((h) => path.join(h, ".config"))];
  return existingDirs(configRoots.flatMap((root) => PRODUCT_VARIANTS.map((v) => path.join(root, v.configDir, "User"))));
}

/** Command-line launchers to try, "Antigravity IDE" first (the variant Orches was built against). */
export function cliCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const roots = [
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs"),
      process.env.ProgramFiles || "C:\\Program Files",
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    ];
    return PRODUCT_VARIANTS.flatMap((v) => roots.map((r) => path.join(r, v.displayName, "bin", `${v.cli}.cmd`)));
  }
  if (process.platform === "darwin") {
    return PRODUCT_VARIANTS.map((v) => `/Applications/${v.displayName}.app/Contents/Resources/app/bin/${v.cli}`);
  }
  return PRODUCT_VARIANTS.flatMap((v) => [
    path.join(home, ".local", "bin", v.cli),
    `/usr/local/bin/${v.cli}`,
    `/usr/bin/${v.cli}`,
    `/snap/bin/${v.cli}`,
    `/var/lib/flatpak/exports/bin/${v.cli}`,
    path.join(home, ".local", "share", "flatpak", "exports", "bin", v.cli),
    `/opt/${v.displayName}/bin/${v.cli}`,
    `/opt/${v.id}/bin/${v.cli}`,
    `/usr/share/${v.id}/bin/${v.cli}`,
  ]);
}

/** First launcher found on disk, then on PATH. */
export function findCli(): string | null {
  const onDisk = cliCandidates().find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
  if (onDisk) return onDisk;
  const exts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const v of PRODUCT_VARIANTS) {
      for (const ext of exts) {
        const p = path.join(dir, v.cli + ext);
        try {
          if (fs.statSync(p).isFile()) return p;
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

/**
 * Same folder? Compares resolved paths and, when they exist, their real paths, so a folder reached
 * through a symlink (common on Linux: ~/Desktop, /home -> /var/home, mounted drives) still matches.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, "");
    return caseInsensitive ? r.toLowerCase() : r;
  };
  if (norm(a) === norm(b)) return true;
  const real = (p: string) => {
    try {
      return norm(fs.realpathSync.native(p));
    } catch {
      return norm(p);
    }
  };
  return real(a) === real(b);
}
