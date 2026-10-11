import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { AgentReport, AgentReportSchema, PrivacyClass, Task } from "@orchestrator/shared-types";
import { CodingAgentAdapter, CodingAgentDetection } from "../adapter.js";
import { ReasoningProvider } from "../../reasoning/provider.js";
import { extractJsonFromText } from "../../../prompts/json-extractor.js";

export class ReasoningCodingAgentAdapter implements CodingAgentAdapter {
  public id = "reasoning-coding-agent";
  public displayName = "Autonomous Reasoning Coding Engine (Direct)";
  public privacyClass: PrivacyClass = "local";

  constructor(private provider: ReasoningProvider) {
    this.privacyClass = provider.privacyClass;
  }

  public setProvider(provider: ReasoningProvider): void {
    this.provider = provider;
    this.privacyClass = provider.privacyClass;
  }

  public async detectInstallation(): Promise<CodingAgentDetection> {
    return {
      installed: true,
      executablePath: "internal://reasoning-engine",
      version: `Autonomous Reasoning Coder (${this.provider.displayName})`,
      message: `Active reasoning provider '${this.provider.displayName}' configured for direct autonomous code execution.`,
      capabilities: {
        headless: true,
        streaming: true,
        jsonOutput: true,
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
    onLog?.(`[Autonomous Coder] Starting task execution: "${task.title}" (Attempt ${task.attemptCount})\n`);
    onLog?.(`[Autonomous Coder] Target workspace: ${workspacePath}\n`);
    onLog?.(`[Autonomous Coder] Active engine: ${this.provider.displayName} (${this.provider.id})\n`);

    if (signal?.aborted) {
      throw new Error("Task execution cancelled before starting.");
    }

    // Read existing file structure if workspace exists
    const existingFileList: string[] = [];
    try {
      if (fs.existsSync(workspacePath)) {
        const scanDir = (dir: string, base = "") => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".orchestrator") continue;
            const rel = path.join(base, ent.name);
            if (ent.isDirectory()) {
              scanDir(path.join(dir, ent.name), rel);
            } else {
              existingFileList.push(rel.replace(/\\/g, "/"));
            }
          }
        };
        scanDir(workspacePath);
      }
    } catch {}

    const prompt = `
You are an expert autonomous software engineer coding directly inside a target project.
PROJECT DIRECTORY: ${workspacePath}
TASK TITLE: ${task.title}
TASK OBJECTIVE: ${task.objective}
ACCEPTANCE CRITERIA:
${task.acceptanceCriteria.map((c) => `- [${c.id}] ${c.description} (verification: ${c.verification})`).join("\n")}
VERIFICATION PLAN: ${task.verificationPlan.join(", ")}
ALLOWED PATHS: ${task.allowedPaths.join(", ")}
EXISTING PROJECT FILES: ${existingFileList.length > 0 ? existingFileList.join(", ") : "Empty workspace (fresh project)"}

INSTRUCTIONS:
1. Implement all source code files, tests, package manifests, and README required to satisfy the objective.
2. Produce clean, robust, working code with zero placeholders or incomplete stubs.
3. If unit tests are required, use built-in node:test (e.g. test.js). Always import test functions explicitly:
   const { test } = require('node:test');
   const assert = require('node:assert');
   test('greets properly', () => { assert.strictEqual(typeof greeting, 'function'); });
4. Ensure modules export their functions cleanly with module.exports (e.g. module.exports = { greeting };) and import them cleanly.
5. In package.json, define "scripts": { "test": "node --test" }. Do not reference missing scripts like "lint".
6. Every path in the "files" array MUST be an exact concrete filename (e.g. "greeting.js", "index.js", "test.js", "package.json", "README.md"). NEVER use glob wildcards (*, ?) in paths.
7. Output MUST be valid JSON matching this schema:
{
  "summary": "Concise summary of implementation",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "Full file content"
    }
  ]
}
Do not use markdown code block wrappers. Output valid parseable JSON only.
`.trim();

    onLog?.(`[Autonomous Coder] Prompting reasoning engine to generate code...\n`);

    const result = await this.provider.generate(
      {
        operation: "task_planning",
        systemInstruction: "You are an autonomous software developer that outputs JSON containing file modifications.",
        messages: [
          { role: "system", content: contextPacket },
          { role: "user", content: prompt },
        ],
        dataClassification: "internal",
        projectId: task.projectId,
        taskId: task.id,
        responseSchema: { type: "object" },
      },
      signal
    );

    let parsedOutput: any = null;

    if (result.parsed && typeof result.parsed === "object") {
      parsedOutput = result.parsed;
    } else if (result.text) {
      parsedOutput = extractJsonFromText(result.text);
    }

