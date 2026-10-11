import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { BuiltinCoderAdapter } from "../src/providers/coding-agents/builtin/builtin-coder.js";
import { RunManager } from "../src/orchestrator/run-manager.js";
import { EventStore } from "../src/events/event-store.js";
import { getDb } from "../src/storage/db.js";
import { ORCHESTRATOR_ROOT } from "../src/config/env.js";
import { findPython } from "../src/workspace/project-inspector.js";
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir, fileBlocks, initGitRepo, git, hangUntilAborted } from "./helpers.js";

const NODE_TEST_PKG = JSON.stringify({ name: "demo", version: "1.0.0", scripts: { test: "node --test" } }, null, 2);
const GOOD_MATH = "function add(a, b) { return a + b; }\nmodule.exports = { add };\n";
const MATH_TEST = "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('./math.js');\ntest('add', () => assert.equal(add(2, 3), 5));\n";

describe("run pipeline (real coder, scripted model)", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const provider = new ScriptedProvider();
  const workspaces: string[] = [];

  beforeAll(async () => {
    ({ app, dataDir } = await makeApp({ provider, agent: (p) => new BuiltinCoderAdapter(p) }));
  });
  afterAll(async () => {
    await app.close();
    workspaces.forEach(removeDir);
    removeDir(dataDir);
  });
  afterEach(() => {
    provider.requests = [];
    provider.healthy = true;
  });

  const workspace = (prefix: string) => {
    const ws = tempDir(prefix);
    workspaces.push(ws);
    return ws;
  };

  it("creates a project from an empty folder, runs the user's task and verifies it with the project's own tests", async () => {
    const ws = workspace("empty");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => fileBlocks({ "package.json": NODE_TEST_PKG, "math.js": GOOD_MATH, "math.test.js": MATH_TEST }));

    const detail = await runTask(app, project.id, "Create math.js with add(a, b) and node:test tests");
    expect(detail.run).toMatchObject({ status: "completed", outcome: "verified", providerId: "openai-compatible-local", modelId: "scripted-model", agentId: "builtin" });
    expect(fs.readFileSync(path.join(ws, "math.js"), "utf8")).toBe(GOOD_MATH);
    const checks = detail.attempts[0].checks.map((c: any) => `${c.phase}:${c.label}:${c.status}`);
    expect(checks).toContain("attempt:npm test:passed");
    // The user's task text reached the model.
    const codeReq = provider.requests.find((r) => r.operation === "code_generation")!;
    expect(codeReq.messages[0].content).toContain("Create math.js with add(a, b)");
    expect(codeReq.messages[0].content).toContain("TOOLCHAIN NOTES");
    // Orchestrator metadata never lands in the workspace.
    expect(fs.existsSync(path.join(ws, ".orchestrator"))).toBe(false);
  }, 60_000);

  it("relativizes absolute model paths and blocks traversal without creating nested drive folders", async () => {
    const ws = workspace("paths");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () =>
      fileBlocks({ [path.join(ws, "docs", "notes.md")]: "# Notes\n", "../escape.txt": "nope\n", ".env": "SECRET=1\n" })
    );
    const detail = await runTask(app, project.id, "Write docs/notes.md");
    expect(fs.readFileSync(path.join(ws, "docs", "notes.md"), "utf8")).toBe("# Notes\n");
    expect(fs.existsSync(path.join(path.dirname(ws), "escape.txt"))).toBe(false);
    expect(fs.existsSync(path.join(ws, ".env"))).toBe(false);
    expect(fs.readdirSync(ws).sort()).toEqual(["docs"]);
    expect(detail.run.outcome).toBe("unverified"); // no automated checks exist for a docs-only folder
    expect(detail.attempts[0].gate.warnings.join(" ")).toMatch(/Blocked an unsafe write to '\.\.\/escape\.txt'/);
  }, 60_000);

  it("repairs a failing attempt in place using the real failure output", async () => {
    const ws = workspace("repair");
    const project = await createProject(app, ws);
    const broken = "const { test } = require('node:test');\nconst { add } = require('./math.js');\ntest('add', () => expect(add(2, 3)).toBe(5));\n";
    provider.enqueue(
      "code_generation",
      () => fileBlocks({ "package.json": NODE_TEST_PKG, "math.js": GOOD_MATH, "math.test.js": broken }),
      () => fileBlocks({ "math.test.js": MATH_TEST })
    );
    const detail = await runTask(app, project.id, "Create math.js with add and tests");
    expect(detail.run).toMatchObject({ status: "completed", outcome: "verified" });
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[0].gate.accepted).toBe(false);
    const repairPrompt = provider.requests.filter((r) => r.operation === "code_generation")[1].messages[0].content;
    expect(repairPrompt).toContain("KEY ERROR");
    expect(repairPrompt).toMatch(/expect is not defined/);
    expect(repairPrompt).toContain("<<<FILE math.test.js>>>"); // sees its previous file to fix it
  }, 60_000);

  it("rolls back every change — including edits to existing user files — when all attempts are rejected", async () => {
    const ws = workspace("reject");
    fs.writeFileSync(path.join(ws, "package.json"), NODE_TEST_PKG);
    fs.writeFileSync(path.join(ws, "math.js"), GOOD_MATH);
    fs.writeFileSync(path.join(ws, "math.test.js"), MATH_TEST);
    const project = await createProject(app, ws);
    const bad = () => fileBlocks({ "math.js": "function add(a, b) { return a - b; }\nmodule.exports = { add };\n", "extra/new.js": "module.exports = 1;\n" });
    provider.enqueue("code_generation", bad, bad, bad);

    const detail = await runTask(app, project.id, "Refactor add");
    expect(detail.run).toMatchObject({ status: "failed", outcome: "rejected" });
    expect(detail.run.summary).toMatch(/rolled back/);
    expect(fs.readFileSync(path.join(ws, "math.js"), "utf8")).toBe(GOOD_MATH);
    expect(fs.existsSync(path.join(ws, "extra"))).toBe(false);
    expect(detail.attempts[0].gate.blockers.join(" ")).toMatch(/regression/);
    expect(detail.details.rollback.failed).toEqual([]);
  }, 90_000);

  it("rejects malformed files before running checks", async () => {
    const ws = workspace("static");
    const project = await createProject(app, ws);
    const broken = () => fileBlocks({ "config.json": "{ not json", "app.js": "function (" });
    provider.enqueue("code_generation", broken, broken, broken);
    const detail = await runTask(app, project.id, "Add config");
    expect(detail.run.outcome).toBe("rejected");
    const blockers = detail.attempts[0].gate.blockers.join(" ");
    expect(blockers).toMatch(/invalid JSON/);
    expect(blockers).toMatch(/JavaScript syntax error/);
    expect(fs.readdirSync(ws)).toEqual([]);
  }, 60_000);

  it("in a clean Git repo: never switches branches, commits only the accepted files on the current branch", async () => {
    const ws = workspace("git");
    initGitRepo(ws);
    fs.writeFileSync(path.join(ws, "README.md"), "# Demo\n");
    git(ws, "add", "-A");
    git(ws, "commit", "-q", "-m", "init");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => fileBlocks({ "README.md": "# Demo\n\nUsage: run it.\n" }));

    const detail = await runTask(app, project.id, "Add a usage line to the README");
    expect(detail.run.outcome).toBe("unverified");
    expect(git(ws, "branch", "--show-current")).toBe("main");
    expect(git(ws, "branch", "--list").split("\n")).toHaveLength(1);
    expect(git(ws, "log", "-1", "--format=%s")).toBe("orches: Scripted task");
    expect(git(ws, "show", "--name-only", "--format=", "HEAD")).toBe("README.md");
    expect(git(ws, "status", "--porcelain")).toBe("");
    expect(detail.run.commitSha).toBe(git(ws, "rev-parse", "HEAD"));
  }, 60_000);

  it("in a dirty Git repo: preserves the user's uncommitted work and does not auto-commit", async () => {
    const ws = workspace("gitdirty");
    initGitRepo(ws);
    fs.writeFileSync(path.join(ws, "a.txt"), "a\n");
    git(ws, "add", "-A");
    git(ws, "commit", "-q", "-m", "init");
    fs.writeFileSync(path.join(ws, "wip.txt"), "user work in progress\n");
    const head = git(ws, "rev-parse", "HEAD");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => fileBlocks({ "b.txt": "b\n" }));
    const detail = await runTask(app, project.id, "Add b.txt");
    expect(detail.run.status).toBe("completed_with_warnings");
    expect(git(ws, "rev-parse", "HEAD")).toBe(head);
    expect(fs.readFileSync(path.join(ws, "wip.txt"), "utf8")).toBe("user work in progress\n");
    expect(detail.details.warnings.join(" ")).toMatch(/uncommitted change/);
  }, 60_000);

  it("stop cancels the in-flight model call and rolls back files already written", async () => {
    const ws = workspace("stop");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => fileBlocks({ "a.txt": "one\n" }));
    provider.enqueue("result_review", hangUntilAborted);
    const res = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "write a.txt" } });
    const run = res.json();
    for (let i = 0; i < 100 && !fs.existsSync(path.join(ws, "a.txt")); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    const stop = await app.inject({ method: "POST", url: `/api/v1/runs/${run.id}/stop` });
    expect(stop.statusCode).toBe(200);
    await app.runManager.waitFor(run.id);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` })).json();
    expect(detail.run).toMatchObject({ status: "stopped", outcome: "cancelled" });
    expect(detail.run.summary).toMatch(/rolled back/);
    expect(fs.existsSync(path.join(ws, "a.txt"))).toBe(false);
  }, 60_000);

  it("recovers a run interrupted by a crash: restores the unfinished attempt and marks the run failed", async () => {
    const ws = workspace("crash");
    fs.writeFileSync(path.join(ws, "keep.txt"), "original\n");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => fileBlocks({ "keep.txt": "half-done edit\n", "new.txt": "x\n" }));
    provider.enqueue("result_review", hangUntilAborted);
    const run = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "edit" } })).json();
    for (let i = 0; i < 100 && !fs.existsSync(path.join(ws, "new.txt")); i++) await new Promise((r) => setTimeout(r, 50));

    // A fresh manager (as after a restart) sees the run as orphaned.
    const restarted = new RunManager(getDb(), new EventStore(getDb()));
    expect(restarted.recoverInterruptedRuns()).toBe(1);
    expect(fs.readFileSync(path.join(ws, "keep.txt"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(ws, "new.txt"))).toBe(false);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/runs/${run.id}` })).json();
    expect(detail.run).toMatchObject({ status: "failed", outcome: "error" });
    expect(detail.run.summary).toMatch(/rolled back/);
    // Let the original in-memory job wind down.
    app.runManager.stop(run.id);
    await app.runManager.waitFor(run.id);
  }, 60_000);

  it("fails visibly (and changes nothing) when the reasoning provider is unavailable", async () => {
    const ws = workspace("offline");
    const project = await createProject(app, ws);
    provider.healthy = false;
    const detail = await runTask(app, project.id, "anything");
    expect(detail.run).toMatchObject({ status: "failed", outcome: "error" });
    expect(detail.run.summary).toMatch(/Reasoning provider is not ready/);
    expect(fs.readdirSync(ws)).toEqual([]);
  });

  it("uses the task text directly (and says so) when the planner returns garbage", async () => {
    const ws = workspace("planner");
    const project = await createProject(app, ws);
    provider.enqueue("task_planning", () => "Sure! Here is my plan: do the thing.");
    provider.enqueue("code_generation", () => fileBlocks({ "out.txt": "done\n" }));
    const detail = await runTask(app, project.id, "Write out.txt containing done");
    expect(detail.task.acceptanceCriteria).toEqual(["Write out.txt containing done"]);
    expect(detail.details.warnings.join(" ")).toMatch(/planner's response was not valid JSON/);
  });

  it("rejects a model answer with no file changes", async () => {
    const ws = workspace("nothing");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () => "I think the code is already fine.", () => "Nothing to do.", () => "No.");
    const detail = await runTask(app, project.id, "Do something");
    expect(detail.run.outcome).toBe("rejected");
    expect(detail.attempts[0].agentError).toMatch(/did not return any file changes/);
  });

  it.runIf(process.platform === "win32" || true)("verifies a Python project with its own tests (project-aware checks, no package.json scaffolding)", async () => {
    if (!(await findPython())) return;
    const ws = workspace("python");
    fs.writeFileSync(path.join(ws, "calc.py"), "def add(a, b):\n    return a + b\n");
    const project = await createProject(app, ws);
    provider.enqueue("code_generation", () =>
      fileBlocks({
        "calc.py": "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n",
        "test_calc.py": "import unittest\nfrom calc import add, sub\n\n\nclass T(unittest.TestCase):\n    def test_ops(self):\n        self.assertEqual(add(2, 2), 4)\n        self.assertEqual(sub(5, 3), 2)\n\n\nif __name__ == '__main__':\n    unittest.main()\n",
      })
    );
    const detail = await runTask(app, project.id, "Add sub(a, b) to calc.py with a unit test");
    expect(detail.run.outcome).toBe("verified");
    expect(fs.existsSync(path.join(ws, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "__pycache__"))).toBe(false);
    const labels = detail.attempts[0].checks.filter((c: any) => c.phase === "attempt").map((c: any) => c.label);
    expect(labels.join(" ")).toMatch(/pytest|unittest/);
  }, 90_000);
});

