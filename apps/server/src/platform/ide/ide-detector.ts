import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IdeWorkspaceInfo } from "@orchestrator/shared-types";

export interface IdeDetectorOptions {
  appDataDir?: string;
  mockProcesses?: Array<{ processId: number; name: string; commandLine?: string }>;
  mockStorageJson?: Record<string, unknown>;
  mockWorkspaceStorage?: Array<{ folder: string; hash?: string }>;
}

export interface IdeDetectionResult {
  ideRunning: boolean;
  processIds: number[];
  languageServerPids: number[];
  workspaces: IdeWorkspaceInfo[];
  activeWorkspaceUri: string | null;
  message?: string;
}

export class IdeDetector {
  private customAppDataDir?: string;
  private mockProcesses?: Array<{ processId: number; name: string; commandLine?: string }>;
  private mockStorageJson?: Record<string, unknown>;
  private mockWorkspaceStorage?: Array<{ folder: string; hash?: string }>;

  constructor(options: IdeDetectorOptions = {}) {
    this.customAppDataDir = options.appDataDir;
    this.mockProcesses = options.mockProcesses;
    this.mockStorageJson = options.mockStorageJson;
    this.mockWorkspaceStorage = options.mockWorkspaceStorage;
  }

  public detectWorkspaces(projectRootPath: string): IdeDetectionResult {
    // 1. Detect IDE processes
    const runningProcesses = this.detectRunningProcesses();
    const idePids = runningProcesses.idePids;
    const lsPids = runningProcesses.lsPids;
    const isRunning = idePids.length > 0 || lsPids.length > 0;

    // Canonicalize target project root path
    let canonicalProjectRoot: string | null = null;
    try {
      if (fs.existsSync(projectRootPath)) {
        canonicalProjectRoot = this.canonicalizePath(fs.realpathSync(projectRootPath));
      } else {
        canonicalProjectRoot = this.canonicalizePath(path.resolve(projectRootPath));
      }
    } catch {
      canonicalProjectRoot = this.canonicalizePath(path.resolve(projectRootPath));
    }

    // 2. Discover workspaces from VS Code storage
    const rawFolders: Array<{ uri: string; isActive: boolean }> = [];

    // A. Read storage.json
    const storageData = this.readStorageJson();
    let activeUri: string | null = null;

    if (storageData) {
      const lastActive = (storageData.windowsState as Record<string, unknown>)?.lastActiveWindow as Record<string, unknown> | undefined;
      if (lastActive && typeof lastActive.folder === "string") {
        activeUri = lastActive.folder;
        rawFolders.push({ uri: activeUri, isActive: true });
      }

      const backupWorkspaces = storageData.backupWorkspaces as Record<string, unknown> | undefined;
      if (backupWorkspaces && Array.isArray(backupWorkspaces.folders)) {
        for (const f of backupWorkspaces.folders as Array<{ folderUri?: string }>) {
          if (f && typeof f.folderUri === "string") {
            if (!rawFolders.some((rf) => rf.uri === f.folderUri)) {
              rawFolders.push({ uri: f.folderUri, isActive: f.folderUri === activeUri });
            }
          }
        }
      }
    }

    // B. Read workspaceStorage folders
    const wsFolders = this.readWorkspaceStorage();
    for (const wf of wsFolders) {
      if (!rawFolders.some((rf) => rf.uri === wf)) {
        rawFolders.push({ uri: wf, isActive: wf === activeUri });
      }
    }

    // 3. Process, canonicalize, and validate workspaces
    const workspaces: IdeWorkspaceInfo[] = [];
    const seenPaths = new Set<string>();

    for (const item of rawFolders) {
      const localPath = this.uriToLocalPath(item.uri);
      if (!localPath) continue;

      let canonical: string;
      try {
        if (fs.existsSync(localPath)) {
          canonical = this.canonicalizePath(fs.realpathSync(localPath));
        } else {
          canonical = this.canonicalizePath(path.resolve(localPath));
        }
      } catch {
        canonical = this.canonicalizePath(path.resolve(localPath));
      }

      if (seenPaths.has(canonical.toLowerCase())) continue;
      seenPaths.add(canonical.toLowerCase());

      const folderName = path.basename(canonical) || canonical;
      const isMatching = canonicalProjectRoot !== null && canonical.toLowerCase() === canonicalProjectRoot.toLowerCase();

      const wsHash = crypto.createHash("sha256").update(canonical.toLowerCase()).digest("hex").slice(0, 12);
      workspaces.push({
        id: `ws-${wsHash}`,
        folderUri: item.uri,
        canonicalPath: canonical,
        name: folderName,
        isMatchingProject: isMatching,
        isActiveWindow: item.isActive,
        processId: idePids[0] || lsPids[0] || null,
        lastHeartbeat: isRunning ? new Date().toISOString() : null,
      });
    }

    // Ensure matching workspace exists if IDE is running and pointed at the directory
    if (workspaces.length === 0 && isRunning && canonicalProjectRoot) {
      const wsHash = crypto.createHash("sha256").update(canonicalProjectRoot.toLowerCase()).digest("hex").slice(0, 12);
      workspaces.push({
        id: `ws-${wsHash}`,
        folderUri: `file://${canonicalProjectRoot.replace(/\\/g, "/")}`,
        canonicalPath: canonicalProjectRoot,
        name: path.basename(canonicalProjectRoot),
        isMatchingProject: true,
        isActiveWindow: true,
        processId: idePids[0] || lsPids[0] || null,
        lastHeartbeat: new Date().toISOString(),
      });
    }

    return {
      ideRunning: isRunning,
      processIds: idePids,
      languageServerPids: lsPids,
      workspaces,
      activeWorkspaceUri: activeUri,
      message: isRunning
        ? `Antigravity IDE detected (${idePids.length} process(es), ${workspaces.length} workspace(s) identified)`
        : "Antigravity IDE is not running. Please launch the IDE to connect.",
    };
  }