    onLog?.(`[Autonomous Coder] Raw model response length: ${result.text?.length ?? 0} chars\n`);

    const modifiedFiles: string[] = [];
    let fileEntries: Array<{ path: string; content: string }> = [];

    if (parsedOutput) {
      if (Array.isArray(parsedOutput.files)) {
        fileEntries = parsedOutput.files;
      } else if (Array.isArray(parsedOutput.Files)) {
        fileEntries = parsedOutput.Files;
      } else if (Array.isArray(parsedOutput)) {
        fileEntries = parsedOutput;
      }
    }

    if (fileEntries.length > 0) {
      for (const item of fileEntries) {
        if (!item.path || typeof item.content !== "string") continue;

        // Clean and sanitize path: remove any glob wildcards (*, ?)
        let rawPath = item.path.trim().replace(/[*?<>|":]/g, "");
        if (rawPath.startsWith(".")) {
          if (rawPath.endsWith(".test.js")) rawPath = "test.js";
          else if (rawPath.endsWith(".js")) rawPath = "index.js";
        }
        if (!rawPath || rawPath === "/" || rawPath === "\\") continue;

        // Security check: path traversal and boundary protection
        const normalizedRel = path.normalize(rawPath).replace(/^(\.\.[\/\\])+/, "");
        if (
          normalizedRel.startsWith(".env") ||
          normalizedRel.startsWith(".orchestrator") ||
          normalizedRel.startsWith(".git")
        ) {
          onLog?.(`[Autonomous Coder] Skipping restricted path: ${item.path}\n`);
          continue;
        }

        const fullPath = path.resolve(workspacePath, normalizedRel);
        if (!fullPath.startsWith(path.resolve(workspacePath))) {
          onLog?.(`[Autonomous Coder] Skipping path outside workspace: ${item.path}\n`);
          continue;
        }

        try {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(fullPath, item.content, "utf8");
          const relPosix = normalizedRel.replace(/\\/g, "/");
          modifiedFiles.push(relPosix);
          onLog?.(`[Autonomous Coder] Wrote ${relPosix} (${item.content.length} bytes)\n`);
        } catch (err: any) {
          onLog?.(`[Autonomous Coder] Error writing ${item.path}: ${err.message}\n`);
        }
      }
    } else {
      onLog?.(`[Autonomous Coder] Warning: Reasoning engine produced 0 file modifications.\n`);
    }

    // Run verification commands locally
    const testClaims: Array<{ command: string; agent_claim: "passed" | "failed" | "inconclusive" }> = [];
    for (const cmd of task.verificationPlan) {
      onLog?.(`[Autonomous Coder] Running verification command: ${cmd}\n`);
      const testResult = await this.executeCommand(cmd, workspacePath, signal);
      onLog?.(testResult.output);
      testClaims.push({
        command: cmd,
        agent_claim: testResult.exitCode === 0 ? "passed" : "failed",
      });
    }

    const report = AgentReportSchema.parse({
      schema_version: 1,
      task_id: task.id,
      attempt_id: task.currentAttemptId || `att-${task.id}-1`,
      status: modifiedFiles.length > 0 ? "reported_complete" : "reported_failed",
      summary: parsedOutput?.summary || `Autonomous reasoning engine modified ${modifiedFiles.length} file(s).`,
      files_changed: modifiedFiles,
      tests: testClaims,
      blockers: modifiedFiles.length === 0 ? ["No file modifications produced by model"] : [],
      questions: [],
      suggestions: [],
      requires_human: false,
      agent_session_id: `reasoning-sess-${task.id}`,
    });

    onLog?.(`[Autonomous Coder] Task dispatch complete. Modified files: [${modifiedFiles.join(", ")}]\n`);
    return report;
  }

  private executeCommand(
    commandStr: string,
    cwd: string,
    signal?: AbortSignal
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const parts = commandStr.trim().split(/\s+/);
      const exe = parts[0];
      const args = parts.slice(1);

      const isWin = process.platform === "win32";
      const child = spawn(exe, args, {
        cwd,
        shell: isWin,
        env: { ...process.env, NODE_ENV: "test" },
      });

      let output = "";
      child.stdout?.on("data", (b: Buffer) => {
        output += b.toString();
      });
      child.stderr?.on("data", (b: Buffer) => {
        output += b.toString();
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          child.kill("SIGTERM");
        });
      }

      child.on("error", (err) => {
        resolve({ exitCode: 1, output: `Execution error: ${err.message}\n` });
      });

      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, output });
      });
    });
  }
}
