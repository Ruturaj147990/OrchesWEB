import { describe, it, expect } from "vitest";
import { evaluateAttempt, GateInput } from "../src/orchestrator/acceptance-gate.js";
import { parseFileOperations } from "../src/prompts/file-operations.js";
import { normalizeCriticJson } from "../src/orchestrator/critic.js";
import { focusOutput } from "../src/orchestrator/run-pipeline.js";
import type { CheckResult } from "../src/verification/runner.js";

const check = (id: string, status: CheckResult["status"], extra: Partial<CheckResult> = {}): CheckResult => ({
  checkId: id,
  kind: "test",
  label: id,
  source: "test",
  status,
  exitCode: status === "passed" ? 0 : 1,
  durationMs: 1,
  output: "",
  truncated: false,
  ...extra,
});

const accept = { available: true, verdict: "accept" as const, criteria: [], findings: [], repairInstructions: [], summary: "ok" };

const base = (over: Partial<GateInput> = {}): GateInput => ({
  changes: [{ path: "src/a.js", kind: "modified", additions: 1, deletions: 0, binary: false }],
  agentFailed: false,
  rejectedWrites: [],
  staticResults: [],
  baselineChecks: [check("npm-test", "passed")],
  attemptChecks: [check("npm-test", "passed")],
  critic: accept,
  ...over,
});

describe("acceptance gate", () => {
  it("verifies when checks pass and the review accepts", () => {
    expect(evaluateAttempt(base())).toMatchObject({ accepted: true, outcome: "verified", blockers: [] });
  });

  it("never accepts an attempt without file changes, whatever the model claims", () => {
    const d = evaluateAttempt(base({ changes: [] }));
    expect(d.accepted).toBe(false);
    expect(d.blockers.join()).toMatch(/No files were changed/);
  });

  it("rejects regressions in checks that passed before", () => {
    const d = evaluateAttempt(base({ attemptChecks: [check("npm-test", "failed")] }));
    expect(d.accepted).toBe(false);
    expect(d.blockers.join()).toMatch(/regression/);
  });

  it("rejects failing new checks and timeouts", () => {
    expect(evaluateAttempt(base({ baselineChecks: [], attemptChecks: [check("npm-test", "failed")] })).accepted).toBe(false);
    expect(evaluateAttempt(base({ attemptChecks: [check("npm-test", "timeout")] })).blockers.join()).toMatch(/timed out/);
  });

  it("does not count a check that was already failing as verification", () => {
    const d = evaluateAttempt(base({ baselineChecks: [check("npm-test", "failed")], attemptChecks: [check("npm-test", "failed")] }));
    expect(d).toMatchObject({ accepted: true, outcome: "unverified" });
    expect(d.warnings.join()).toMatch(/already failing/);
  });

  it("marks work without any automated checks as unverified", () => {
    const d = evaluateAttempt(base({ baselineChecks: [], attemptChecks: [] }));
    expect(d).toMatchObject({ accepted: true, outcome: "unverified" });
  });

  it("blocks on static validation failures and protected paths", () => {
    expect(evaluateAttempt(base({ staticResults: [check("static:x.json", "failed", { label: "validate x.json", output: "invalid JSON" })] })).accepted).toBe(false);
    expect(evaluateAttempt(base({ changes: [{ path: ".env", kind: "added", additions: 1, deletions: 0, binary: false }] })).accepted).toBe(false);
  });

  it("lets the critic block only with concrete reasons", () => {
    const vague = evaluateAttempt(base({ critic: { ...accept, verdict: "repair", summary: "needs more docs" } }));
    expect(vague).toMatchObject({ accepted: true, outcome: "unverified" });
    const concrete = evaluateAttempt(
      base({ critic: { ...accept, verdict: "repair", criteria: [{ id: "AC-1", status: "failed", reason: "multiply returns a+b" }] } })
    );
    expect(concrete.accepted).toBe(false);
    const severe = evaluateAttempt(base({ critic: { ...accept, verdict: "repair", findings: [{ severity: "critical", message: "deletes user data" }] } }));
    expect(severe.accepted).toBe(false);
  });

  it("cannot be verified when the review is unavailable", () => {
    const d = evaluateAttempt(base({ critic: { available: false, error: "timeout", verdict: "repair", criteria: [], findings: [], repairInstructions: [], summary: "" } }));
    expect(d).toMatchObject({ accepted: true, outcome: "unverified" });
  });

  it("rejects when the coding mechanism failed", () => {
    expect(evaluateAttempt(base({ agentFailed: true, agentError: "model offline" })).accepted).toBe(false);
  });
});

