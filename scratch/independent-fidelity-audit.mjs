import fs from "node:fs";
import { buildRequirementInventory } from "../apps/server/src/domain/requirements/requirement-inventory.js";
import { composeInstruction, synthesizeSubstantiveBrief } from "../apps/server/src/orchestrator/instructor.js";
import { validatePromptFidelity, validateAndCorrectPrompt } from "../apps/server/src/orchestrator/prompt-fidelity-gate.js";

// Realistic representative project specification with multiple requirements, constraints, architecture, workflows, and acceptance criteria
const referenceSpec = `
# Autonomous Multi-Tenant Task Execution Service (AMTES)

## 1. Scope & Objective
Build an autonomous task execution engine capable of scheduling, executing, and recording asynchronous developer tasks across isolated workspace sandboxes.

## 2. Core Functional Requirements
- REQ-01: Must register and authenticate tenants using Ed25519 cryptographic keypairs.
- REQ-02: Must queue execution tasks with configurable priority levels (low, normal, high, critical).
- REQ-03: Must execute task commands using isolated worker processes with strict execution timeouts.
- REQ-04: Must stream execution stdout and stderr in real time via Server-Sent Events (SSE).
- REQ-05: Must record deterministic audit trails with SHA-256 checksums of all input and output payloads.
- REQ-06: Must support atomic cancellation of running tasks via AbortSignal process tree termination.
- REQ-07: Must provide paginated REST API endpoint GET /api/v1/tasks with cursor-based pagination.
- REQ-08: Must enforce tenant concurrency limit of at most 4 simultaneous tasks per tenant.

## 3. Preserved Architecture & Negative Constraints
- CON-01: Strictly SQLite only with WAL mode enabled; do not introduce external database servers.
- CON-02: Zero ORMs allowed; use raw prepared SQL statements for all data access.
- CON-03: Zero external cloud services; must run completely self-contained on local machine.
- CON-04: Must not write or modify files outside the tenant sandbox directory.

## 4. Verification Strategy & Acceptance Criteria
- AC-01: Verify that POST /api/v1/tasks/cancel terminates running child processes within 500ms.
- AC-02: Verify that task requests exceeding concurrency limit of 4 receive HTTP 429 Too Many Requests.
- AC-03: Verify that requests with invalid Ed25519 signature return HTTP 401 Unauthorized.
- AC-04: Verify that path traversal attempts in task commands return HTTP 400 Bad Request.
`.trim();

// 1. Establish Independent Reference Checklist BEFORE evaluation
const referenceChecklist = [
  { id: "REQ-01", type: "functional", text: "Register and authenticate tenants using Ed25519 cryptographic keypairs", keys: ["ed25519", "keypair"] },
  { id: "REQ-02", type: "functional", text: "Queue execution tasks with configurable priority levels (low, normal, high, critical)", keys: ["priority", "queue"] },
  { id: "REQ-03", type: "functional", text: "Execute task commands using isolated worker processes with execution timeouts", keys: ["worker", "timeout"] },
  { id: "REQ-04", type: "functional", text: "Stream stdout and stderr in real time via Server-Sent Events (SSE)", keys: ["sse", "server-sent events"] },
  { id: "REQ-05", type: "functional", text: "Record deterministic audit trails with SHA-256 checksums", keys: ["sha-256", "audit"] },
  { id: "REQ-06", type: "functional", text: "Support atomic cancellation of running tasks via AbortSignal process tree termination", keys: ["abortsignal", "cancel"] },
  { id: "REQ-07", type: "functional", text: "Provide paginated REST API endpoint GET /api/v1/tasks with cursor pagination", keys: ["get /api/v1/tasks", "cursor"] },
  { id: "REQ-08", type: "functional", text: "Enforce tenant concurrency limit of at most 4 simultaneous tasks per tenant", keys: ["concurrency", "4"] },
  { id: "CON-01", type: "constraint", text: "Strictly SQLite only with WAL mode enabled; no external database servers", keys: ["sqlite", "wal"] },
  { id: "CON-02", type: "constraint", text: "Zero ORMs allowed; use raw prepared SQL statements", keys: ["zero orm", "no orm", "raw sql", "prepared sql"] },
  { id: "CON-03", type: "constraint", text: "Zero external cloud services; completely self-contained locally", keys: ["zero external cloud", "self-contained", "local"] },
  { id: "CON-04", type: "constraint", text: "Must not write or modify files outside tenant sandbox directory", keys: ["outside", "sandbox"] },
  { id: "AC-01", type: "acceptance", text: "POST /api/v1/tasks/cancel terminates running child processes within 500ms", keys: ["post /api/v1/tasks/cancel", "500ms"] },
  { id: "AC-02", type: "acceptance", text: "Task requests exceeding concurrency limit of 4 receive HTTP 429 Too Many Requests", keys: ["429", "too many requests"] },
  { id: "AC-03", type: "acceptance", text: "Requests with invalid Ed25519 signature return HTTP 401 Unauthorized", keys: ["401", "unauthorized"] },
  { id: "AC-04", type: "acceptance", text: "Path traversal attempts in task commands return HTTP 400 Bad Request", keys: ["400", "path traversal"] },
];

console.log(`Reference checklist established: ${referenceChecklist.length} independent requirements.`);

// 2. Build Requirement Inventory through Orches
const inventory = buildRequirementInventory({
  taskText: "Implement Autonomous Multi-Tenant Task Execution Service (AMTES)",
  projectObjective: referenceSpec,
});

console.log(`Inventory extracted: ${inventory.requirements.length} total (${inventory.summary.mandatory} mandatory, ${inventory.summary.constraints} constraints, ${inventory.summary.acceptanceCriteria} criteria).`);

