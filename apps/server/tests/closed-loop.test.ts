import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult } from "../src/providers/coding-agents/adapter.js";
import { protoStrings } from "../src/platform/antigravity-agent.js";
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir } from "./helpers.js";

/** Stand-in for the Antigravity Agent: an external agent that only follows the instruction it receives. */
class FakeExternalAgent implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Fake external agent";
  public description = "test double";
  public usesReasoningProvider = false;
  public instructions: string[] = [];
  constructor(private steps: Array<(input: AgentExecutionInput) => { files?: Record<string, string>; reply: string; outside?: string[] }>) {}
  async detect() {
    return { available: true, detail: "fake" };
  }
  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.instructions.push(input.instruction ?? "");
    const step = this.steps[Math.min(input.attemptNumber - 1, this.steps.length - 1)](input);
    for (const [p, c] of Object.entries(step.files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(input.workspacePath, p)), { recursive: true });
      fs.writeFileSync(path.join(input.workspacePath, p), c);
    }
    return {
      status: "completed",
      summary: step.reply,
      filesWritten: Object.keys(step.files ?? {}),
      filesDeleted: [],
      rejectedWrites: [],
      warnings: [],
      transcript: { conversationId: `conv-${input.attemptNumber}`, state: "finished", finalReply: step.reply, toolCalls: [], writesOutsideWorkspace: step.outside ?? [], prompt: input.instruction ?? "" },
    };
  }
}

const PKG = JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node --test" } });
const TEST = "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('./math.js');\ntest('add', () => assert.equal(add(2, 3), 5));\n";

describe("closed loop: reasoning provider instructs an external coding agent", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(removeDir));

  it("sends model-written instructions to the agent and feeds real failures back for the next instruction", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue(
      "repair_diagnosis",
      () => JSON.stringify({ action: "instruct", instruction: "Create math.js exporting add(a,b), math.test.js using node:test, and package.json with test script node --test.", rationale: "start" }),
      (req) => {
        // The second instruction must be based on the observed failure, not the agent's claim.
        expect(req.messages[0].content).toContain("npm test");
        expect(req.messages[0].content).toMatch(/returns a - b|AssertionError|Expected values/i);
        return JSON.stringify({ action: "instruct", instruction: "Fix add in math.js: it must return a + b.", rationale: "test failed" });
      }
    );
    const agent = new FakeExternalAgent([
      () => ({ files: { "package.json": PKG, "math.test.js": TEST, "math.js": "// returns a - b by mistake\nexports.add = (a, b) => a - b;\n" }, reply: "Done, all tests pass." }),
      () => ({ files: { "math.js": "exports.add = (a, b) => a + b;\n" }, reply: "Fixed add." }),
    ]);
    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("loop");
    dirs.push(ws, dataDir);
    const project = await createProject(app, ws);
    const detail = await runTask(app, project.id, "Create a math module with add and a passing test");

    expect(agent.instructions).toEqual([
      "Create math.js exporting add(a,b), math.test.js using node:test, and package.json with test script node --test.",
      "Fix add in math.js: it must return a + b.",
    ]);
    expect(detail.run).toMatchObject({ status: "completed", outcome: "verified", agentId: "antigravity" });
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[0].gate.accepted).toBe(false); // the agent's "all tests pass" claim was not trusted
    expect(detail.attempts[0].instruction).toContain("Create math.js");
    expect(detail.attempts[0].transcript.finalReply).toBe("Done, all tests pass.");
    await app.close();
  }, 60_000);

  it("blocks work written outside the workspace and lets the reasoning model stop the loop", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue(
      "repair_diagnosis",
      () => JSON.stringify({ action: "instruct", instruction: "Write notes.md", rationale: "" }),
      () => JSON.stringify({ action: "stop", stop_reason: "The agent keeps writing outside the project." })
    );
    const agent = new FakeExternalAgent([() => ({ files: { "notes.md": "# notes\n" }, reply: "done", outside: ["C:\\Windows\\evil.txt"] })]);
    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("loop2");
    dirs.push(ws, dataDir);
    const project = await createProject(app, ws);
    const detail = await runTask(app, project.id, "Write notes");
    expect(detail.attempts[0].gate.blockers.join(" ")).toMatch(/outside the workspace/);
    expect(detail.run).toMatchObject({ status: "failed", outcome: "rejected" });
    expect(detail.run.summary).toMatch(/stopped the run/);
    expect(fs.readdirSync(ws)).toEqual([]);
    await app.close();
  }, 60_000);
});

describe("Antigravity trajectory decoding", () => {
  it("extracts strings from protobuf length-delimited fields", () => {
    const enc = (field: number, s: string) => {
      const b = Buffer.from(s);
      return Buffer.concat([Buffer.from([(field << 3) | 2, b.length]), b]);
    };
    const inner = Buffer.concat([enc(1, "write_to_file"), enc(2, '{"TargetFile":"a.txt"}')]);
    const outer = Buffer.concat([Buffer.from([0x08, 0x05]), enc(3, "hello world"), Buffer.from([(4 << 3) | 2, inner.length]), inner]);
    const strings = protoStrings(outer);
    expect(strings).toContain("hello world");
    expect(strings).toContain("write_to_file");
    expect(strings).toContain('{"TargetFile":"a.txt"}');
  });
});