describe("projects API safety", () => {
  let app: FastifyInstance;
  let dataDir: string;
  beforeAll(async () => {
    ({ app, dataDir } = await makeApp({ provider: new ScriptedProvider(), agent: (p) => new BuiltinCoderAdapter(p) }));
  });
  afterAll(async () => {
    await app.close();
    removeDir(dataDir);
  });

  it("refuses the orchestrator's own folder, relative paths and missing folders; creates folders only on request", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/v1/projects", payload });
    expect((await post({ name: "self", rootPath: ORCHESTRATOR_ROOT })).statusCode).toBe(400);
    expect((await post({ name: "rel", rootPath: "some/relative" })).statusCode).toBe(400);
    expect((await post({ name: "nopath" })).statusCode).toBe(400);
    const parent = tempDir("create");
    const target = path.join(parent, "new project");
    expect((await post({ name: "missing", rootPath: target })).statusCode).toBe(400);
    const created = await post({ name: "new", rootPath: target, createFolder: true });
    expect(created.statusCode).toBe(201);
    expect(fs.existsSync(target)).toBe(true);
    expect((await post({ name: "dup", rootPath: target })).statusCode).toBe(409);
    removeDir(parent);
  });

  it("allows only one active run per project and validates the task text", async () => {
    const provider = new ScriptedProvider().enqueue("task_planning", hangUntilAborted);
    const local = await makeApp({ provider, agent: (p) => new BuiltinCoderAdapter(p) });
    const ws = tempDir("busy");
    const project = await createProject(local.app, ws);
    expect((await local.app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "" } })).statusCode).toBe(400);
    const first = await local.app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "first task" } });
    expect(first.statusCode).toBe(201);
    const second = await local.app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "second task" } });
    expect(second.statusCode).toBe(409);
    local.app.runManager.stop(first.json().id);
    await local.app.runManager.waitFor(first.json().id);
    await local.app.close();
    removeDir(ws);
    removeDir(local.dataDir);
  });

  it("rejects requests addressed to a non-loopback host (DNS rebinding) and foreign origins", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/health", headers: { host: "evil.example.com" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/health", headers: { origin: "https://evil.example.com" } })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: "GET", url: "/api/v1/health", headers: { origin: "http://localhost:5173" } })).statusCode).toBe(200);
  });
});
