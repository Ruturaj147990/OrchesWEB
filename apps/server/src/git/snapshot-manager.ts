import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface SnapshotFileEntry {
  hash: string;
  size: number;
}

export interface SnapshotManifest {
  id: string;
  tag: string;
  description: string;
  timestamp: string;
  files: Record<string, SnapshotFileEntry>;
}

export interface SnapshotDiff {
  diff: string;
  filesChanged: string[];
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
}

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".orchestrator",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
  ".turbo",
]);

const DEFAULT_IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

export class SnapshotManager {
  private snapshotDir: string;

  constructor(private workspacePath: string, customSnapshotDir?: string) {
    this.workspacePath = workspacePath || process.cwd();
    this.snapshotDir = customSnapshotDir || path.join(this.workspacePath, ".orchestrator", "snapshots");
  }

  public getSnapshotDir(): string {
    return this.snapshotDir;
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Scans the workspace directory recursively, ignoring node_modules, .git, .orchestrator, etc.
   */
  public scanWorkspaceFiles(): Record<string, { fullPath: string; size: number; hash: string }> {
    const results: Record<string, { fullPath: string; size: number; hash: string }> = {};

    const walk = (currentDir: string) => {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(this.workspacePath, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (!DEFAULT_IGNORED_FILES.has(entry.name)) {
            try {
              const buffer = fs.readFileSync(fullPath);
              const hash = crypto.createHash("sha256").update(buffer).digest("hex");
              results[relPath] = {
                fullPath,
                size: buffer.length,
                hash,
              };
            } catch {
              // Ignore locked or unreadable files safely
            }
          }
        }
      }
    };

    walk(this.workspacePath);
    return results;
  }

