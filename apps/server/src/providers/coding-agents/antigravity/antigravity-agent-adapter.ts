import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult, CodingAgentAvailability, AgentTranscript } from "../adapter.js";
import { getBridgeStatus, submitToAgent, waitForAgent, AgentTrajectory } from "../../../platform/antigravity-agent.js";
import { isInsideOrEqual } from "../../../workspace/path-safety.js";

const PATH_ARG_KEYS = ["TargetFile", "AbsolutePath", "FilePath", "File", "Path", "DirectoryPath"];
const WRITE_TOOLS = /write|edit|replace|create|delete|move|rename|patch/i;

function summarizeCall(tool: string, args: Record<string, unknown>): string {
  const target = PATH_ARG_KEYS.map((k) => args[k]).find((v) => typeof v === "string") as string | undefined;
  const cmd = typeof args.CommandLine === "string" ? args.CommandLine : undefined;
  const desc = typeof args.toolSummary === "string" ? args.toolSummary : typeof args.Description === "string" ? args.Description : "";
  return [tool, target ?? cmd ?? "", desc ? `— ${desc}` : ""].filter(Boolean).join(" ").slice(0, 300);
}

export function transcriptFrom(t: AgentTrajectory | null, state: AgentTranscript["state"], workspaceRoot: string): AgentTranscript {
  const writesOutside: string[] = [];
  for (const c of t?.toolCalls ?? []) {
    if (!WRITE_TOOLS.test(c.tool)) continue;
    for (const k of PATH_ARG_KEYS) {
      const v = c.args[k];
      if (typeof v === "string" && path.isAbsolute(v) && !isInsideOrEqual(path.resolve(workspaceRoot), path.resolve(v))) writesOutside.push(v);
    }
  }
  return {
    conversationId: t?.conversationId ?? null,
    state,
    finalReply: t?.finalReply ?? "",
    toolCalls: (t?.toolCalls ?? []).map((c) => ({ tool: c.tool, summary: summarizeCall(c.tool, c.args) })),
    writesOutsideWorkspace: [...new Set(writesOutside)],
    prompt: t?.prompt ?? "",
  };
}

/**
 * The native Antigravity Agent as the coding mechanism. Orches never writes project files itself in this
 * mode: it submits the reasoning provider's instruction to the Agent panel of the Antigravity window that
 * has the project folder open, then observes the agent's own conversation record until it goes idle.
 */
