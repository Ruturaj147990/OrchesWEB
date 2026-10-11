import { spawn } from "node:child_process";
import { SnapshotManager, SnapshotManifest } from "./snapshot-manager.js";

export interface GitStatusResult {
  isGitRepo: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  activeBranch: string | null;
  baselineCommit: string | null;
  isDirty: boolean;
  modifiedFiles: string[];
  safetyMode: "git" | "local_snapshot";
  snapshotCount?: number;
}

export class GitManager {
  private snapshotManager: SnapshotManager;

  constructor(private workspacePath: string) {
    this.workspacePath = workspacePath || process.cwd();
    this.snapshotManager = new SnapshotManager(this.workspacePath);
  }

  public getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  public async getStatus(): Promise<GitStatusResult> {
    try {
      // 1. Probe if workspace is inside an actual Git repository
      const workTreeRes = await this.execGit(["rev-parse", "--is-inside-work-tree"]);
      if (workTreeRes.exitCode === 0 && workTreeRes.stdout.trim() === "true") {
        // Active Git repository
        let baselineCommit: string | null = null;
        const rev = await this.execGit(["rev-parse", "HEAD"]);
        if (rev.exitCode === 0) {
          baselineCommit = rev.stdout.trim();
        }

        // Active branch
        let activeBranch: string | null = null;
        const branchRes = await this.execGit(["branch", "--show-current"]);
        if (branchRes.exitCode === 0 && branchRes.stdout.trim()) {
          activeBranch = branchRes.stdout.trim();
        } else {
          const abbrevRes = await this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
          if (abbrevRes.exitCode === 0) activeBranch = abbrevRes.stdout.trim();
        }

        // Check for remotes (GitHub, GitLab, etc.)
        let hasRemote = false;
        let remoteUrl: string | null = null;
        const remoteRes = await this.execGit(["remote", "-v"]);
        if (remoteRes.exitCode === 0 && remoteRes.stdout.trim().length > 0) {
          const lines = remoteRes.stdout.split("\n").filter((l) => l.trim().length > 0);
          if (lines.length > 0) {
            hasRemote = true;
            // Parse remote URL from: origin https://github.com/... (fetch)
            const match = lines[0].match(/\s+([^\s]+)\s+\(/);
            remoteUrl = match ? match[1] : lines[0].split(/\s+/)[1] || null;
          }
        }

        // Working tree status
        const statusRes = await this.execGit(["status", "--short"]);
        const lines = statusRes.stdout.split("\n").filter((l) => l.trim().length > 0);
        const modifiedFiles = lines.map((l) => l.slice(3).trim());

        return {
          isGitRepo: true,
          hasRemote,
          remoteUrl,
          activeBranch,
          baselineCommit,
          isDirty: modifiedFiles.length > 0,
          modifiedFiles,
          safetyMode: "git",
        };
      }
    } catch {
      // Git command execution error, gracefully fall back to local snapshot mode
    }

    // 2. Non-Git Directory: Local File Snapshot Safety Active
    try {
      const latestSnapshot = this.snapshotManager.getLatestSnapshot();
      const snapshotList = this.snapshotManager.listSnapshots();

      if (!latestSnapshot) {
        return {
          isGitRepo: false,
          hasRemote: false,
          remoteUrl: null,
          activeBranch: null,
          baselineCommit: null,
          isDirty: false,
          modifiedFiles: [],
          safetyMode: "local_snapshot",
          snapshotCount: 0,
        };
      }

      const diffResult = await this.snapshotManager.computeDiff(latestSnapshot.id);

      return {
        isGitRepo: false,
        hasRemote: false,
        remoteUrl: null,
        activeBranch: null,
        baselineCommit: latestSnapshot.id,
        isDirty: diffResult.filesChanged.length > 0,
        modifiedFiles: diffResult.filesChanged,
        safetyMode: "local_snapshot",
        snapshotCount: snapshotList.length,
      };
    } catch {
      return {
        isGitRepo: false,
        hasRemote: false,
        remoteUrl: null,
        activeBranch: null,
        baselineCommit: null,
        isDirty: false,
        modifiedFiles: [],
        safetyMode: "local_snapshot",
        snapshotCount: 0,
      };
    }
  }

  public async createAttemptBranch(projectId: string, taskId: string, attemptNumber: number): Promise<string> {
    const status = await this.getStatus();
    if (status.isGitRepo) {
      const branchName = `orchestrator/${projectId}/${taskId}/attempt-${attemptNumber}`;
      await this.execGit(["checkout", "-b", branchName]);
      return branchName;
    } else {
      // Local snapshot mode: Capture isolated attempt baseline
      const snap = await this.snapshotManager.takeSnapshot(
        `attempt-${taskId}-${attemptNumber}`,
        `Pre-attempt ${attemptNumber} isolation baseline for task ${taskId}`
      );
      return snap.id;
    }
  }

  public async getDiffSummary(): Promise<{ diff: string; filesChanged: string[] }> {
    const status = await this.getStatus();
    if (status.isGitRepo) {
      const diffRes = await this.execGit(["diff", "HEAD"]);
      const statusRes = await this.execGit(["status", "--short"]);
      const lines = statusRes.stdout.split("\n").filter((l) => l.trim().length > 0);
      const filesChanged = lines.map((l) => l.slice(3).trim());

      return {
        diff: diffRes.stdout,
        filesChanged,
      };
    } else {
      // Local snapshot mode: Compute real file differences and diff text
      const diffResult = await this.snapshotManager.computeDiff();
      return {
        diff: diffResult.diff,
        filesChanged: diffResult.filesChanged,
      };
    }
  }

  public async commitCheckpoint(taskId: string, message: string, scopedPaths?: string[]): Promise<string> {
    const status = await this.getStatus();
    if (status.isGitRepo) {
      if (scopedPaths && scopedPaths.length > 0) {
        await this.execGit(["add", "--", ...scopedPaths]);
      } else {
        await this.execGit(["add", "-A"]);
      }
      const commitMsg = `chore(orchestrator): checkpoint task ${taskId} — ${message}`;
      const commitRes = await this.execGit(["commit", "-m", commitMsg]);
      if (commitRes.exitCode !== 0 && !commitRes.stdout.includes("nothing to commit")) {
        throw new Error(`Git commit failed: ${commitRes.stderr || commitRes.stdout}`);
      }

      const rev = await this.execGit(["rev-parse", "HEAD"]);
      return rev.stdout.trim();
    } else {
      // Local snapshot mode: Record durable safety checkpoint
      const snap = await this.snapshotManager.takeSnapshot(
        `checkpoint-${taskId}`,
        `Checkpoint task ${taskId} — ${message}`
      );
      return snap.id;
    }
  }

  public async rollbackAttempt(baselineCommitOrSnapshotId: string, filesToDiscard?: string[]): Promise<void> {
    const status = await this.getStatus();
    if (status.isGitRepo) {
      if (filesToDiscard && filesToDiscard.length > 0) {
        await this.execGit(["checkout", baselineCommitOrSnapshotId, "--", ...filesToDiscard]);
      } else {
        await this.execGit(["checkout", baselineCommitOrSnapshotId]);
      }
    } else {
      // Local snapshot mode: Restore baseline snapshot cleanly without touching unrelated user files
      await this.snapshotManager.rollback(baselineCommitOrSnapshotId, filesToDiscard);
    }
  }

  /**
   * Initializes a local Git repository strictly with explicit user consent.
   * Never configures a remote or attempts any network push.
   */
  public async initRepo(): Promise<{ success: boolean; message: string }> {
    const initRes = await this.execGit(["init"]);
    if (initRes.exitCode !== 0) {
      throw new Error(`Git init failed: ${initRes.stderr || initRes.stdout}`);
    }

    // Create initial commit if files exist so repository has a valid HEAD
    const statusRes = await this.execGit(["status", "--short"]);
    if (statusRes.stdout.trim().length > 0) {
      await this.execGit(["add", "-A"]);
      await this.execGit(["commit", "-m", "chore: initial commit by orchestrator with explicit user consent"]);
    }

    return {
      success: true,
      message: "Local Git repository initialized successfully. Remote connection is not configured.",
    };
  }

  private execGit(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn("git", args, { cwd: this.workspacePath, shell: false });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      child.on("close", (code) => {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });

      child.on("error", (err) => {
        resolve({ exitCode: -1, stdout: "", stderr: err.message });
      });
    });
  }
}
