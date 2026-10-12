import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult } from "../src/providers/coding-agents/adapter.js";
import { EventStore } from "../src/events/event-store.js";
import { getDb } from "../src/storage/db.js";
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir } from "./helpers.js";

class TrackedAntigravityAgent implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Native Antigravity Agent";
  public description = "Test double tracking exact dispatch boundary payloads";
  public usesReasoningProvider = false;
  public dispatchedPrompts: string[] = [];

  constructor(
    private steps: Array<(input: AgentExecutionInput) => { files?: Record<string, string>; reply: string }>
  ) {}

  async detect() {
    return { available: true, detail: "antigravity-bridge" };
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.dispatchedPrompts.push(input.instruction ?? "");
    const step = this.steps[Math.min(input.attemptNumber - 1, this.steps.length - 1)](input);

    for (const [p, c] of Object.entries(step.files ?? {})) {
      const full = path.join(input.workspacePath, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, c);
    }

    return {
      status: "completed",
      summary: step.reply,
      filesWritten: Object.keys(step.files ?? {}),
      filesDeleted: [],
      rejectedWrites: [],
      warnings: [],
      transcript: {
        conversationId: `conv-${input.attemptNumber}`,
        state: "finished",
        finalReply: step.reply,
        toolCalls: [],
        writesOutsideWorkspace: [],
        prompt: input.instruction ?? "",
      },
    };
  }
}

const PKG = JSON.stringify({
  name: "rate-limiter",
  version: "1.0.0",
  scripts: { test: "node --test" },
});

const FAILING_TEST = `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false); // fails because implementation allows infinite
});
`;

const PASSING_TEST = `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('./limiter.js');
test('rate limiter blocks after capacity', () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire(), true);
  assert.equal(limiter.acquire(), false);
});
`;

describe("Section 1 & 5 Verification: End-to-End Runtime Execution Path & Repair Iterations", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(removeDir));

  it("traces complete execution: spec ingest -> reasoning prompt -> fidelity gate -> dispatch -> repair iteration with real evidence", async () => {
    const provider = new ScriptedProvider();

    // Attempt 1: Model generates a candidate prompt missing the negative constraint and mandatory rate limit
    provider.enqueue(
      "repair_diagnosis",
      () => {
        return JSON.stringify({
          action: "instruct",
          instruction: `
# Initial Implementation Brief
Implement Token Bucket RateLimiter class in limiter.js.
Run npm test to verify.
          `.trim(),
          rationale: "Initial candidate brief",
        });
      },
      // Attempt 2: Reasoning model receives the failure evidence from attempt 1
      (req) => {
        expect(req.messages[0].content).toMatch(/npm test|AssertionError|Expected values/i);
        return JSON.stringify({
          action: "instruct",
          instruction: `
# Corrective Brief: Fix Token Bucket Capacity Check
Fix limiter.js so that acquire() accurately decrements tokens and returns false once capacity of 5 is exceeded.
Run npm test to verify.
          `.trim(),
          rationale: "Repair failing assertion",
        });
      }
    );

    const agent = new TrackedAntigravityAgent([
      // Attempt 1: Writes broken implementation that fails test
      () => {
        return {
          files: {
            "package.json": PKG,
            "limiter.test.js": PASSING_TEST,
            "limiter.js": `
class RateLimiter {
  constructor(cap) { this.cap = cap; }
  acquire() { return true; } // Bug: always returns true
}
module.exports = { RateLimiter };
            `.trim(),
          },
          reply: "Implemented RateLimiter class.",
        };
      },
      // Attempt 2: Fixes implementation based on feedback
      () => {
        return {
          files: {
            "limiter.js": `
class RateLimiter {
  constructor(cap) { this.cap = cap; this.tokens = cap; }
  acquire() {
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}
module.exports = { RateLimiter };
            `.trim(),
          },
          reply: "Fixed acquire to enforce capacity.",
        };
      },
    ]);

    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("runtime-e2e");
    dirs.push(ws, dataDir);

    const projectObjective = `
# Token Bucket Rate Limiter Service
## Requirements
- Must implement Token Bucket algorithm with capacity limit of 5 tokens.
- Must replenish tokens per second.

## Constraints
- Strictly SQLite only; do not introduce external database servers.
- Zero external dependencies: use Node standard library only.

## Acceptance Criteria
- Verify that acquire() returns false after 5 consecutive calls.
    `.trim();

    // 1. Enter project through real Project Specification & Instructions interface
    const project = await createProject(app, ws, { objective: projectObjective, autoCommit: false });
    expect(project.id).toBeDefined();

    // 2. Supply blueprint document via API
    const docRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/blueprints`,
      payload: {
        filename: "RateLimiterBlueprint.md",
        contentText: projectObjective,
      },
    });
    expect(docRes.statusCode).toBe(201);

    // 3. Start task run through real endpoint
    const detail = await runTask(app, project.id, "Implement Token Bucket Rate Limiter");

    // 4. Verify run outcome and attempt counts
    expect(detail.run).toMatchObject({
      status: "completed",
      outcome: "verified",
      agentId: "antigravity",
    });
    expect(detail.attempts).toHaveLength(2);

    // 5. Verify Prompt Reaching Dispatch Boundary:
    // Attempt 1 candidate prompt omitted the mandatory requirements and constraints.
    // The raw requirement inventory is NOT appended to the executable brief!
    const attempt1Dispatch = agent.dispatchedPrompts[0];
    expect(attempt1Dispatch).toBeDefined();
    expect(attempt1Dispatch).not.toContain("Mandatory Requirements (Traceability Enforcement)");
    expect(attempt1Dispatch).toContain("RateLimiter");

    // 6. Verify Iteration 2 received real failure evidence:
    const attempt2Dispatch = agent.dispatchedPrompts[1];
    expect(attempt2Dispatch).toBeDefined();
    expect(attempt2Dispatch).toContain("Fix Token Bucket Capacity Check");

    // 7. Verify events in run detail
    const events = new EventStore(getDb()).getEventsSince(project.id, 0);

    const fidelityEvents = events.filter((e: any) => e.type === "requirements.fidelity_checked");
    expect(fidelityEvents.length).toBeGreaterThanOrEqual(1);
    expect(fidelityEvents[0].payload.passed).toBe(false);
    expect(fidelityEvents[0].payload.missingRequirements.length).toBeGreaterThanOrEqual(1);

    const updatedEvents = events.filter((e: any) => e.type === "requirements.updated");
    expect(updatedEvents.length).toBeGreaterThanOrEqual(2);
    // After attempt 1 (failed test), requirements were NOT marked verified
    expect(updatedEvents[0].payload.summary.byStatus.verified).toBe(0);
    // After attempt 2 (tests passed), requirements were marked verified
    expect(updatedEvents[1].payload.summary.byStatus.verified).toBeGreaterThan(0);

    await app.close();
  }, 60_000);
});
