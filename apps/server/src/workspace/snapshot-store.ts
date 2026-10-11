import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { unifiedDiff } from "./text-diff.js";

export interface SnapshotEntry {
  hash: string;
  size: number;
  /** False when the file was too large to keep a restorable copy. */
  stored: boolean;
}

export interface WorkspaceSnapshot {
  id: string;
  tag: string;
  createdAt: string;
  mode: "git" | "filesystem";
  files: Record<string, SnapshotEntry>;
  dirs: string[];
}

export interface WorkspaceChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface WorkspaceDiff {
  changes: WorkspaceChange[];
  diffText: string;
  truncated: boolean;
}

export interface RestoreResult {
  restored: string[];
  removed: string[];
  failed: Array<{ path: string; error: string }>;
  /** Copies of the discarded versions, so a rollback never destroys content. */
  backupDir: string | null;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".orchestrator",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const MAX_STORED_BYTES = 20 * 1024 * 1024;
const MAX_HASHED_BYTES = 64 * 1024 * 1024;
const MAX_DIFF_CHARS = 400_000;

function isIgnoredRel(rel: string): boolean {
  const segs = rel.split("/");
  return segs.some((s) => s === ".git" || s === ".orchestrator") || IGNORED_FILES.has(segs[segs.length - 1]);
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Content-addressed workspace snapshots kept outside the workspace. Used for
 * exact change detection and scoped rollback in Git and non-Git projects.
 */
export class SnapshotStore {
  private blobsDir: string;
  private snapshotsDir: string;

  constructor(private workspaceRoot: string, private storeDir: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.blobsDir = path.join(storeDir, "blobs");
    this.snapshotsDir = path.join(storeDir, "snapshots");
  }

  public getStoreDir(): string {
    return this.storeDir;
  }

  /** Files Git would track (tracked + untracked, honoring .gitignore), else a filtered walk. */
  public listWorkspaceFiles(): { mode: "git" | "filesystem"; files: string[] } {
    const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (git.status === 0 && typeof git.stdout === "string" && this.isGitWorkTreeRoot()) {
      const files = Array.from(new Set(git.stdout.split("\0").filter(Boolean)))
        .filter((rel) => !isIgnoredRel(rel))
        .filter((rel) => {
          try {
            return fs.lstatSync(path.join(this.workspaceRoot, rel)).isFile();
          } catch {
            return false; // tracked but deleted in the working tree
          }
        });
      return { mode: "git", files };
    }

    const files: string[] = [];
    const walk = (dir: string, relBase: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) walk(path.join(dir, e.name), rel);
        } else if (e.isFile() && !IGNORED_FILES.has(e.name)) {
          files.push(rel);
        }
      }
    };
    walk(this.workspaceRoot, "");
    return { mode: "filesystem", files };
  }

  private isGitWorkTreeRoot(): boolean {
    const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    return res.status === 0 && res.stdout.trim() === "true";
  }

  private blobPath(hash: string): string {
    return path.join(this.blobsDir, hash.slice(0, 2), hash.slice(2));
  }

  private hashFile(abs: string): { hash: string; size: number; buffer: Buffer | null } {
    const stat = fs.statSync(abs);
    if (stat.size > MAX_HASHED_BYTES) {
      return { hash: `size:${stat.size}:mtime:${stat.mtimeMs}`, size: stat.size, buffer: null };
    }
    const buffer = fs.readFileSync(abs);
    return { hash: crypto.createHash("sha256").update(buffer).digest("hex"), size: buffer.length, buffer };
  }

  public take(tag: string): WorkspaceSnapshot {
    const { mode, files } = this.listWorkspaceFiles();
    const entries: Record<string, SnapshotEntry> = {};
    const dirs = new Set<string>();
    for (const rel of files) {
      const abs = path.join(this.workspaceRoot, rel);
      try {
        const { hash, size, buffer } = this.hashFile(abs);
        let stored = false;
        if (buffer && size <= MAX_STORED_BYTES) {
          const blob = this.blobPath(hash);
          if (!fs.existsSync(blob)) {
            fs.mkdirSync(path.dirname(blob), { recursive: true });
            fs.writeFileSync(blob, buffer);
          }
          stored = true;
        }
        entries[rel] = { hash, size, stored };
        const segs = rel.split("/");
        for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join("/"));
      } catch {
        // Unreadable/locked file: not part of the snapshot.
      }
    }
    const snapshot: WorkspaceSnapshot = {
      id: `snap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      tag,
      createdAt: new Date().toISOString(),
      mode,
      files: entries,
      dirs: Array.from(dirs),
    };
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    fs.writeFileSync(path.join(this.snapshotsDir, `${snapshot.id}.json`), JSON.stringify(snapshot), "utf8");
    return snapshot;
  }

  public get(id: string): WorkspaceSnapshot | null {
    if (!/^snap-[\w-]+$/.test(id)) return null;
    const file = path.join(this.snapshotsDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceSnapshot;
    } catch {
      return null;
    }
  }

  public list(): WorkspaceSnapshot[] {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs
      .readdirSync(this.snapshotsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.get(f.slice(0, -5)))
      .filter((s): s is WorkspaceSnapshot => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private readBlob(entry: SnapshotEntry): Buffer | null {
    if (!entry.stored) return null;
    try {
      return fs.readFileSync(this.blobPath(entry.hash));
    } catch {
      return null;
    }
  }

  /** Exact changes between a snapshot and the current workspace. */
  public diff(snapshot: WorkspaceSnapshot): WorkspaceDiff {
    const current = this.listWorkspaceFiles().files;
    const currentSet = new Set(current);
    const changes: WorkspaceChange[] = [];
    const chunks: string[] = [];
    let total = 0;
    let truncated = false;

    const addChunk = (text: string) => {
      if (total + text.length > MAX_DIFF_CHARS) {
        truncated = true;
        return;
      }
      chunks.push(text);
      total += text.length;
    };

    for (const rel of current.sort()) {
      const abs = path.join(this.workspaceRoot, rel);
      let info: { hash: string; size: number; buffer: Buffer | null };
      try {
        info = this.hashFile(abs);
      } catch {
        continue;
      }
      const before = snapshot.files[rel];
      if (before && before.hash === info.hash) continue;
      const kind = before ? "modified" : "added";
      const oldBuf = before ? this.readBlob(before) : null;
      const newBuf = info.buffer;
      const binary = (newBuf !== null && isBinary(newBuf)) || (oldBuf !== null && isBinary(oldBuf)) || newBuf === null;
      if (binary) {
        changes.push({ path: rel, kind, additions: 0, deletions: 0, binary: true });
        addChunk(`diff --git a/${rel} b/${rel}\nBinary or large file ${kind}\n`);
      } else {
        const d = unifiedDiff(rel, before ? (oldBuf ? oldBuf.toString("utf8") : "") : null, newBuf!.toString("utf8"));
        changes.push({ path: rel, kind, additions: d.stats.additions, deletions: d.stats.deletions, binary: false });
        addChunk(d.text + "\n");
      }
    }
    for (const rel of Object.keys(snapshot.files).sort()) {
      if (currentSet.has(rel)) continue;
      const oldBuf = this.readBlob(snapshot.files[rel]);
      if (oldBuf && !isBinary(oldBuf)) {
        const d = unifiedDiff(rel, oldBuf.toString("utf8"), null);
        changes.push({ path: rel, kind: "deleted", additions: 0, deletions: d.stats.deletions, binary: false });
        addChunk(d.text + "\n");
      } else {
        changes.push({ path: rel, kind: "deleted", additions: 0, deletions: 0, binary: true });
        addChunk(`diff --git a/${rel} b/${rel}\nBinary or large file deleted\n`);
      }
    }
    return { changes, diffText: chunks.join("\n"), truncated };
  }

  /**
   * Return the given paths to their snapshot state. Files that did not exist in
   * the snapshot are removed. The versions being discarded are copied to a
   * backup folder first.
   */
  public restore(snapshot: WorkspaceSnapshot, relPaths: string[], backupLabel: string): RestoreResult {
    const result: RestoreResult = { restored: [], removed: [], failed: [], backupDir: null };
    if (relPaths.length === 0) return result;
    const backupDir = path.join(this.storeDir, "discarded", `${new Date().toISOString().replace(/[:.]/g, "-")}-${backupLabel.replace(/[^\w-]/g, "_")}`);

    for (const rel of relPaths) {
      if (rel.includes("..") || path.isAbsolute(rel)) {
        result.failed.push({ path: rel, error: "unsafe path" });
        continue;
      }
      const abs = path.join(this.workspaceRoot, rel);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const dest = path.join(backupDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(abs, dest);
          result.backupDir = backupDir;
        }
        const entry = snapshot.files[rel];
        if (entry) {
          const buf = this.readBlob(entry);
          if (!buf) throw new Error("original content was not stored (file too large)");
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, buf);
          result.restored.push(rel);
        } else {
          if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
          result.removed.push(rel);
          this.removeEmptyParents(snapshot, rel);
        }
      } catch (err) {
        result.failed.push({ path: rel, error: (err as Error).message });
      }
    }
    return result;
  }

  private removeEmptyParents(snapshot: WorkspaceSnapshot, rel: string): void {
    const existed = new Set(snapshot.dirs);
    const segs = rel.split("/");
    for (let i = segs.length - 1; i >= 1; i--) {
      const dirRel = segs.slice(0, i).join("/");
      if (existed.has(dirRel)) return;
      const abs = path.join(this.workspaceRoot, dirRel);
      try {
        if (fs.readdirSync(abs).length > 0) return;
        fs.rmdirSync(abs);
      } catch {
        return;
      }
    }
  }

  /** Keep the newest `keep` snapshots and drop blobs nothing references. */
  public prune(keep = 30): void {
    const all = this.list();
    for (const old of all.slice(keep)) {
      try {
        fs.rmSync(path.join(this.snapshotsDir, `${old.id}.json`), { force: true });
      } catch {}
    }
    const referenced = new Set<string>();
    for (const s of all.slice(0, keep)) for (const e of Object.values(s.files)) referenced.add(e.hash);
    if (!fs.existsSync(this.blobsDir)) return;
    for (const prefix of fs.readdirSync(this.blobsDir)) {
      const dir = path.join(this.blobsDir, prefix);
      for (const rest of fs.readdirSync(dir)) {
        if (!referenced.has(prefix + rest)) {
          try {
            fs.rmSync(path.join(dir, rest), { force: true });
          } catch {}
        }
      }
    }
  }
}