export class AntigravityAgentAdapter implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Antigravity Agent";
  public description =
    "The native Antigravity Agent does the coding: Orches sends it the reasoning model's instructions through the Orches Bridge extension and reads back what it did.";
  public usesReasoningProvider = false;

  constructor(private opts: { timeoutMs?: number; quietMs?: number } = {}) {}

  public async detect(): Promise<CodingAgentAvailability> {
    const s = await getBridgeStatus();
    const ready = s.windows.some((w) => w.canSubmit);
    return { available: ready, detail: ready ? `${s.windows.length} Antigravity window(s) reachable through the Orches Bridge.` : s.message };
  }

  public async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const result: AgentExecutionResult = { status: "failed", summary: "", filesWritten: [], filesDeleted: [], rejectedWrites: [], warnings: [] };
    const instruction = input.instruction?.trim();
    if (!instruction) {
      result.error = "No instruction was produced for the Antigravity Agent.";
      return result;
    }
    const status = await getBridgeStatus(input.workspacePath);
    if (!status.matchingWindow?.canSubmit) {
      result.error = status.message;
      return result;
    }

    const marker = `[orches ${input.runId.slice(4, 12)}#${input.attemptNumber}]`;
    const prompt = [
      `${marker} Engineering Brief from Orches Orchestrator (iteration ${input.attemptNumber}).`,
      instruction,
      "",
      "Execution Instructions for Antigravity Agent:",
      `- Work exclusively inside the open workspace folder: ${input.workspacePath}. Do not modify files outside it.`,
      "- Independently inspect existing files and project structure to understand conventions before editing.",
      "- Implement the changes as a cohesive whole using your native coding tools.",
      "- Run the project's tests and checks to verify your work before concluding.",
      "- Do not commit, switch branches, or push. Do not edit .env files or secrets.",
      "- When finished, reply with a concise summary of what you implemented and verified.",
    ].join("\n");

    // Track workspace activity so "idle" means both the conversation and the files have settled.
    let lastActivity = Date.now();
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(input.workspacePath, { recursive: true }, (_e, name) => {
        if (name && !/^(\.git|node_modules)([\\/]|$)/.test(String(name))) lastActivity = Date.now();
      });
    } catch {}

    try {
      input.onLog(`[antigravity] Submitting instruction to the Agent panel (${prompt.length} chars)…`);
      const { submittedAt, windowPid } = await submitToAgent(input.workspacePath, prompt);
      input.onLog(`[antigravity] Submitted to window ${windowPid}; waiting for the agent's conversation ${marker}…`);
      let reported = 0;
      const wait = await waitForAgent({
        marker,
        submittedAt,
        timeoutMs: this.opts.timeoutMs ?? 20 * 60_000,
        quietMs: this.opts.quietMs ?? 10_000,
        signal: input.signal,
        workspaceActivity: () => lastActivity,
        onProgress: (t) => {
          for (const c of t.toolCalls.slice(reported)) input.onLog(`[antigravity] agent: ${summarizeCall(c.tool, c.args)}`);
          reported = t.toolCalls.length;
        },
      });

      let state = wait.state;
      let trajectory = wait.trajectory;
      if (state === "cancelled") {
        // There is no supported way to cancel the agent from outside; wait (bounded) for it to go idle
        // so a rollback does not race with edits still being written.
        input.onLog("[antigravity] Stop requested. The agent cannot be cancelled from Orches; waiting up to 2 minutes for it to go idle (press stop in the Agent panel to end it sooner)…");
        const settle = await waitForAgent({ marker, submittedAt, timeoutMs: Date.now() - submittedAt + 120_000, quietMs: 6000, startTimeoutMs: 1, workspaceActivity: () => lastActivity });
        trajectory = settle.trajectory ?? trajectory;
        if (settle.state !== "finished") result.warnings.push("The Antigravity Agent may still be running; it could change files after Orches rolled them back.");
      }
      result.transcript = transcriptFrom(trajectory, state, input.workspacePath);
      for (const w of result.transcript.writesOutsideWorkspace) result.warnings.push(`Antigravity Agent wrote outside the workspace: ${w}`);
      result.filesWritten = (trajectory?.toolCalls ?? [])
        .filter((c) => WRITE_TOOLS.test(c.tool))
        .map((c) => PATH_ARG_KEYS.map((k) => c.args[k]).find((v) => typeof v === "string") as string | undefined)
        .filter((v): v is string => Boolean(v) && isInsideOrEqual(path.resolve(input.workspacePath), path.resolve(v!)))
        .map((v) => path.relative(input.workspacePath, v).replace(/\\/g, "/"));

      if (state === "finished") {
        result.status = "completed";
        result.summary = trajectory?.finalReply.slice(0, 2000) ?? "";
        input.onLog(`[antigravity] Agent finished: ${result.summary.split("\n")[0].slice(0, 200)}`);
      } else if (state === "not_started") {
        result.error = "The Antigravity Agent did not start a conversation for this instruction within 90 seconds (check the Agent panel in the IDE).";
      } else if (state === "timeout") {
        result.error = "The Antigravity Agent was still working when the time limit was reached; Orches stopped waiting.";
        result.warnings.push("The Antigravity Agent may still be running in the IDE.");
      } else {
        result.error = "cancelled";
      }
      return result;
    } catch (err) {
      result.error = `Could not reach the Antigravity Agent: ${(err as Error).message}`;
      return result;
    } finally {
      watcher?.close();
    }
  }
}
