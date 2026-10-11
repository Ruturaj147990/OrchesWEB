import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { VerificationCheckType, VerificationResult } from "@orchestrator/shared-types";

export interface CheckCommand {
  type: VerificationCheckType;
  command: string;
  timeoutMs?: number;
}

export class VerificationRunner {
  constructor(private workspacePath: string) {}

  public async runAll(
    taskId: string,
    attemptId: string,
    commands: CheckCommand[]
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const cmd of commands) {
      const res = await this.executeCheck(taskId, attemptId, cmd);
      results.push(res);
    }

    return results;
  }

  public executeCheck(
    taskId: string,
    attemptId: string,
    check: CheckCommand
  ): Promise<VerificationResult> {
    const start = Date.now();
    const timeoutMs = check.timeoutMs || 30000;

    // Parse command string into executable and argument array safely
    const parts = check.command.trim().split(/\s+/);
    let exe = parts[0];
    const args = parts.slice(1);

    // On Windows, resolve npm / npx to npm.cmd / npx.cmd if needed
    if (process.platform === "win32") {
      if (exe === "npm" || exe === "npx") {
        exe = `${exe}.cmd`;
      }
    }

    return new Promise<VerificationResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(exe, args, {
          cwd: this.workspacePath,
          shell: process.platform === "win32",
          env: {
            ...process.env,
            CI: "true",
          },
        });
      } catch (err: unknown) {
        return resolve({
          id: `vr-${crypto.randomUUID()}`,
          taskId,
          attemptId,
          checkType: check.type,
          command: check.command,
          argv: parts,
          cwd: this.workspacePath,
          status: "failed",
          exitCode: 1,
          durationMs: Date.now() - start,
          outputArtifactId: null,
          stdoutSnippet: "",
          stderrSnippet: (err as Error).message || "Spawn failed",
          truncated: false,
          timestamp: new Date().toISOString(),
        });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });

      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          id: `vr-${crypto.randomUUID()}`,
          taskId,
          attemptId,
          checkType: check.type,
          command: check.command,
          argv: [exe, ...args],
          cwd: this.workspacePath,
          status: "failed",
          exitCode: -1,
          durationMs: Date.now() - start,
          outputArtifactId: null,
          stdoutSnippet: "",
          stderrSnippet: `Process spawn error: ${err.message}`,
          truncated: false,
          timestamp: new Date().toISOString(),
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const status = timedOut ? "timeout" : code === 0 ? "passed" : "failed";

        const maxSnippetLen = 4000;
        const stdoutSnippet = stdout.slice(-maxSnippetLen);
        const stderrSnippet = stderr.slice(-maxSnippetLen);

        resolve({
          id: `vr-${crypto.randomUUID()}`,
          taskId,
          attemptId,
          checkType: check.type,
          command: check.command,
          argv: [exe, ...args],
          cwd: this.workspacePath,
          status,
          exitCode: code ?? -1,
          durationMs,
          outputArtifactId: null,
          stdoutSnippet,
          stderrSnippet,
          truncated: stdout.length > maxSnippetLen || stderr.length > maxSnippetLen,
          timestamp: new Date().toISOString(),
        });
      });
    });
  }
}
