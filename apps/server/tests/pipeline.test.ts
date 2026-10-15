// End-to-end run pipeline with a scripted reasoning model and a fake coding agent (no browser, no IDE).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "orches-pipeline-test-"));
process.env.ORCHESTRATOR_DATA_DIR = path.join(base, "data");
const { buildApp } = await import("../src/app.js");
const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");

after(() => fs.rmSync(base, { recursive: true, force: true }));

type Script = Record<string, (req: any) => string>;

function scriptedProvider(script: Script, calls: string[]) {
  return {
    id: "scripted",
    displayName: "Scripted GPT",
    privacyClass: "local" as const,
    getModel: () => "scripted",
    getContextWindow: () => 128_000,
    healthCheck: async () => ({ ok: true, message: "ok" }),
    generate: async (req: any) => {
      const key = req.operationId || req.operation;
      calls.push(key);
      const text = (script[key] ?? script[req.operation] ?? (() => "{}"))(req);
      // Mirror the ChatGPT provider: stop/refusal replies carry the offered alternative in `parsed`.
      const ex = ResponseReader.extractInstruction(text, { allowLegacyJson: false });
      const parsed =
        req.operation === "result_review"
          ? text.trim().startsWith("{") ? JSON.parse(text) : undefined
          : ex.action === "stop"
            ? { action: "stop", stop_reason: ex.stopReason, rationale: ex.rationale, alternative_offered: ex.alternativeOffered ?? null }
            : undefined;
      return { text, parsed, providerId: "scripted", modelId: "scripted", durationMs: 1, warnings: [] };
    },
  };
}

type Step = (input: any) => Promise<any>;
const writes = (file: string): Step => async (input) => {
  fs.writeFileSync(path.join(input.workspacePath, file), "module.exports = 1;\n");
  return { status: "completed", summary: "done", filesWritten: [file], filesDeleted: [], rejectedWrites: [], warnings: [], transcript: { conversationId: "c", state: "finished", finalReply: `Implemented ${file}; all checks verified and passing.`, toolCalls: [], writesOutsideWorkspace: [], prompt: input.instruction } };
};
const fails = (errorKind: string, error: string): Step => async () => ({ status: "failed", summary: "", filesWritten: [], filesDeleted: [], rejectedWrites: [], warnings: [], errorKind, error });
const slow = (file: string, ms: number): Step => async (input) => {
  fs.writeFileSync(path.join(input.workspacePath, file), "module.exports = 2;\n");
  await new Promise((r) => setTimeout(r, ms));
  return writes(`${file}.done.js`)(input);
};

const BRIEF = (label: string) =>
  `ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Implementation Mission\n\n## Scope\n${label}. Build a module with a pure function schedule(tasks) that orders tasks by priority. Add tests and run them to verify.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
const REPAIR = JSON.stringify({ verdict: "repair", criteria: [{ id: "AC-1", status: "failed", reason: "missing tests" }], findings: [], repair_instructions: ["add tests"], summary: "needs tests" });
const ACCEPT = JSON.stringify({ verdict: "accept", criteria: [{ id: "AC-1", status: "passed", reason: "done" }], findings: [], repair_instructions: [], summary: "all good" });
const REFUSAL_WITH_ALT = () => "I can’t help build operational electronic-warfare software. However, I can help you build a simulator that schedules synthetic emitter tasks for training.";

async function runScenario(name: string, script: Script, steps: Step[], opts: { maxAttempts?: number; stopAfterMs?: number } = {}) {
  const calls: string[] = [];
  const instructions: string[] = [];
  let i = 0;
  const ws = fs.mkdtempSync(path.join(base, `${name}-`));
  fs.writeFileSync(path.join(ws, "README.md"), "# demo\n");
  const agent = {
    id: "fake",
    displayName: "Fake Agent",
    description: "test double",
    usesReasoningProvider: false,
    detect: async () => ({ available: true, detail: "fake" }),
    execute: async (input: any) => {
      instructions.push(input.instruction ?? "");
      return steps[Math.min(i++, steps.length - 1)](input);
    },
  };
  const app = await buildApp({
    dbPath: path.join(base, `${name}.sqlite`),
    serveWeb: false,
    runOverrides: { provider: () => scriptedProvider(script, calls) as any, agent: () => agent as any, waitScale: 0.001 },
  });
  try {
    const headers = { host: "127.0.0.1" };
    const project = (await app.inject({ method: "POST", url: "/api/v1/projects", headers, payload: { name, rootPath: ws, autoCommit: false } })).json();
    const run = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, headers, payload: { task: "Build the scheduler module", maxAttempts: opts.maxAttempts ?? 3 } })).json();
    if (opts.stopAfterMs) setTimeout(() => app.runManager.stop(run.id), opts.stopAfterMs);
    await app.runManager.waitFor(run.id);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}`, headers })).json();
    return { run: detail.run, files: fs.readdirSync(ws).sort(), calls, instructions };
  } finally {
    await app.close();
  }
}

