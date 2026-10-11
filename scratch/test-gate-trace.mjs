import { inspectProject } from "../apps/server/src/workspace/project-inspector.js";
import { runChecks } from "../apps/server/src/verification/runner.js";
import { evaluateAttempt } from "../apps/server/src/orchestrator/acceptance-gate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-trace-"));

// Attempt 1:
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "t", scripts: { test: "node --test" } }));
fs.writeFileSync(path.join(dir, "limiter.test.js"), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false);
});
`);
fs.writeFileSync(path.join(dir, "limiter.js"), `
class RateLimiter {
  constructor(cap) { this.cap = cap; }
  acquire() { return true; }
}
module.exports = { RateLimiter };
`);

const p1 = await inspectProject(dir, []);
const checks1 = await runChecks(dir, p1.checks);
console.log("Attempt 1 checks:", checks1.map(c => `${c.label}: ${c.status}`));

// Attempt 2:
fs.writeFileSync(path.join(dir, "limiter.js"), `
class RateLimiter {
  constructor(cap) { this.cap = cap; this.tokens = cap; }
  acquire() {
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}
module.exports = { RateLimiter };
`);

const p2 = await inspectProject(dir, []);
const checks2 = await runChecks(dir, p2.checks);
console.log("Attempt 2 checks:", checks2.map(c => `${c.label}: ${c.status}`));

const critic = {
  available: true,
  verdict: "accept",
  criteria: [{ id: "AC-1", status: "passed", reason: "all pass" }],
  findings: [],
  repairInstructions: [],
  summary: "looks good",
};

const gate = evaluateAttempt({
  changes: [{ path: "limiter.js", kind: "modified", additions: 5, deletions: 1 }],
  agentFailed: false,
  rejectedWrites: [],
  staticResults: [{ checkId: "s1", kind: "static", label: "syntax", source: "limiter.js", status: "passed", exitCode: 0, durationMs: 1, output: "", truncated: false }],
  baselineChecks: [],
  attemptChecks: checks2,
  critic,
});

console.log("Gate decision:", { accepted: gate.accepted, outcome: gate.outcome, blockers: gate.blockers });

fs.rmSync(dir, { recursive: true, force: true });
