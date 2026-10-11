import { runCommand } from "../platform/process-runner.js";

export interface GitStatusResult {
  isGitRepo: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  activeBranch: string | null;
  headCommit: string | null;
  isDirty: boolean;
  /** Paths with uncommitted changes (tracked or untracked), relative to the repository root. */
  dirtyFiles: string[];
  /** "git" when the workspace is a Git work tree, otherwise orchestrator snapshots are the only safety net. */
  safetyMode: "git" | "local_snapshot";
}

export interface CommitResult {
  committed: boolean;
  commitSha: string | null;
  message: string;
}

/**
 * Read-mostly Git helper. It never switches branches, resets, or cleans; the
 * only mutating operations are `commitPaths` (scoped to accepted files) and
 * `initRepo` (explicit user request).
 */
export class GitManager {
  constructor(private workspacePath: string) {}

  private git(args: string[], timeoutMs = 30_000) {
    return runCommand(["git", ...args], {
      cwd: this.workspacePath,
      timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
  }

  public async getStatus(): Promise<GitStatusResult> {
    const notGit: GitStatusResult = {
      isGitRepo: false,
      hasRemote: false,
      remoteUrl: null,
      activeBranch: null,
      headCommit: null,
      isDirty: false,
      dirtyFiles: [],
      safetyMode: "local_snapshot",
    };
    const inside = await this.git(["rev-parse", "--is-inside-work-tree"]);
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return notGit;

    const head = await this.git(["rev-parse", "--verify", "-q", "HEAD"]);
    const branch = await this.git(["branch", "--show-current"]);
    const remotes = await this.git(["remote", "-v"]);
    const firstRemote = remotes.stdout.split("\n").find((l) => l.trim().length > 0);
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const dirtyFiles = parsePorcelainZ(status.stdout);

    return {
      isGitRepo: true,
      hasRemote: Boolean(firstRemote),
      remoteUrl: firstRemote ? firstRemote.split(/\s+/)[1] ?? null : null,
      activeBranch: branch.stdout.trim() || null,
      headCommit: head.exitCode === 0 ? head.stdout.trim() : null,
      isDirty: dirtyFiles.length > 0,
      dirtyFiles,
      safetyMode: "git",
    };
  }

  /** `git diff` against HEAD for display; falls back to an empty string. */
  public async diffHead(): Promise<string> {
    const res = await this.git(["diff", "HEAD"]);
    return res.exitCode === 0 ? res.stdout : "";
  }

  /**
   * Commit exactly the given paths on the current branch. Other staged or
   * unstaged user changes are left untouched (`--only`).
   */
  public async commitPaths(paths: string[], message: string): Promise<CommitResult> {
    if (paths.length === 0) return { committed: false, commitSha: null, message: "No paths to commit." };
    const add = await this.git(["add", "-A", "--", ...paths]);
    if (add.exitCode !== 0) {
      return { committed: false, commitSha: null, message: `git add failed: ${(add.stderr || add.stdout).trim()}` };
    }
    const commit = await this.git(["commit", "-m", message, "--only", "--", ...paths], 120_000);
    if (commit.exitCode !== 0) {
      const detail = (commit.stderr || commit.stdout).trim();
      return { committed: false, commitSha: null, message: `git commit failed: ${detail}` };
    }
    const head = await this.git(["rev-parse", "HEAD"]);
    return { committed: true, commitSha: head.stdout.trim(), message: "Committed accepted changes." };
  }

  /** Initialize a local repository (explicit user action only). Never adds a remote or pushes. */
  public async initRepo(): Promise<{ success: boolean; message: string }> {
    const init = await this.git(["init"]);
    if (init.exitCode !== 0) {
      throw new Error(`git init failed: ${(init.stderr || init.stdout).trim()}`);
    }
    return { success: true, message: "Local Git repository initialized. No remote was configured and nothing was committed." };
  }
}

/** Parse `git status --porcelain=v1 -z` output into a list of paths. */
export function parsePorcelainZ(out: string): string[] {
  const files: string[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    files.push(entry.slice(3));
    // Renames and copies are followed by the original path as a separate field.
    if (xy[0] === "R" || xy[0] === "C") i++;
  }
  return files;
}