test("refusal with an alternative: only the alternative brief reaches the agent", async () => {
  const r = await runScenario("refusal-alt", {
    code_generation: REFUSAL_WITH_ALT,
    code_generation_offered_alternative: () => BRIEF("Synthetic simulator only"),
    result_review: () => REPAIR,
  }, [writes("sim.js")], { maxAttempts: 1 });
  assert.ok(r.calls.includes("code_generation_offered_alternative"));
  assert.match(r.instructions[0], /Synthetic simulator only/);
  assert.doesNotMatch(r.instructions[0], /can’t help/);
});

test("plain refusal stops as 'declined' and sends nothing to the agent", async () => {
  const r = await runScenario("refusal", { code_generation: () => "I’m sorry, but I can’t help with that request." }, [writes("never.js")]);
  assert.equal(r.run.status, "stopped");
  assert.equal(r.run.outcome, "declined");
  assert.equal(r.instructions.length, 0);
});

test("quota exhaustion re-sends the same instruction without using an iteration", async () => {
  const r = await runScenario("quota", { code_generation: () => BRIEF("Normal task"), result_review: () => REPAIR }, [
    fails("quota", "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 0m1s."),
    writes("a.js"),
  ], { maxAttempts: 1 });
  assert.equal(r.instructions.length, 2);
  assert.equal(r.instructions[0], r.instructions[1]);
  assert.ok(r.files.includes("a.js"));
  assert.notEqual(r.run.status, "blocked");
});

test("agent errors are retried, never block the run", async () => {
  const r = await runScenario("agent-error", { code_generation: () => BRIEF("Normal task"), result_review: () => REPAIR }, [
    fails("agent_error", "model provider internal error"),
    fails("agent_error", "model provider internal error"),
    writes("a.js"),
  ], { maxAttempts: 1 });
  assert.equal(r.instructions.length, 3);
  assert.ok(r.files.includes("a.js"));
});

test("an unusable review is not acceptance (no audit stage)", async () => {
  const r = await runScenario("bad-review", { code_generation: () => BRIEF("Normal task"), result_review: () => "Looks fine to me overall." }, [writes("a.js")], { maxAttempts: 1 });
  assert.equal(r.run.outcome, "unverified");
  assert.match(r.run.summary, /did not produce a usable verdict/);
});

test("accept, then audit accept, completes as verified", async () => {
  const r = await runScenario("accept", { code_generation: () => BRIEF("Normal task"), repair_diagnosis: () => BRIEF("Audit the system"), result_review: () => ACCEPT }, [writes("a.js"), writes("audit-notes.md")], { maxAttempts: 3 });
  assert.equal(r.run.status, "completed");
  assert.equal(r.run.outcome, "verified");
});

test("Stop keeps every file (no rollback)", async () => {
  const r = await runScenario("stop", { code_generation: () => BRIEF("Normal task"), result_review: () => REPAIR, repair_diagnosis: () => BRIEF("Second pass") }, [writes("one.js"), slow("two.js", 1500)], { stopAfterMs: 700 });
  assert.equal(r.run.status, "stopped");
  assert.ok(r.files.includes("one.js") && r.files.includes("two.js"));
});

test("reaching the iteration limit keeps every file and reports unverified", async () => {
  const r = await runScenario("limit", { code_generation: () => BRIEF("Normal task"), result_review: () => REPAIR, repair_diagnosis: () => BRIEF("Repair") }, [writes("a.js"), writes("b.js")], { maxAttempts: 2 });
  assert.equal(r.run.outcome, "unverified");
  assert.ok(r.files.includes("a.js") && r.files.includes("b.js"));
});
