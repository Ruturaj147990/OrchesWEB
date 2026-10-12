import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRequirementInventory } from "../src/domain/requirements/requirement-inventory.js";
import { validatePromptFidelity, validateAndCorrectPrompt } from "../src/orchestrator/prompt-fidelity-gate.js";
import { composeInstruction } from "../src/orchestrator/instructor.js";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult } from "../src/providers/coding-agents/adapter.js";
import { EventStore } from "../src/events/event-store.js";
import { getDb } from "../src/storage/db.js";
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir } from "./helpers.js";

class TrackedSyntheticAntigravityAgent implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Native Antigravity Agent";
  public description = "Test double tracking exact dispatch boundary payloads for synthetic simulator";
  public usesReasoningProvider = false;
  public dispatchedPrompts: string[] = [];

  constructor(
    private fileGenerator: (input: AgentExecutionInput) => { files?: Record<string, string>; reply: string }
  ) {}

  async detect() {
    return { available: true, detail: "antigravity-bridge" };
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.dispatchedPrompts.push(input.instruction ?? "");
    const generated = this.fileGenerator(input);

    for (const [p, c] of Object.entries(generated.files ?? {})) {
      const full = path.join(input.workspacePath, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, c);
    }

    return {
      status: "completed",
      summary: generated.reply,
      filesWritten: Object.keys(generated.files ?? {}),
      filesDeleted: [],
      rejectedWrites: [],
      warnings: [],
      transcript: {
        conversationId: `conv-${input.attemptNumber}`,
        state: "finished",
        finalReply: generated.reply,
        toolCalls: [],
        writesOutsideWorkspace: [],
        prompt: input.instruction ?? "",
      },
    };
  }
}

