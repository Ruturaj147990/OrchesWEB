import { SettingsManager } from "../apps/server/dist/platform/settings-manager.js";
import { getActiveProvider } from "../apps/server/dist/providers/reasoning/registry.js";
import { composeInstruction } from "../apps/server/dist/orchestrator/instructor.js";
import { buildRequirementInventory } from "../apps/server/dist/domain/requirements/requirement-inventory.js";
import { validatePromptFidelity } from "../apps/server/dist/orchestrator/prompt-fidelity-gate.js";

async function runRealModelTest() {
  console.log("==================================================================");
  console.log("1. REAL-MODEL PROMPT GENERATION TEST");
  console.log("==================================================================");

  const settings = SettingsManager.loadSettings();
  const provider = getActiveProvider();
  console.log(`Configured Provider: ${provider.id} (${provider.displayName})`);
  console.log(`Configured Model: ${provider.getModel()}`);
  console.log(`Timeout: ${settings.localTimeoutMs}ms, Context: ${settings.localContextTokens} tokens\n`);

  // Realistic, nontrivial project specification
  const projectObjective = `
# Multi-Tenant Distributed Event Broker & Audit Service

## Architecture & Technology Decisions
- Architecture: In-memory circular buffer with asynchronous disk snapshotting.
- Storage Engine: SQLite only with WAL mode enabled.
- Framework: Node.js standard library with built-in http and crypto modules.
- Protocol: HTTP/1.1 REST endpoints with JSON payloads.

## Core Functional Features
- Multi-Tenant Topic Partitioning: Support isolated event streams segregated by tenantId.
- Event Ingestion: POST /api/v1/events accepting eventId, tenantId, payload, timestamp, and optional tags.
- Message Deduplication: Enforce idempotency by deduplicating eventId per tenant within a sliding 10-minute window.
- Consumer Polling: GET /api/v1/events/poll with cursor-based pagination and long-polling timeout support.
- Cryptographic Audit Trail: Compute SHA-256 rolling chain hash for each ingested event per tenant.
- Health & Metrics API: GET /api/v1/health returning broker status, queue depth, and memory usage.

## Explicit Negative Constraints
- Strictly SQLite only; do not introduce PostgreSQL, MySQL, Redis, or MongoDB.
- Zero external dependencies: use Node.js standard library only (http, crypto, fs, path). No external npm packages.
- No ORMs (no Prisma, TypeORM, or Sequelize).
- Never log raw event payloads to console or log files.
- Port: Broker must bind exclusively to port 4000.

## Acceptance Criteria
- Assert that duplicate eventIds within 10 minutes return HTTP 409 Conflict.
- Verify that invalid tenant signatures return HTTP 401 Unauthorized.
- Verify that poll returns events in strictly chronological order by sequence number.
- Ensure all automated unit and integration tests pass with exit code 0.
`;

  const taskText = "Implement Multi-Tenant Distributed Event Broker & Audit Service with Deduplication and SQLite persistence.";

  const baselineProfile = {
    isEmpty: false,
    fileCount: 4,
    languages: ["TypeScript", "JavaScript"],
    checks: [{ label: "npm test", command: "npm test" }],
  };

  const startTime = Date.now();
  console.log("Submitting specification to composeInstruction() with live reasoning provider...");

  let capturedInstruction;
  try {
    capturedInstruction = await composeInstruction(provider, {
      projectId: "proj-live-val-1",
      runId: "run-live-val-1",
      taskText,
      projectObjective,
      criteria: [
        "Duplicate eventIds return HTTP 409 Conflict",
        "Invalid tenant returns HTTP 401 Unauthorized",
        "Chronological cursor-based polling operates correctly",
      ],
      profile: baselineProfile,
      files: ["package.json", "src/broker.ts", "src/storage.ts", "test/broker.test.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });
  } catch (err) {
    console.error("FATAL: Live model call failed:", err);
    process.exit(1);
  }

  const durationMs = Date.now() - startTime;
  console.log(`\nLive Model Execution Completed in ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`Instruction Action: ${capturedInstruction.action}`);
  console.log(`Instruction Source: ${capturedInstruction.source} (${capturedInstruction.source === "model" ? "LIVE MODEL GENERATED" : "SYNTHESIZED FALLBACK"})`);
  console.log(`Instruction Rationale: ${capturedInstruction.rationale}`);
  if (capturedInstruction.warning) {
    console.log(`Warning/Quality Gate: ${capturedInstruction.warning}`);
  }

  console.log("\n--- FIDELITY GATE REPORT AT DISPATCH BOUNDARY ---");
  const report = capturedInstruction.fidelityReport;
  if (report) {
    console.log(`Score: ${report.score}/100 | Passed: ${report.passed}`);
    console.log(`Summary: ${report.summary}`);
    console.log(`Missing Requirements (${report.missingRequirements.length}):`, report.missingRequirements.map(m => `[${m.id}] ${m.title}`));
    console.log(`Weakened Constraints (${report.weakenedConstraints.length}):`, report.weakenedConstraints.map(w => `[${w.id}] ${w.constraint}`));
    console.log(`Unsupported Additions (${report.unsupportedAdditions.length}):`, report.unsupportedAdditions.map(u => u.claim));
    console.log(`Unresolved Contradictions (${report.unresolvedContradictions.length}):`, report.unresolvedContradictions.map(c => c.id));
  }

  console.log("\n--- DISPATCHED PROMPT SAMPLE (First 1500 chars) ---");
  console.log(capturedInstruction.instruction.slice(0, 1500));
  console.log("\n--- DISPATCHED PROMPT TAIL (Last 800 chars) ---");
  console.log(capturedInstruction.instruction.slice(-800));
}

runRealModelTest().catch(console.error);