  public uriToLocalPath(uri: string): string | null {
    if (!uri) return null;
    try {
      if (uri.startsWith("file://")) {
        // Standard URL decode
        let decoded = decodeURIComponent(uri.replace(/^file:\/\//, ""));
        // Handle Windows leading slash e.g. /c:/ or /C:/
        if (/^\/[a-zA-Z]:/.test(decoded)) {
          decoded = decoded.slice(1);
        }
        return path.normalize(decoded);
      }
      return path.normalize(uri);
    } catch {
      return null;
    }
  }

  public canonicalizePath(p: string): string {
    const normalized = path.normalize(path.resolve(p));
    // On Windows, normalize drive letter to lowercase
    if (process.platform === "win32" && /^[a-zA-Z]:/.test(normalized)) {
      return normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }
    return normalized;
  }

  private detectRunningProcesses(): { idePids: number[]; lsPids: number[] } {
    if (this.mockProcesses) {
      const idePids = this.mockProcesses
        .filter((p) => p.name.toLowerCase().includes("antigravity ide"))
        .map((p) => p.processId);
      const lsPids = this.mockProcesses
        .filter((p) => p.name.toLowerCase().includes("language_server"))
        .map((p) => p.processId);
      return { idePids, lsPids };
    }

    const idePids: number[] = [];
    const lsPids: number[] = [];

    if (process.platform === "win32") {
      try {
        const output = execSync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.ProcessName -like \'*Antigravity*\' } | Select-Object Id, ProcessName | ConvertTo-Json"',
          { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
        );
        const parsed = JSON.parse(output.trim() || "[]");
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          if (!item || !item.Id) continue;
          const name = String(item.ProcessName || "").toLowerCase();
          if (name.includes("antigravity ide") || name === "antigravity ide") {
            idePids.push(item.Id);
          } else if (name.includes("language_server")) {
            lsPids.push(item.Id);
          } else {
            idePids.push(item.Id);
          }
        }
      } catch {
        // Fallback or process query failed
      }
    } else {
      try {
        const output = execSync("pgrep -f -l 'antigravity'", {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const lines = output.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[0], 10);
          if (!isNaN(pid)) {
            idePids.push(pid);
          }
        }
      } catch {
        // Process not found
      }
    }

    return { idePids, lsPids };
  }

  private getStorageDir(): string {
    if (this.customAppDataDir) {
      return this.customAppDataDir;
    }
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
    return path.join(appData, "Antigravity IDE", "User");
  }

  private readStorageJson(): Record<string, unknown> | null {
    if (this.mockStorageJson) {
      return this.mockStorageJson;
    }

    const storagePath = path.join(this.getStorageDir(), "globalStorage", "storage.json");
    if (!fs.existsSync(storagePath)) return null;

    try {
      const content = fs.readFileSync(storagePath, "utf8");
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readWorkspaceStorage(): string[] {
    if (this.mockWorkspaceStorage) {
      return this.mockWorkspaceStorage.map((m) => m.folder);
    }
    if (this.mockStorageJson) {
      return [];
    }

    const wsDir = path.join(this.getStorageDir(), "workspaceStorage");
    if (!fs.existsSync(wsDir)) return [];

    const result: string[] = [];
    try {
      const entries = fs.readdirSync(wsDir);
      for (const entry of entries) {
        const wsJsonPath = path.join(wsDir, entry, "workspace.json");
        if (fs.existsSync(wsJsonPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(wsJsonPath, "utf8"));
            if (data && typeof data.folder === "string") {
              result.push(data.folder);
            }
          } catch {
            // Ignore malformed files
          }
        }
      }
    } catch {
      // Directory read error
    }

    return result;
  }
}