describe("ORCHES HOTFIX: Synthetic Simulator Validated Brief & Inventory Separation", () => {
  const dirs: string[] = [];

  const SYNTHETIC_TASK = "Build Synthetic Event Scheduling Simulator for radar research";
  const SYNTHETIC_SPEC = `
# Project Specification: Non-Operational Synthetic Scheduling Simulator

## Authorized In-Scope Simulator Requirements
- Must implement synthetic event scheduling queue with priority ordering [REQ-001].
- Must implement simulation timeline coordinator with deterministic tick generator [REQ-002].
- Must provide synthetic emitter profile generator using pseudo-random seeds [REQ-003].

## Operational Hardware & Military Capabilities (Strictly Excluded / Prohibited)
- Must implement operational military-emitter interception [REQ-004].
- Must optimize radar-specific interception optimization algorithms for battlefield deployment [REQ-005].
- Must control physical RF receiver hardware via serial interface [REQ-006].
- Must support military deployment on weapon systems [REQ-007].

## Architecture Constraints
- Strictly SQLite only for local event logging.
- Zero external dependencies: use Node.js standard library only.

## Acceptance Criteria
- Verify that simulator schedules synthetic events deterministically.
- Verify that tests pass cleanly with exit code 0.
  `.trim();

  const VALID_SIMULATOR_BRIEF = `
# Implementation Mission: Non-Operational Synthetic Scheduling Simulator
Implement the discrete-event scheduling simulator in simulator.js.

## Architecture & Design
- Build priority event queue with timestamp-ordered event execution.
- Implement simulation timeline coordinator with deterministic tick generator.
- Implement synthetic emitter profile generator using pseudo-random seeds.
- Strictly adhere to Node.js standard library modules only (http, crypto, fs).
- Use SQLite for storing run traces.

## Explicit In-Scope Requirements Traceability
- [REQ-001] Synthetic event scheduling queue with priority ordering.
- [REQ-002] Simulation timeline coordinator with deterministic tick generator.
- [REQ-003] Synthetic emitter profile generator with pseudo-random seeds.

## Excluded Scope Boundary Notice
Operational military-emitter interception [REQ-004], radar-specific interception optimization [REQ-005], physical RF receiver control [REQ-006], and military deployment [REQ-007] are strictly prohibited and excluded from implementation.

## Verification
Run npm test to ensure all deterministic scheduling assertions pass.
  `.trim();

  it("1. Scope Resolution: identifies synthetic simulator scope and marks operational military requirements as safety conflicts without deleting them", () => {
    const inventory = buildRequirementInventory({
      taskText: SYNTHETIC_TASK,
      projectObjective: SYNTHETIC_SPEC,
    });

    expect(inventory.requirements.length).toBeGreaterThanOrEqual(7);

    // In-scope requirements
    const req1 = inventory.requirements.find((r) => r.description.includes("synthetic event scheduling queue"));
    expect(req1).toBeDefined();
    expect(req1?.scopeStatus).toBe("in_scope");

    const req2 = inventory.requirements.find((r) => r.description.includes("simulation timeline coordinator"));
    expect(req2).toBeDefined();
    expect(req2?.scopeStatus).toBe("in_scope");

    // Operational military & hardware interception requirements must be safety conflicts
    const militaryReqs = inventory.requirements.filter(
      (r) =>
        r.description.includes("operational military-emitter interception") ||
        r.description.includes("radar-specific interception optimization") ||
        r.description.includes("physical RF receiver hardware") ||
        r.description.includes("military deployment")
    );

    expect(militaryReqs.length).toBeGreaterThanOrEqual(4);
    for (const r of militaryReqs) {
      expect(r.scopeStatus).toBe("safety_conflict");
      expect(r.scopeConflictReason).toContain("prohibited under the authorized synthetic");
      // Provenance, ID, and description must be fully preserved
      expect(r.id).toBeDefined();
      expect(r.sourceReference).toBeDefined();
    }
  });

  it("2. Valid synthetic-simulator brief passes fidelity gate without appending raw Mandatory Requirements section", () => {
    const inventory = buildRequirementInventory({
      taskText: SYNTHETIC_TASK,
      projectObjective: SYNTHETIC_SPEC,
    });

    const report = validatePromptFidelity(VALID_SIMULATOR_BRIEF, inventory);
    expect(report.passed).toBe(true);
    expect(report.missingRequirements).toHaveLength(0);
    expect(report.weakenedConstraints).toHaveLength(0);

    const result = validateAndCorrectPrompt(VALID_SIMULATOR_BRIEF, inventory);
    expect(result.passed).toBe(true);
    // Crucial: The raw Mandatory Requirements section must NOT be appended!
    expect(result.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");
    expect(result.prompt).not.toContain("Mandatory Requirements (Traceability Enforcement)");
    expect(result.prompt.trim()).toBe(VALID_SIMULATOR_BRIEF.trim());
  });

  it("3. Applicable requirements remain available for fidelity check; genuinely missing requirement is flagged and NOT masked by appending raw inventory", () => {
    const inventory = buildRequirementInventory({
      taskText: SYNTHETIC_TASK,
      projectObjective: SYNTHETIC_SPEC,
    });

    // Brief that deliberately omits REQ-002 (simulation timeline coordinator)
    const incompleteBrief = `
# Implementation Mission: Non-Operational Synthetic Scheduling Simulator
Implement the discrete-event scheduling simulator in simulator.js.
- [REQ-001] Synthetic event scheduling queue with priority ordering.
- [REQ-003] Synthetic emitter profile generator with pseudo-random seeds.
Run npm test to verify.
    `.trim();

    const report = validatePromptFidelity(incompleteBrief, inventory);
    expect(report.passed).toBe(false);
    expect(report.missingRequirements.length).toBeGreaterThanOrEqual(1);
    expect(report.missingRequirements.some((m) => m.title.includes("timeline coordinator"))).toBe(true);

    const corrected = validateAndCorrectPrompt(incompleteBrief, inventory);
    // Insufficient brief must NOT be made valid by appending an inventory!
    expect(corrected.passed).toBe(false);
    expect(corrected.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");
    expect(corrected.prompt).not.toContain("Mandatory Requirements (Traceability Enforcement)");
    expect(corrected.report.missingRequirements.some((m) => m.title.includes("timeline coordinator"))).toBe(true);
    expect(corrected.residualUncertainties.length).toBeGreaterThan(0);
  });

  it("4. Malformed or insufficient brief cannot be made valid by appending an inventory", () => {
    const inventory = buildRequirementInventory({
      taskText: SYNTHETIC_TASK,
      projectObjective: SYNTHETIC_SPEC,
    });

    const stubPrompt = "Defining a safe alternative";
    const result = validateAndCorrectPrompt(stubPrompt, inventory);
    expect(result.passed).toBe(false);
    expect(result.prompt).toBe(stubPrompt);
    expect(result.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");

    const jsonDescriptor = '{"title": "Implement Simulator", "acceptance_criteria": ["run test"]}';
    const resultJson = validateAndCorrectPrompt(jsonDescriptor, inventory);
    expect(resultJson.passed).toBe(false);
    expect(resultJson.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");
  });

  it("5. STOP responses and invalid instructions never reach the agent dispatch boundary", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue("code_generation", () => {
      return "ORCHES_STATUS: STOP\nReason: Safety boundary conflict in operational emitter request";
    });

    const agent = new TrackedSyntheticAntigravityAgent(() => ({ reply: "Should not execute" }));
    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("stop-boundary");
    dirs.push(ws, dataDir);

    const project = await createProject(app, ws, { objective: SYNTHETIC_SPEC, autoCommit: false });
    const detail = await runTask(app, project.id, SYNTHETIC_TASK);

    expect(detail.run.status).toBe("failed");
    expect(detail.run.outcome).toBe("rejected");
    // Agent was never called!
    expect(agent.dispatchedPrompts).toHaveLength(0);

    await app.close();
  });

  it("6. Full pipeline execution: Valid synthetic simulator brief is preserved through final dispatch to Antigravity without raw mandatory inventory", async () => {
    const SIMULATOR_CODE = `
class EventQueue {
  constructor() { this.events = []; }
  schedule(event) { this.events.push(event); this.events.sort((a, b) => a.time - b.time); }
  next() { return this.events.shift(); }
}
class TimelineCoordinator {
  constructor() { this.tick = 0; }
  advance() { this.tick++; return this.tick; }
}
module.exports = { EventQueue, TimelineCoordinator };
    `.trim();

    const SIMULATOR_TEST = `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventQueue, TimelineCoordinator } = require('./simulator.js');

test('synthetic event scheduling simulator runs deterministically', () => {
  const queue = new EventQueue();
  queue.schedule({ time: 20, name: 'event-b' });
  queue.schedule({ time: 10, name: 'event-a' });
  assert.equal(queue.next().name, 'event-a');
  assert.equal(queue.next().name, 'event-b');

  const timeline = new TimelineCoordinator();
  assert.equal(timeline.advance(), 1);
  assert.equal(timeline.advance(), 2);
});
    `.trim();

    const PKG = JSON.stringify({
      name: "synthetic-simulator",
      version: "1.0.0",
      scripts: { test: "node --test" },
    });

    const provider = new ScriptedProvider();
    provider.enqueue("code_generation", () => {
      return `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
${VALID_SIMULATOR_BRIEF}
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
    });

    const agent = new TrackedSyntheticAntigravityAgent(() => ({
      files: {
        "package.json": PKG,
        "simulator.js": SIMULATOR_CODE,
        "simulator.test.js": SIMULATOR_TEST,
      },
      reply: "Implemented and verified deterministic synthetic event queue and timeline coordinator.",
    }));

    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("pipeline-synthetic");
    dirs.push(ws, dataDir);

    const project = await createProject(app, ws, { objective: SYNTHETIC_SPEC, autoCommit: false });
    const detail = await runTask(app, project.id, SYNTHETIC_TASK);

    // 1. Task run succeeded and was verified
    expect(detail.run).toMatchObject({
      status: "completed",
      outcome: "verified",
      agentId: "antigravity",
    });

    // 2. Exactly 1 dispatch occurred
    expect(agent.dispatchedPrompts).toHaveLength(1);
    const dispatched = agent.dispatchedPrompts[0];

    // 3. Dispatched instruction body contains the validated synthetic brief
    expect(dispatched).toContain("Implementation Mission: Non-Operational Synthetic Scheduling Simulator");
    expect(dispatched).toContain("Synthetic event scheduling queue with priority ordering");
    expect(dispatched).toContain("Simulation timeline coordinator with deterministic tick generator");

    // 4. CRITICAL: Dispatched prompt does NOT contain raw Mandatory Requirements (Traceability Enforcement)
    expect(dispatched).not.toContain("Mandatory Requirements (Traceability Enforcement)");
    expect(dispatched).not.toContain("## Mandatory Requirements (Traceability Enforcement)");

    // 5. Excluded military requirements were NOT reintroduced as implementation instructions
    expect(dispatched).not.toContain("- **[REQ-004]** Must implement operational military-emitter interception");
    expect(dispatched).not.toContain("- **[REQ-005]** Must optimize radar-specific interception optimization");

    // 6. Fidelity checked event records success
    const events = new EventStore(getDb()).getEventsSince(project.id, 0);
    const fidelityEvents = events.filter((e: any) => e.type === "requirements.fidelity_checked");
    expect(fidelityEvents.length).toBeGreaterThanOrEqual(1);
    expect(fidelityEvents[0].payload.passed).toBe(true);
    expect(fidelityEvents[0].payload.score).toBe(100);

    await app.close();
  });

  afterAll(() => {
    for (const d of dirs) removeDir(d);
  });
});
