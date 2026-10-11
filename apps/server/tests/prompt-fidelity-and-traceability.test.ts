import { describe, it, expect } from "vitest";
import {
  buildRequirementInventory,
  updateRequirementStatuses,
  type RequirementInventory,
} from "../src/domain/requirements/requirement-inventory.js";
import {
  validatePromptFidelity,
  validateAndCorrectPrompt,
} from "../src/orchestrator/prompt-fidelity-gate.js";
import {
  composeInstruction,
  synthesizeSubstantiveBrief,
  synthesizeRepairBrief,
  isMetaInstruction,
} from "../src/orchestrator/instructor.js";
import { getProjectProfile } from "../src/domain/profiles/project-profiles.js";
import { ScriptedProvider } from "./helpers.js";
import type { ProjectProfile as InspectorProfile } from "../src/workspace/project-inspector.js";

const dummyWorkspace: InspectorProfile = {
  isEmpty: false,
  fileCount: 5,
  languages: ["typescript"],
  checks: [{ id: "c1", label: "npm test", command: "npm test", source: "package.json" }],
  notes: [],
};

describe("Section 7 Regression Suite: Project-Aware Prompt Generation and Source Fidelity", () => {
  // Case 1: Short, broad project request produces useful, project-specific engineering instructions
  // with reasonable assumptions clearly distinguished
  it("Case 1: short broad project request produces useful engineering instructions with reasonable assumptions distinguished", async () => {
    const taskText = "Build a Task Management API";
    const inventory = buildRequirementInventory({
      taskText,
    });

    expect(inventory.requirements.length).toBeGreaterThanOrEqual(1);
    expect(inventory.summary.mandatory).toBeGreaterThanOrEqual(1);

    const brief = synthesizeSubstantiveBrief(
      {
        projectId: "p1",
        runId: "r1",
        taskText,
        criteria: ["Create tasks with title and priority", "Filter tasks by status"],
        profile: dummyWorkspace,
        files: ["index.ts"],
        iteration: 1,
        maxIterations: 3,
        history: [],
      },
      inventory
    );

    expect(brief).toContain("## 1. Executive Objective & Scope");
    expect(brief).toContain("Build a Task Management API");
    expect(brief).toContain("## 2. Working Instructions for Antigravity Agent");
    expect(brief).toContain("## 3. Preserved Constraints & Architecture Boundaries");
    expect(brief).toContain("## 5. Functional Specifications & Domain Workflows");
    expect(brief).toContain("## 8. Verification Strategy & Acceptance Criteria");
    expect(brief).toContain("Create tasks with title and priority");
  });

  // Case 2: Detailed specification preserves its explicit features, constraints, architecture, and acceptance conditions
  it("Case 2: detailed specification preserves explicit features, constraints, architecture, and acceptance conditions", async () => {
    const spec = `
# User Authentication Service
## Features
- Must implement password hashing using Argon2id algorithm.
- Must issue signed JWT tokens with 15-minute expiration upon valid login.

## Constraints
- Strictly SQLite only; do not introduce external database servers.
- No ORMs allowed; use direct SQL statements.

## Architecture
- Clean modular architecture separating routing, domain auth logic, and database access.

## Acceptance Criteria
- Verify that POST /api/auth/login returns 200 and JWT on valid credentials.
- Verify that POST /api/auth/login returns 401 on incorrect password.
    `.trim();

    const inventory = buildRequirementInventory({
      taskText: "Implement User Authentication Service",
      projectObjective: spec,
    });

    // Check inventory extraction
    const constraints = inventory.requirements.filter((r) => r.classification === "explicit_constraint");
    expect(constraints.some((c) => c.description.toLowerCase().includes("sqlite"))).toBe(true);
    expect(constraints.some((c) => c.description.toLowerCase().includes("no orm"))).toBe(true);

    const mandatory = inventory.requirements.filter((r) => r.classification === "mandatory_requirement");
    expect(mandatory.some((m) => m.description.toLowerCase().includes("argon2id"))).toBe(true);

    const provider = new ScriptedProvider();
    provider.enqueue("repair_diagnosis", () =>
      JSON.stringify({
        action: "instruct",
        instruction: `
# Implementation Engineering Brief: User Authentication Service
## Objective
Implement User Authentication Service with Argon2id password hashing and signed JWT tokens with 15-minute expiration.
## Architecture & Boundaries
Clean modular architecture separating routing, domain auth logic, and direct SQL access.
STRICT CONSTRAINT: Strictly SQLite only. No ORMs allowed; use raw SQL.
## Functional Specifications
- [REQ-001] Password hashing using Argon2id algorithm.
- [REQ-002] Issue signed JWT tokens with 15-minute expiration upon valid login.
## Acceptance Criteria
- POST /api/auth/login returns 200 and JWT on valid credentials.
- POST /api/auth/login returns 401 on incorrect password.
Run npm test to verify.
        `.trim(),
        rationale: "Comprehensive faithful brief",
      })
    );

    const result = await composeInstruction(provider, {
      projectId: "p2",
      runId: "r2",
      taskText: "Implement User Authentication Service",
      projectObjective: spec,
      criteria: ["POST /api/auth/login returns 200 on valid credentials", "POST /api/auth/login returns 401 on invalid"],
      profile: dummyWorkspace,
      files: ["package.json"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(result.action).toBe("instruct");
    expect(result.instruction).toContain("Argon2id");
    expect(result.instruction).toContain("SQLite");
    expect(result.instruction).toContain("No ORMs");
    expect(result.instruction).toContain("401");
    expect(result.fidelityReport?.passed).toBe(true);
  });

  // Case 3: Long specification with requirements distributed across multiple sections does not silently lose requirements
  it("Case 3: long specification with requirements across multiple sections does not silently lose requirements", () => {
    const longDocument = `
# Enterprise Document Ingestion & Search Engine

## 1. Document Ingestion Pipeline
- Ingest PDF, DOCX, and Markdown documents from input directory.
- Extract raw text and metadata while sanitizing embedded control characters.
- Generate deterministic SHA-256 document checksums for deduplication.

## 2. Tokenization & Indexing
- Tokenize document text into n-grams using standard tokenizer.
- Build an inverted index mapping tokens to document offsets.
- Support phrase search and boolean query operators (AND, OR, NOT).

## 3. Storage & Persistence
- Strictly store indexed posting lists in local SQLite database.
- Atomic transaction commits on batch index updates.

## 4. Query & Search API
- Provide HTTP endpoint GET /api/search with query string parameter.
- Return top-20 search results ranked by BM25 scoring algorithm.
- Paginate results with cursor-based pagination.

## 5. Security & Access Control
- Restrict file reading exclusively to configured documents directory.
- Reject path traversal attempts with HTTP 400 Bad Request.

## 6. Verification & Acceptance
- Verify that duplicate documents are ignored based on SHA-256 checksum.
- Verify that boolean queries return matching document records.
- Verify that path traversal returns HTTP 400 Bad Request.
    `.trim();

    const inventory = buildRequirementInventory({
      taskText: "Implement Document Ingestion and Search Engine",
      projectObjective: longDocument,
    });

    // Must have extracted requirements from early, middle, and late sections
    expect(inventory.requirements.length).toBeGreaterThanOrEqual(12);
    expect(inventory.requirements.some((r) => r.description.includes("SHA-256"))).toBe(true);
    expect(inventory.requirements.some((r) => r.description.includes("BM25 scoring"))).toBe(true);
    expect(inventory.requirements.some((r) => r.description.includes("path traversal"))).toBe(true);

    // If an instruction omits BM25 scoring and path traversal, fidelity check must flag them
    const incompletePrompt = `
# Implementation Prompt
Build the search engine with PDF ingestion and SQLite inverted index.
Run npm test to verify.
    `;

    const report = validatePromptFidelity(incompletePrompt, inventory);
    expect(report.passed).toBe(false);
    expect(report.missingRequirements.some((m) => m.title.includes("BM25") || m.title.includes("traversal"))).toBe(true);

    // Bounded correction must re-inject the missing mandatory requirements
    const corrected = validateAndCorrectPrompt(incompletePrompt, inventory);
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("## Mandatory Requirements (Traceability Enforcement)");
    expect(corrected.prompt).toContain("BM25");
  });

  // Case 4: Unsupported implementation details and invented performance guarantees are flagged or removed
  it("Case 4: unsupported implementation details and invented performance guarantees are flagged or removed", () => {
    const spec = "Build a customer feedback collector API with SQLite persistence.";
    const inventory = buildRequirementInventory({
      taskText: spec,
    });

    // Candidate prompt hallucinating 99.999% uptime, sub-millisecond latency under 100k, and FPGA acceleration
    const hallucinatedPrompt = `
# Customer Feedback Collector API
Implement the collector API with SQLite.
The system must guarantee 99.999% availability SLA.
Must achieve sub-millisecond latency under 100k requests/sec.
Requires FPGA acceleration for high-throughput packet processing.
Must deploy to a Kubernetes cluster.
    `;

    const report = validatePromptFidelity(hallucinatedPrompt, inventory, { sourceText: spec });
    expect(report.passed).toBe(false);
    expect(report.unsupportedAdditions.length).toBeGreaterThanOrEqual(3);
    expect(report.unsupportedAdditions.some((u) => u.category === "invented_guarantee")).toBe(true);
    expect(report.unsupportedAdditions.some((u) => u.category === "unsupported_hardware_or_api")).toBe(true);

    // Correction must neutralize the claims
    const corrected = validateAndCorrectPrompt(hallucinatedPrompt, inventory, { sourceText: spec });
    expect(corrected.prompt).not.toContain("99.999%");
    expect(corrected.prompt).toContain("Scope Boundary Notice (Unsupported Additions Reclassified)");
    expect(corrected.prompt).toContain("standard production availability");
  });

  // Case 5: Contradictory requirements are surfaced instead of silently reconciled
  it("Case 5: contradictory requirements are surfaced instead of silently reconciled", () => {
    const contradictorySpec = `
- Section A: Use strictly PostgreSQL database engine for data storage.
- Section B: SQLite only; no external database servers allowed.
    `.trim();

    const inventory = buildRequirementInventory({
      taskText: "Database service implementation",
      projectObjective: contradictorySpec,
    });

    expect(inventory.summary.contradictions).toBeGreaterThanOrEqual(1);
    const contradiction = inventory.requirements.find((r) => r.classification === "unresolved_contradiction");
    expect(contradiction).toBeDefined();
    expect(contradiction?.description).toMatch(/postgresql|sqlite/i);

    // When synthesizing brief, contradiction must be surfaced under unresolved section
    const brief = synthesizeSubstantiveBrief(
      {
        projectId: "p5",
        runId: "r5",
        taskText: "Database service implementation",
        projectObjective: contradictorySpec,
        criteria: ["Data is persisted"],
        profile: dummyWorkspace,
        files: [],
        iteration: 1,
        maxIterations: 3,
        history: [],
      },
      inventory
    );

    expect(brief).toContain("## 6. Unresolved Specification Contradictions & Ambiguities");
    expect(brief).toContain(contradiction?.id);
  });

  // Case 6: The three autonomy modes materially affect the generated instructions
  it("Case 6: the three autonomy modes materially affect the generated instructions", async () => {
    const taskText = "Implement REST API for notes service";
    const inventory = buildRequirementInventory({ taskText });

    const modes = ["strict_blueprint_adherence", "creative_within_constraints", "creative_exploration"] as const;
    const generatedBriefs: string[] = [];

    for (const mode of modes) {
      const brief = synthesizeSubstantiveBrief(
        {
          projectId: `p6-${mode}`,
          runId: `r6-${mode}`,
          taskText,
          criteria: ["CRUD operations for notes"],
          profile: dummyWorkspace,
          autonomyMode: mode,
          files: [],
          iteration: 1,
          maxIterations: 3,
          history: [],
        },
        inventory
      );
      generatedBriefs.push(brief);
    }

    // Each mode must produce distinct directives
    expect(generatedBriefs[0]).toContain("Strict instruction & blueprint adherence");
    expect(generatedBriefs[0]).toContain("discourage unsolicited features");

    expect(generatedBriefs[1]).toContain("Creative within constraints");
    expect(generatedBriefs[1]).toContain("Encourage innovative, robust");

    expect(generatedBriefs[2]).toContain("Creative exploration");
    expect(generatedBriefs[2]).toContain("Grant greater autonomy in architectural design");

    // All 3 briefs must be mutually distinct
    expect(generatedBriefs[0]).not.toEqual(generatedBriefs[1]);
    expect(generatedBriefs[1]).not.toEqual(generatedBriefs[2]);
  });

  // Case 7: Different project profiles guide relevant practices without injecting unrelated features
  it("Case 7: different project profiles guide relevant practices without injecting unrelated features", () => {
    const cliProfile = getProjectProfile("cli_tool");
    const webProfile = getProjectProfile("backend");

    const taskText = "Add telemetry logger";
    const inventory = buildRequirementInventory({ taskText });

    const cliBrief = synthesizeSubstantiveBrief(
      {
        projectId: "p7-cli",
        runId: "r7-cli",
        taskText,
        criteria: ["Logs telemetry"],
        profile: dummyWorkspace,
        profileDefinition: cliProfile,
        files: [],
        iteration: 1,
        maxIterations: 3,
        history: [],
      },
      inventory
    );

    const webBrief = synthesizeSubstantiveBrief(
      {
        projectId: "p7-web",
        runId: "r7-web",
        taskText,
        criteria: ["Logs telemetry"],
        profile: dummyWorkspace,
        profileDefinition: webProfile,
        files: [],
        iteration: 1,
        maxIterations: 3,
        history: [],
      },
      inventory
    );

    // CLI profile emphasizes stdout/stderr and CLI flags
    expect(cliBrief).toContain("CLI / Developer Tool");
    expect(cliBrief).toContain("exit codes");

    // Web profile emphasizes HTTP APIs, routing, and error envelopes
    expect(webBrief).toContain("Backend / API Service");
    expect(webBrief).toContain("error envelopes");
  });

  // Case 8: Repair prompts reflect actual outstanding work and verification evidence without repeating initial prompt
  it("Case 8: repair prompts reflect actual outstanding work and verification evidence", () => {
    const taskText = "Build JSON parser";
    const inventory = buildRequirementInventory({ taskText });

    const repairBrief = synthesizeRepairBrief(
      {
        projectId: "p8",
        runId: "r8",
        taskText,
        criteria: ["Parses valid JSON", "Throws ParseError on invalid JSON"],
        profile: dummyWorkspace,
        files: ["src/parser.ts"],
        iteration: 2,
        maxIterations: 3,
        history: [
          {
            iteration: 1,
            instruction: "Initial instruction to build parser",
            agentReply: "Implemented parser",
            agentState: "finished",
            changedFiles: ["src/parser.ts"],
            diffExcerpt: "+export function parse() {}",
            checks: [
              {
                label: "npm test",
                status: "failed",
                output: "AssertionError: expected 'null' to throw ParseError on unexpected token",
              },
            ],
            blockers: ["Check npm test failed with exit code 1"],
            reviewer: "Tests failed on error handling",
          },
        ],
      },
      inventory
    );

    // Must contain iteration evidence, not verbatim initial brief
    expect(repairBrief).toContain("Corrective Engineering Brief (Iteration 2 of 3)");
    expect(repairBrief).toContain("**Files Modified So Far**: src/parser.ts");
    expect(repairBrief).toContain("AssertionError: expected 'null' to throw ParseError");
    expect(repairBrief).toContain("Check npm test failed with exit code 1");
    expect(repairBrief).toContain("## 4. Targeted Corrective Actions");
  });

  // Case 9: Model errors or unavailable evidence never result in fabricated validation success
  it("Case 9: model errors or unavailable evidence never result in fabricated validation success", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue("repair_diagnosis", () => {
      // Return shallow meta-instruction that does not implement the actual brief
      return JSON.stringify({
        action: "instruct",
        instruction: "Construct a brief for the agent to build the system.",
        rationale: "Delegated to agent",
      });
    });

    const result = await composeInstruction(provider, {
      projectId: "p9",
      runId: "r9",
      taskText: "Build Cache Service",
      criteria: ["Sets and gets cache keys"],
      profile: dummyWorkspace,
      files: [],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    // The shallow meta-instruction must NOT be accepted as a valid model brief
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("The reasoning model returned a meta-instruction");

    // Verify requirement status without test evidence remains unverified
    const inventory = buildRequirementInventory({ taskText: "Build Cache Service" });
    const updated = updateRequirementStatuses(inventory, {
      filesChanged: ["src/cache.ts"],
      passedChecks: [], // No checks passed!
      failedChecks: [],
    });
    // Without passing checks, status is implemented_unverified, never verified
    expect(updated.requirements[0].status).toBe("implemented_unverified");
    expect(updated.summary.byStatus.verified).toBe(0);
  });

  // Case 10: Prompt validation does not depend on specific project names, domain keywords, or hardcoded example requirements
  it("Case 10: prompt validation operates generically across arbitrary novel domains without keyword dependencies", () => {
    const arbitraryDomainSpec = `
# Satellite Telemetry Packet Demuxer
## Specifications
- Must decode CCSDS 133.0-B-2 space packets from raw byte stream.
- Must extract 11-bit Application Process Identifier (APID) from packet primary header.
- Must verify 16-bit Packet Sequence Control counter for continuity.

## Explicit Constraints
- Strictly zero external dependencies; must use standard library only.
- Fixed frame buffer size must not exceed 2048 bytes.

## Acceptance Criteria
- Verify APID extraction matches expected telemetry stream id.
- Reject corrupted packets with sequence counter jumps.
    `.trim();

    const inventory = buildRequirementInventory({
      taskText: "Implement Satellite Telemetry Packet Demuxer",
      projectObjective: arbitraryDomainSpec,
    });

    // Must extract domain-specific requirements without any hardcoded dictionary
    expect(inventory.requirements.length).toBeGreaterThanOrEqual(5);
    expect(inventory.requirements.some((r) => r.description.includes("CCSDS 133.0-B-2"))).toBe(true);
    expect(inventory.requirements.some((r) => r.description.includes("APID"))).toBe(true);

    const constraints = inventory.requirements.filter((r) => r.classification === "explicit_constraint");
    expect(constraints.some((c) => c.description.includes("zero external dependencies"))).toBe(true);
    expect(constraints.some((c) => c.description.includes("2048 bytes"))).toBe(true);

    // If an instruction respects these requirements, fidelity validates successfully
    const faithfulPrompt = `
# Implementation Engineering Brief: Satellite Telemetry Packet Demuxer
## Objective
Implement Satellite Telemetry Packet Demuxer decoding CCSDS 133.0-B-2 space packets.
## Constraints
- [REQ-003] STRICT CONSTRAINT: Strictly zero external dependencies; standard library only.
- [REQ-004] STRICT CONSTRAINT: Fixed frame buffer size must not exceed 2048 bytes.
## Functional Specifications
- [REQ-001] Decode CCSDS 133.0-B-2 space packets from raw byte stream.
- [REQ-002] Extract 11-bit Application Process Identifier (APID) from packet primary header.
- [REQ-005] Verify 16-bit Packet Sequence Control counter for continuity.
## Acceptance Criteria
- Verify APID extraction matches expected telemetry stream id.
- Reject corrupted packets with sequence counter jumps.
    `.trim();

    const report = validatePromptFidelity(faithfulPrompt, inventory, { sourceText: arbitraryDomainSpec });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.missingRequirements).toHaveLength(0);
    expect(report.weakenedConstraints).toHaveLength(0);
  });
});