describe("parseFileOperations", () => {
  it("parses block format with deletes and summary", () => {
    const ops = parseFileOperations("intro\n<<<FILE src/a.js>>>\nconst a = 1;\n<<<END>>>\n<<<DELETE old.js>>>\n<<<SUMMARY>>> did it");
    expect(ops).toMatchObject({ format: "blocks", writes: [{ path: "src/a.js", content: "const a = 1;" }], deletes: ["old.js"], summary: "did it", incomplete: [] });
  });

  it("unwraps markdown fences inside blocks and flags truncated blocks", () => {
    const ops = parseFileOperations("<<<FILE a.py>>>\n```python\nprint(1)\n```\n<<<END>>>\n<<<FILE b.py>>>\nprint(2");
    expect(ops.writes).toEqual([{ path: "a.py", content: "print(1)" }]);
    expect(ops.incomplete).toEqual(["b.py"]);
  });

  it("falls back to JSON and markdown formats", () => {
    expect(parseFileOperations('```json\n{"files":[{"path":"x.txt","content":"hi"}],"summary":"s"}\n```')).toMatchObject({ format: "json", writes: [{ path: "x.txt", content: "hi" }] });
    expect(parseFileOperations("### src/app.ts\n```ts\nexport const x = 1;\n```\n")).toMatchObject({ format: "markdown", writes: [{ path: "src/app.ts", content: "export const x = 1;" }] });
    expect(parseFileOperations("I cannot help with that").format).toBe("none");
  });
});

describe("critic normalization", () => {
  it("normalizes loose verdict wording and statuses", () => {
    expect(normalizeCriticJson({ verdict: "Accepted", criteria: [{ id: "AC-1", status: "met" }] })).toMatchObject({ verdict: "accept", criteria: [{ status: "passed" }] });
    expect(normalizeCriticJson({ verdict: "reject" })).toMatchObject({ verdict: "repair" });
    expect(normalizeCriticJson({ foo: 1 })).toBeNull();
  });
});

describe("focusOutput", () => {
  it("keeps error lines from long output", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `noise ${i}`);
    lines[50] = "TypeError: expect is not a function";
    const out = focusOutput(lines.join("\n"));
    expect(out).toContain("TypeError: expect is not a function");
    expect(out.split("\n").length).toBeLessThanOrEqual(45);
  });
});

describe("gate regressions from live closed-loop runs", () => {
  it("does not accept when the reviewer says 'accept' but marks a criterion unverified and asks for a fix", () => {
    const d = evaluateAttempt(
      base({
        attemptChecks: [],
        baselineChecks: [],
        critic: {
          ...accept,
          verdict: "accept",
          criteria: [
            { id: "AC-1", status: "passed", reason: "ok" },
            { id: "AC-4", status: "unverified", reason: "No tests are provided in the diff" },
          ],
          repairInstructions: ["Create a stats.test.js file with tests"],
          summary: "meets all criteria except for providing tests",
        },
      })
    );
    expect(d.accepted).toBe(false);
    expect(d.blockers.join(" ")).toMatch(/AC-4 not shown to be met/);
  });

  it("blocks when files the task explicitly asks for are missing", async () => {
    const { missingRequestedFiles } = await import("../src/workspace/requested-files.js");
    const task = 'Create a Node.js module stats.js with mean and median. Add tests in stats.test.js and a package.json whose test script is "node --test". Do not create index.js; delete old.js.';
    expect(missingRequestedFiles(task, ["stats.js"])).toEqual(["stats.test.js", "package.json"]);
    expect(missingRequestedFiles(task, ["stats.js", "test/stats.test.js", "package.json"])).toEqual([]);
    expect(evaluateAttempt(base({ missingRequestedFiles: ["stats.test.js"] })).accepted).toBe(false);
  });
});
