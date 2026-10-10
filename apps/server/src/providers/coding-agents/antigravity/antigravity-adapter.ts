import { spawn } from "node:child_process";
import fs from "node:fs";
import { AgentReport, AgentReportSchema, PrivacyClass, Task } from "@orchestrator/shared-types";
import { CodingAgentAdapter, CodingAgentDetection } from "../adapter.js";
import { config } from "../../../config/env.js";

export class AntigravityAdapter implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Antigravity Official CLI";
  public privacyClass: PrivacyClass = "unknown"; // Defaults to unknown/remote until verified
  private customPath?: string;

  constructor(customPath?: string) {
    this.customPath = customPath || config.agyCliPath;
  }

  public async detectInstallation(): Promise<CodingAgentDetection> {
    const candidatePaths = [
      this.customPath,
      "agy",
      "antigravity",
      process.platform === "win32" ? "agy.cmd" : null,
      process.platform === "win32" ? "antigravity.cmd" : null,
    ].filter(Boolean) as string[];

    for (const exe of candidatePaths) {
      try {
        const probe = await this.runCommand(exe, ["--version"], 4000);
        if (probe.exitCode === 0) {
          // Probe capabilities with --help
          const helpProbe = await this.runCommand(exe, ["--help"], 4000);
          const helpText = helpProbe.stdout;

          const supportsStreamJson = helpText.includes("stream-json");
          const supportsHeadless = helpText.includes("--headless") || helpText.includes("headless");

          return {
            installed: true,
            executablePath: exe,
            version: probe.stdout.trim(),
            message: "Official Antigravity CLI detected and verified.",
            capabilities: {
              headless: supportsHeadless,
              streaming: supportsStreamJson,
              jsonOutput: helpText.includes("json"),
            },
          };
        }
      } catch {
        // Continue checking candidates
      }
    }

    return {
      installed: false,
      message: "Antigravity CLI ('agy') was not found in PATH or configured path. Install from https://www.antigravity.google/docs/cli/overview or configure AGY_CLI_PATH.",
      capabilities: {
        headless: false,
        streaming: false,
        jsonOutput: false,
      },
    };
  }

  public async executeTask(
    task: Task,
    workspacePath: string,
    contextPacket: string,
    signal?: AbortSignal,
    onLog?: (chunk: string) => void
  ): Promise<AgentReport> {
    const detection = await this.detectInstallation();
    if (!detection.installed || !detection.executablePath) {
      throw new Error(`Antigravity execution failed: ${detection.message}`);
    }

    const exe = detection.executablePath;
    const args: string[] = [];

    if (detection.capabilities.headless) {
      args.push("--headless");
    }

    if (detection.capabilities.streaming) {
      args.push("--output-format", "stream-json");
    }

    onLog?.(`[Antigravity CLI] Spawning ${exe} in ${workspacePath} with headless session.\n`);

    return new Promise<AgentReport>((resolve, reject) => {
      // Safe process spawning without shell interpretation
      const child = spawn(exe, args, {
        cwd: workspacePath,
        shell: false,
        env: {
          ...process.env,
          // Never pass cloud API keys or orchestrator secrets
          OPENAI_API_KEY: undefined,
          ANTHROPIC_API_KEY: undefined,
        },
      });

      let stdoutAccum = "";
      let stderrAccum = "";

      child.stdout.on("data", (chunk: Buffer) => {
        const str = chunk.toString();
        stdoutAccum += str;
        onLog?.(str);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const str = chunk.toString();
        stderrAccum += str;
        onLog?.(`[stderr] ${str}`);
      });

      // Write bounded task context through stdin
      if (child.stdin) {
        child.stdin.write(contextPacket);
        child.stdin.end();
      }

      // Handle AbortSignal cancellation
      if (signal) {
        signal.addEventListener("abort", () => {
          onLog?.("[Antigravity CLI] Abort signal received. Terminating process tree...\n");
          try {
            child.kill("SIGTERM");
            setTimeout(() => {
              if (!child.killed) child.kill("SIGKILL");
            }, 2000);
          } catch (err) {
            console.error("Error killing process:", err);
          }
          reject(new Error("Antigravity task execution cancelled"));
        });
      }

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn Antigravity CLI: ${err.message}`));
      });

      child.on("close", (code) => {
        onLog?.(`[Antigravity CLI] Process exited with code ${code}.\n`);

        // Check for soft denial / permission request in output
        if (stderrAccum.includes("permission required") || stdoutAccum.includes("permission_denied")) {
          return resolve(
            AgentReportSchema.parse({
              schema_version: 1,
              task_id: task.id,
              attempt_id: task.currentAttemptId || "attempt-1",
              status: "awaiting_permission",
              summary: "Tool execution requires explicit permission approval.",
              files_changed: [],
              tests: [],
              blockers: ["Awaiting approval for requested operation."],
              questions: [],
              suggestions: [],
              requires_human: true,
              agent_session_id: null,
            })
          );
        }

        // Parse JSON event or final report if present in stdout
        let parsedReport: Partial<AgentReport> | null = null;
        try {
          const lines = stdoutAccum.split("\n").filter((l) => l.trim().length > 0);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const candidate = JSON.parse(lines[i]);
              if (candidate && (candidate.status || candidate.summary)) {
                parsedReport = candidate;
                break;
              }
            } catch {
              // Not a JSON line
            }
          }
        } catch {
          // Fallback to text parsing
        }

        const report = AgentReportSchema.parse({
          schema_version: 1,
          task_id: task.id,
          attempt_id: task.currentAttemptId || "attempt-1",
          status: code === 0 ? "reported_complete" : "reported_failed",
          summary: parsedReport?.summary || stdoutAccum.slice(0, 500) || "CLI execution finished.",
          files_changed: parsedReport?.files_changed || [],
          tests: parsedReport?.tests || [],
          blockers: code === 0 ? [] : [stderrAccum.slice(0, 300) || `Process exited with code ${code}`],
          questions: parsedReport?.questions || [],
          suggestions: parsedReport?.suggestions || [],
          requires_human: false,
          agent_session_id: parsedReport?.agent_session_id || null,
        });

        resolve(report);
      });
    });
  }

  private runCommand(exe: string, args: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      try {
        const child = spawn(exe, args, { shell: false });
        let stdout = "";
        let stderr = "";

        const timer = setTimeout(() => {
          child.kill();
          resolve({ exitCode: -1, stdout, stderr: "Timed out" });
        }, timeoutMs);

        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

        child.on("error", () => {
          clearTimeout(timer);
          resolve({ exitCode: -1, stdout: "", stderr: "Spawn failed" });
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? -1, stdout, stderr });
        });
      } catch {
        resolve({ exitCode: -1, stdout: "", stderr: "Exception" });
      }
    });
  }
}
