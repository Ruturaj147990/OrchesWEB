import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventStore } from "../apps/server/src/events/event-store.js";
import { RunRepository } from "../apps/server/src/storage/repositories/run-repository.js";
import { RunStateMachine } from "../apps/server/src/orchestrator/state-machine.js";
import { executeRun } from "../apps/server/src/orchestrator/run-pipeline.js";
import { buildRequirementInventory } from "../apps/server/src/domain/requirements/requirement-inventory.js";
import { ScriptedProvider } from "../apps/server/tests/helpers.js";
import { SettingsManager } from "../apps/server/src/platform/settings-manager.js";

console.log("=== Tracing Actual Runtime Execution Path in Orches ===");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-runtime-test-"));
const dbPath = path.join(tempDir, "orches-test.db");
const db = new DatabaseSync(dbPath);

// Apply migrations
const schemaPath = path.resolve("apps/server/src/storage/db.ts");
const dbSrc = fs.readFileSync(schemaPath, "utf8");
// Extract schema SQL
const schemaMatch = dbSrc.match(/const SCHEMA = `([\s\S]+?)`;/);
if (schemaMatch) {
  db.exec(schemaMatch[1]);
} else {
  // Execute base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, root_path TEXT, objective TEXT, created_at TEXT, updated_at TEXT, auto_commit INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, task_text TEXT, status TEXT, phase TEXT, current_task_id TEXT, current_attempt_id TEXT, created_at TEXT, updated_at TEXT, commit_sha TEXT, outcome TEXT, summary TEXT, iteration INTEGER DEFAULT 0, max_iterations INTEGER DEFAULT 3, autonomy_mode TEXT DEFAULT 'creative_within_constraints');
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT, run_id TEXT, title TEXT, description TEXT, kind TEXT, status TEXT, priority TEXT, risk TEXT, acceptance_criteria_json TEXT, verification_plan_json TEXT, max_attempts INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS task_attempts (id TEXT PRIMARY KEY, task_id TEXT, attempt_number INTEGER, adapter_id TEXT, provider_id TEXT, model_id TEXT, base_commit TEXT, task_branch TEXT, snapshot_id TEXT, status TEXT, started_at TEXT, ended_at TEXT, instruction_text TEXT, agent_transcript_json TEXT);
    CREATE TABLE IF NOT EXISTS run_events (id TEXT PRIMARY KEY, project_id TEXT, run_id TEXT, task_id TEXT, kind TEXT, payload_json TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS blueprint_documents (id TEXT PRIMARY KEY, project_id TEXT, filename TEXT, extracted_text TEXT, char_count INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS blueprint_candidate_requirements (id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, title TEXT, description TEXT, provenance_kind TEXT, source_reference TEXT, created_at TEXT);
  `);
}

const events = new EventStore(db);
const runs = new RunRepository(db);
const stateMachine = new RunStateMachine(runs, events);

// Workspace setup
const workspaceDir = path.join(tempDir, "workspace");
fs.mkdirSync(workspaceDir, { recursive: true });
fs.writeFileSync(path.join(workspaceDir, "package.json"), JSON.stringify({ name: "demo-service", scripts: { test: "node test.js" } }, null, 2));
fs.writeFileSync(path.join(workspaceDir, "test.js"), "console.log('tests running'); process.exit(0);");

// 1. Enter Project Specification & Blueprint
const projectObjective = `
# Developer Token Bucket Rate Limiter
## Requirements
- Must implement Token Bucket rate limiting algorithm.
- Must support replenishing tokens per second based on configuration.
- Must return HTTP 429 when bucket is exhausted.

## Constraints
- Strictly SQLite only; do not introduce external database servers.
- Zero external dependencies: use Node standard library only.

## Acceptance Criteria
- Verify that requests exceeding bucket capacity return HTTP 429.
`;

const projectId = "proj-runtime-1";
db.prepare("INSERT INTO projects (id, name, root_path, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
  projectId, "Rate Limiter", workspaceDir, projectObjective, new Date().toISOString(), new Date().toISOString()
);
const project = {
  id: projectId,
  name: "Rate Limiter",
  rootPath: workspaceDir,
  objective: projectObjective,
  autoCommit: false,
};

// Insert a Blueprint Document
const docId = "doc-1";
db.prepare("INSERT INTO blueprint_documents (id, project_id, filename, extracted_text, char_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)").run(
  docId, projectId, "RateLimiterSpec.md", projectObjective, projectObjective.length, new Date().toISOString(), new Date().toISOString()
);

// 2. Create Run
const runId = "run-runtime-1";
const taskText = "Implement Token Bucket Rate Limiter";
db.prepare("INSERT INTO runs (id, project_id, title, task_text, status, phase, created_at, updated_at, max_iterations, autonomy_mode) VALUES (?, ?, ?, ?, 'created', 'idle', ?, ?, 3, 'strict_blueprint_adherence')").run(
  runId, projectId, "Build Rate Limiter", taskText, new Date().toISOString(), new Date().toISOString()
);
const run = runs.get(runId);

// 3. Configure Reasoning Provider (Scripted returning an unvalidated candidate prompt that misses the 429 criterion and SQLite constraint)
const provider = new ScriptedProvider();
// When asked for instruction in attempt 1, return a candidate prompt that omitted the 429 acceptance criterion
provider.enqueue("repair_diagnosis", () =>
  JSON.stringify({
    action: "instruct",
    instruction: `
# Implementation Brief: Rate Limiter
Implement Token Bucket rate limiting algorithm and token replenishment per second.
Run npm test to verify.
    `.trim(),
    rationale: "Initial candidate brief",
  })
);

// Critic response
provider.enqueue("repair_diagnosis", () =>
  JSON.stringify({
    verdict: "accept",
    summary: "Implementation meets all requirements",
    criteria: [{ id: "c1", status: "passed", reason: "Passes tests" }],
    findings: [],
    repairInstructions: [],
  })
);

// 4. Test Double for Native Antigravity Coding Agent Adapter
let dispatchedPrompt = null;
const recordedDispatches = [];

const agentDouble = {
  id: "native-antigravity",
  displayName: "Antigravity Agent",
  usesReasoningProvider: false, // External agent, invokes closed-loop instructor
  execute: async (input) => {
    dispatchedPrompt = input.instruction;
    recordedDispatches.push({
      attempt: input.attemptNumber,
      instruction: input.instruction,
      filesToRead: input.filesToRead,
    });

    // Simulate agent writing the implementation file
    fs.writeFileSync(path.join(workspaceDir, "limiter.js"), "// Token bucket implementation\nmodule.exports = {};");

    return {
      status: "completed",
      filesWritten: ["limiter.js"],
      filesDeleted: [],
      rejectedWrites: [],
      warnings: [],
      transcript: {
        prompt: input.instruction,
        finalReply: "Implemented token bucket rate limiter in limiter.js and verified tests pass.",
        toolCalls: [{ tool: "write_to_file", args: { path: "limiter.js" } }],
        state: "completed",
        writesOutsideWorkspace: [],
      },
    };
  },
};

// 5. Execute Run Pipeline
const controller = new AbortController();
await executeRun({
  db,
  events,
  runs,
  stateMachine,
  project,
  run,
  taskText,
  provider,
  agent: agentDouble,
  maxAttempts: 3,
  signal: controller.signal,
});

console.log("\nPipeline Execution Concluded!");

// Inspect events recorded in the database
const allEvents = db.prepare("SELECT kind, payload_json FROM run_events WHERE project_id = ? ORDER BY rowid ASC").all(projectId);
console.log(`Total events recorded: ${allEvents.length}`);

const fidelityEvent = allEvents.find((e) => e.kind === "requirements.fidelity_checked");
const instructionEvent = allEvents.find((e) => e.kind === "brain.instruction");
const reqUpdatedEvent = allEvents.find((e) => e.kind === "requirements.updated");
const attemptEvaluatedEvent = allEvents.find((e) => e.kind === "attempt.evaluated");

console.log("\n1. Requirement Fidelity Checked Event:", fidelityEvent ? "RECORDED" : "MISSING");
if (fidelityEvent) {
  const payload = JSON.parse(fidelityEvent.payload_json);
  console.log(`   Attempt: ${payload.attempt}, Score: ${payload.score}/100, Passed: ${payload.passed}`);
  console.log(`   Summary: ${payload.summary}`);
  console.log(`   Missing requirements detected:`, payload.missingRequirements?.map((m) => m.title));
}

console.log("\n2. Brain Instruction Event (Dispatch to Agent):", instructionEvent ? "RECORDED" : "MISSING");
if (instructionEvent) {
  const payload = JSON.parse(instructionEvent.payload_json);
  console.log(`   Action: ${payload.action}, Provider: ${payload.provider}, Model: ${payload.model}`);
  console.log(`   Dispatched prompt contains Mandatory Enforcement: ${payload.instruction.includes("Mandatory Requirements (Traceability Enforcement)")}`);
  console.log(`   Dispatched prompt contains SQLite constraint: ${payload.instruction.includes("SQLite")}`);
}

console.log("\n3. Antigravity Agent Dispatch Boundary:");
console.log(`   Did agent receive the validated, corrected prompt? ${dispatchedPrompt?.includes("Mandatory Requirements (Traceability Enforcement)") ? "YES" : "NO"}`);
console.log(`   Did agent receive unvalidated candidate? ${dispatchedPrompt === "# Implementation Brief: Rate Limiter\nImplement Token Bucket rate limiting algorithm and token replenishment per second.\nRun npm test to verify." ? "YES (ERROR)" : "NO (CORRECT)"}`);

console.log("\n4. Requirement Status Retention & Updates:", reqUpdatedEvent ? "RECORDED" : "MISSING");
if (reqUpdatedEvent) {
  const payload = JSON.parse(reqUpdatedEvent.payload_json);
  console.log(`   Updated status summary:`, payload.summary.byStatus);
}

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });
