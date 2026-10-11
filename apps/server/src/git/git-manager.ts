import { spawn } from "node:child_process";

export interface GitStatusResult {
  isGitRepo: boolean;
  baselineCommit: string | null;
  isDirty: boolean;
  modifiedFiles: string[];
}

export class GitManager {
  constructor(private workspacePath: string) {}

  public async getStatus(): Promise<GitStatusResult> {
    try {
      const rev = await this.execGit(["rev-parse", "HEAD"]);
      if (rev.exitCode !== 0) {
        return { isGitRepo: false, baselineCommit: null, isDirty: false, modifiedFiles: [] };
      }
      const baselineCommit = rev.stdout.trim();

      const statusRes = await this.execGit(["status", "--short"]);
      const lines = statusRes.stdout.split("\n").filter((l) => l.trim().length > 0);
      const modifiedFiles = lines.map((l) => l.slice(3).trim());

      return {
        isGitRepo: true,
        baselineCommit,
        isDirty: modifiedFiles.length > 0,
        modifiedFiles,
      };
    } catch {
      return { isGitRepo: false, baselineCommit: null, isDirty: false, modifiedFiles: [] };
    }
  }

  public async createAttemptBranch(projectId: string, taskId: string, attemptNumber: number): Promise<string> {
    const branchName = `orchestrator/${projectId}/${taskId}/attempt-${attemptNumber}`;
    // Create branch from current HEAD
    await this.execGit(["checkout", "-b", branchName]);
    return branchName;
  }

  public async getDiffSummary(): Promise<{ diff: string; filesChanged: string[] }> {
    const diffRes = await this.execGit(["diff", "HEAD"]);
    const statusRes = await this.execGit(["status", "--short"]);
    const lines = statusRes.stdout.split("\n").filter((l) => l.trim().length > 0);
    const filesChanged = lines.map((l) => l.slice(3).trim());

    return {
      diff: diffRes.stdout,
      filesChanged,
    };
  }

  public async commitCheckpoint(taskId: string, message: string, scopedPaths?: string[]): Promise<string> {
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
  }

  public async rollbackAttempt(baselineCommit: string, filesToDiscard?: string[]): Promise<void> {
    // Return cleanly to baseline without destroying untracked pre-existing files
    if (filesToDiscard && filesToDiscard.length > 0) {
      await this.execGit(["checkout", baselineCommit, "--", ...filesToDiscard]);
    } else {
      await this.execGit(["checkout", baselineCommit]);
    }
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