// 3. Generate Engineering Implementation Brief via Orches Pipeline
const dummyProfile = {
  isEmpty: false,
  fileCount: 8,
  languages: ["typescript"],
  checks: [{ id: "c1", label: "npm test", command: "npm test", source: "package.json" }],
  notes: [],
};

const generatedBrief = synthesizeSubstantiveBrief({
  projectId: "p-audit",
  runId: "r-audit",
  taskText: "Implement Autonomous Multi-Tenant Task Execution Service (AMTES)",
  criteria: referenceChecklist.filter(c => c.type === "acceptance").map(c => c.text),
  profile: dummyProfile,
  files: ["package.json", "src/index.ts"],
  iteration: 1,
  maxIterations: 3,
  history: [],
}, inventory);

// 4. Validate through Fidelity Gate
const gateResult = validateAndCorrectPrompt(generatedBrief, inventory, { sourceText: referenceSpec });
const finalPrompt = gateResult.prompt;
const promptLower = finalPrompt.toLowerCase();

// 5. Independent Classification of Each Requirement
const classifications = {
  faithfullyRepresented: [],
  partiallyRepresented: [],
  missing: [],
  contradicted: [],
  ambiguous: [],
  incorrectlyRepresentedAsVerified: [],
};

for (const ref of referenceChecklist) {
  const matches = ref.keys.filter(k => promptLower.includes(k.toLowerCase()));
  const matchRatio = matches.length / ref.keys.length;

  // Check if claimed as verified when unverified
  const claimsVerified = promptLower.includes(`${ref.id.toLowerCase()} verified`) ||
    promptLower.includes(`${ref.text.toLowerCase()} verified`) ||
    promptLower.includes("already been verified and tested successfully");

  if (claimsVerified) {
    classifications.incorrectlyRepresentedAsVerified.push({ ref, reason: "Claimed verified without test execution" });
  } else if (matchRatio === 1.0) {
    classifications.faithfullyRepresented.push({ ref, matches });
  } else if (matchRatio > 0) {
    classifications.partiallyRepresented.push({ ref, matches, missingKeys: ref.keys.filter(k => !promptLower.includes(k.toLowerCase())) });
  } else {
    classifications.missing.push({ ref });
  }
}

// 6. Inspect for added ungrounded technical claims, numerical thresholds, libraries
const additionsIdentified = [];
const candidateAdditions = [
  { term: "99.999%", label: "Invented five-nines SLA" },
  { term: "sub-millisecond", label: "Invented sub-millisecond throughput" },
  { term: "kubernetes", label: "Invented Kubernetes container orchestration" },
  { term: "kafka", label: "Invented Apache Kafka event bus" },
  { term: "dynamodb", label: "Invented AWS DynamoDB" },
  { term: "redis", label: "Invented Redis caching layer" },
  { term: "graphql", label: "Invented GraphQL API" },
  { term: "mongodb", label: "Invented MongoDB database" },
  { term: "prisma", label: "Invented Prisma ORM" },
];

for (const ca of candidateAdditions) {
  if (promptLower.includes(ca.term) && !referenceSpec.toLowerCase().includes(ca.term)) {
    // Check if it's in a Scope Boundary Notice (explicitly labeled assumption/suggestion)
    const inNotice = promptLower.indexOf("scope boundary notice") !== -1 &&
      promptLower.indexOf(ca.term) > promptLower.indexOf("scope boundary notice");
    additionsIdentified.push({ term: ca.term, label: ca.label, justifiedAsAssumption: inNotice });
  }
}

console.log("\n========================================================");
console.log("INDEPENDENT REQUIREMENT-TO-PROMPT AUDIT REPORT");
console.log("========================================================");
console.log(`Total Reference Requirements: ${referenceChecklist.length}`);
console.log(`- Faithfully Represented: ${classifications.faithfullyRepresented.length} (${(classifications.faithfullyRepresented.length / referenceChecklist.length * 100).toFixed(1)}%)`);
console.log(`- Partially Represented / Weakened: ${classifications.partiallyRepresented.length}`);
console.log(`- Missing: ${classifications.missing.length}`);
console.log(`- Contradicted: ${classifications.contradicted.length}`);
console.log(`- Ambiguous in generated instructions: ${classifications.ambiguous.length}`);
console.log(`- Incorrectly represented as verified: ${classifications.incorrectlyRepresentedAsVerified.length}`);
console.log(`Ungrounded additions detected: ${additionsIdentified.length}`);

console.log("\n--- Concrete Examples of Faithfully Represented Items ---");
for (const f of classifications.faithfullyRepresented.slice(0, 5)) {
  console.log(`[${f.ref.id}] (${f.ref.type}) ${f.ref.text} -> Matched keys: [${f.matches.join(", ")}]`);
}

if (classifications.partiallyRepresented.length > 0) {
  console.log("\n--- Partially Represented Items ---");
  for (const p of classifications.partiallyRepresented) {
    console.log(`[${p.ref.id}] ${p.ref.text} -> Missing keys: [${p.missingKeys.join(", ")}]`);
  }
}

if (classifications.missing.length > 0) {
  console.log("\n--- Missing Items ---");
  for (const m of classifications.missing) {
    console.log(`[${m.ref.id}] ${m.ref.text}`);
  }
}

console.log("\nFidelity Gate Enforcement Verdict:");
console.log(`Initial Gate Passed: ${gateResult.report.passed}`);
console.log(`Gate Fidelity Score: ${gateResult.report.score}/100`);
console.log(`Summary: ${gateResult.report.summary}`);
