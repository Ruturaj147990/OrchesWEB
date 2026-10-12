import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FastifyInstance } from "fastify";
import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../src/providers/reasoning/provider.js";
import { buildApp } from "../src/app.js";
import { SettingsManager } from "../src/platform/settings-manager.js";
import { CodingAgentAdapter } from "../src/providers/coding-agents/adapter.js";

export function tempDir(prefix: string): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `orches-${prefix}-`)));
}

export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

export function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

export function initGitRepo(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Orches Test");
  git(dir, "config", "commit.gpgsign", "false");
}

type Responder = (req: ReasoningRequest, signal?: AbortSignal) => string | Promise<string>;

/** A responder that never answers until the request is cancelled (for stop/crash tests). */
export const hangUntilAborted: Responder = (_req, signal) =>
  new Promise<string>((_resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Request cancelled."));
    signal?.addEventListener("abort", () => reject(new Error("Request cancelled.")), { once: true });
  });

/**
 * Deterministic reasoning provider for tests: answers by operation, recording
 * every request so tests can assert what the pipeline sent.
 */
export class ScriptedProvider implements ReasoningProvider {
  public id = "chatgpt-web";
  public displayName = "Scripted test provider";
  public privacyClass = "local" as const;
  public requests: ReasoningRequest[] = [];
  public healthy = true;
  private queues: Partial<Record<string, Responder[]>> = {};

  constructor(private defaults: Partial<Record<string, Responder>> = {}) {}

  public getModel(): string {
    return "scripted-model";
  }

  public enqueue(operation: string, ...responders: Responder[]): this {
    (this.queues[operation] ??= []).push(...responders);
    return this;
  }

  public async healthCheck(): Promise<ProviderHealth> {
    return this.healthy ? { ok: true, status: "ready", message: "scripted" } : { ok: false, status: "server_unreachable", message: "scripted provider offline" };
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (signal?.aborted) throw new Error("Request cancelled.");
    this.requests.push(request);
    const queued = this.queues[request.operation]?.shift();
    const responder = queued ?? this.defaults[request.operation] ?? defaultResponder(request.operation);
    const text = await responder(request, signal);
    let parsed: unknown;
    if (request.json) {
      try {
        parsed = JSON.parse(text);
      } catch {}
    }
    return { text, parsed, providerId: this.id, modelId: this.getModel(), durationMs: 1, warnings: [] };
  }
}

function defaultResponder(operation: string): Responder {
  if (operation === "task_planning") {
    return () => JSON.stringify({ title: "Scripted task", acceptance_criteria: ["The requested change is made"], files_to_read: [] });
  }
  if (operation === "result_review") {
    return () => JSON.stringify({ verdict: "accept", criteria: [{ id: "AC-1", status: "passed", reason: "diff shows it" }], findings: [], repair_instructions: [], summary: "looks right" });
  }
  return () => "";
}

export function fileBlocks(files: Record<string, string>, summary = "scripted change"): string {
  return `${Object.entries(files)
    .map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`)
    .join("\n")}\n<<<SUMMARY>>> ${summary}`;
}

export async function makeApp(opts: { provider?: ReasoningProvider; agent?: (p: ReasoningProvider) => CodingAgentAdapter } = {}): Promise<{ app: FastifyInstance; dataDir: string }> {
  const dataDir = tempDir("data");
  SettingsManager.setDataDir(dataDir);
  const app = await buildApp({
    dbPath: ":memory:",
    serveWeb: false,
    runOverrides: {
      provider: opts.provider ? () => opts.provider! : undefined,
      agent: opts.agent,
    },
  });
  return { app, dataDir };
}

export async function createProject(app: FastifyInstance, rootPath: string, extra: Record<string, unknown> = {}): Promise<{ id: string; rootPath: string }> {
  const res = await app.inject({ method: "POST", url: "/api/v1/projects", payload: { name: path.basename(rootPath), rootPath, ...extra } });
  if (res.statusCode !== 201) throw new Error(`createProject failed: ${res.statusCode} ${res.payload}`);
  return res.json();
}

export async function runTask(app: FastifyInstance, projectId: string, task: string): Promise<any> {
  const res = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/runs`, payload: { task } });
  if (res.statusCode !== 201) throw new Error(`start run failed: ${res.statusCode} ${res.payload}`);
  const run = res.json();
  await app.runManager.waitFor(run.id);
  const detail = await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` });
  return detail.json();
}