  /**
   * Captures a local safety snapshot of the workspace.
   */
  public async takeSnapshot(tag: string, description: string = ""): Promise<SnapshotManifest> {
    const id = `snap-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const targetFolder = path.join(this.snapshotDir, id);
    const filesFolder = path.join(targetFolder, "files");

    this.ensureDir(filesFolder);

    // Auto-create .gitignore inside .orchestrator so git never tracks local snapshots
    const orchestratorRoot = path.dirname(this.snapshotDir);
    const gitignorePath = path.join(orchestratorRoot, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      try {
        fs.writeFileSync(gitignorePath, "*\n", "utf8");
      } catch {}
    }

    const currentFiles = this.scanWorkspaceFiles();
    const manifestFiles: Record<string, SnapshotFileEntry> = {};

    for (const [relPath, fileInfo] of Object.entries(currentFiles)) {
      manifestFiles[relPath] = {
        hash: fileInfo.hash,
        size: fileInfo.size,
      };

      const destPath = path.join(filesFolder, relPath);
      this.ensureDir(path.dirname(destPath));
      fs.copyFileSync(fileInfo.fullPath, destPath);
    }

    const manifest: SnapshotManifest = {
      id,
      tag,
      description,
      timestamp: new Date().toISOString(),
      files: manifestFiles,
    };

    fs.writeFileSync(path.join(targetFolder, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  }

  /**
   * Returns list of all stored snapshots, newest first.
   */
  public listSnapshots(): SnapshotManifest[] {
    if (!fs.existsSync(this.snapshotDir)) return [];
    const entries = fs.readdirSync(this.snapshotDir, { withFileTypes: true });
    const manifests: SnapshotManifest[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("snap-")) {
        const manifestPath = path.join(this.snapshotDir, entry.name, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const raw = fs.readFileSync(manifestPath, "utf8");
            manifests.push(JSON.parse(raw));
          } catch {}
        }
      }
    }

    manifests.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return manifests;
  }

  /**
   * Retrieves the latest snapshot or a specific snapshot by ID.
   */
  public getSnapshot(id: string): SnapshotManifest | null {
    const manifestPath = path.join(this.snapshotDir, id, "manifest.json");
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return null;
    }
  }

  public getLatestSnapshot(): SnapshotManifest | null {
    const list = this.listSnapshots();
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Computes differences between current working directory and a baseline snapshot.
   */
  public async computeDiff(baselineSnapshotId?: string): Promise<SnapshotDiff> {
    const baseline = baselineSnapshotId ? this.getSnapshot(baselineSnapshotId) : this.getLatestSnapshot();
    const baselineFiles = baseline ? baseline.files : {};
    const currentFiles = this.scanWorkspaceFiles();

    const addedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const diffChunks: string[] = [];

    // 1. Detect added and modified files
    for (const [relPath, fileInfo] of Object.entries(currentFiles)) {
      const baseEntry = baselineFiles[relPath];
      if (!baseEntry) {
        addedFiles.push(relPath);
        const currentContent = this.readTextFileSafe(fileInfo.fullPath);
        if (currentContent !== null) {
          diffChunks.push(this.formatAddedDiff(relPath, currentContent));
        } else {
          diffChunks.push(`Binary file added: ${relPath}\n`);
        }
      } else if (baseEntry.hash !== fileInfo.hash) {
        modifiedFiles.push(relPath);
        const snapshotFile = path.join(this.snapshotDir, baseline!.id, "files", relPath);
        const oldContent = this.readTextFileSafe(snapshotFile);
        const newContent = this.readTextFileSafe(fileInfo.fullPath);

        if (oldContent !== null && newContent !== null) {
          diffChunks.push(this.formatUnifiedDiff(relPath, oldContent, newContent));
        } else {
          diffChunks.push(`Binary files a/${relPath} and b/${relPath} differ\n`);
        }
      }
    }

    // 2. Detect deleted files
    for (const relPath of Object.keys(baselineFiles)) {
      if (!currentFiles[relPath]) {
        deletedFiles.push(relPath);
        const snapshotFile = path.join(this.snapshotDir, baseline!.id, "files", relPath);
        const oldContent = this.readTextFileSafe(snapshotFile);
        if (oldContent !== null) {
          diffChunks.push(this.formatDeletedDiff(relPath, oldContent));
        } else {
          diffChunks.push(`Binary file deleted: ${relPath}\n`);
        }
      }
    }

    const filesChanged = [...addedFiles, ...modifiedFiles, ...deletedFiles];
    return {
      diff: diffChunks.join("\n"),
      filesChanged,
      addedFiles,
      modifiedFiles,
      deletedFiles,
    };
  }

  /**
   * Restores workspace files to match the specified snapshot.
   * If filesToDiscard is provided, ONLY reverts those specific files, preserving unrelated user files!
   */
  public async rollback(snapshotId: string, filesToDiscard?: string[]): Promise<void> {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const snapshotFilesDir = path.join(this.snapshotDir, snapshotId, "files");

    if (filesToDiscard !== undefined) {
      if (filesToDiscard.length === 0) {
        return;
      }
      for (const relPath of filesToDiscard) {
        const destPath = path.join(this.workspacePath, relPath);
        const baseEntry = snapshot.files[relPath];

        if (baseEntry) {
          // File existed in snapshot: restore original file content
          const sourcePath = path.join(snapshotFilesDir, relPath);
          if (fs.existsSync(sourcePath)) {
            this.ensureDir(path.dirname(destPath));
            fs.copyFileSync(sourcePath, destPath);
          }
        } else {
          // File did NOT exist in snapshot (newly created during failed attempt): safely delete it
          if (fs.existsSync(destPath)) {
            try {
              fs.unlinkSync(destPath);
            } catch {}
          }
        }
      }
    } else {
      // Full restore: revert all tracked files in snapshot
      for (const [relPath] of Object.entries(snapshot.files)) {
        const sourcePath = path.join(snapshotFilesDir, relPath);
        const destPath = path.join(this.workspacePath, relPath);
        if (fs.existsSync(sourcePath)) {
          this.ensureDir(path.dirname(destPath));
          fs.copyFileSync(sourcePath, destPath);
        }
      }

      // Remove files created since snapshot
      const current = this.scanWorkspaceFiles();
      for (const relPath of Object.keys(current)) {
        if (!snapshot.files[relPath]) {
          const destPath = path.join(this.workspacePath, relPath);
          try {
            fs.unlinkSync(destPath);
          } catch {}
        }
      }
    }
  }

  private readTextFileSafe(filePath: string): string | null {
    try {
      const buffer = fs.readFileSync(filePath);
      // Simple binary check: look for null bytes
      for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
        if (buffer[i] === 0) return null;
      }
      return buffer.toString("utf8");
    } catch {
      return null;
    }
  }

  private formatAddedDiff(relPath: string, content: string): string {
    const lines = content.split("\n");
    const diff = [
      `diff --git a/${relPath} b/${relPath}`,
      `new file mode 100644`,
      `--- /dev/null`,
      `+++ b/${relPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
    ];
    return diff.join("\n");
  }

  private formatDeletedDiff(relPath: string, content: string): string {
    const lines = content.split("\n");
    const diff = [
      `diff --git a/${relPath} b/${relPath}`,
      `deleted file mode 100644`,
      `--- a/${relPath}`,
      `+++ /dev/null`,
      `@@ -1,${lines.length} +0,0 @@`,
      ...lines.map((l) => `-${l}`),
    ];
    return diff.join("\n");
  }

  private formatUnifiedDiff(relPath: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    const header = [
      `diff --git a/${relPath} b/${relPath}`,
      `--- a/${relPath}`,
      `+++ b/${relPath}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ];

    // Simple line diff
    const body: string[] = [];
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o !== undefined && n !== undefined) {
        if (o === n) {
          body.push(` ${o}`);
        } else {
          body.push(`-${o}`);
          body.push(`+${n}`);
        }
      } else if (o !== undefined) {
        body.push(`-${o}`);
      } else if (n !== undefined) {
        body.push(`+${n}`);
      }
    }

    return [...header, ...body].join("\n");
  }
}
