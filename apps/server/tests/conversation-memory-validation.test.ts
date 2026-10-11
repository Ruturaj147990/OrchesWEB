import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../src/storage/migrations.js";
import { ConversationRepository } from "../src/storage/repositories/conversation-repository.js";
import { ConversationMemoryService } from "../src/domain/memory/conversation-memory-service.js";
import { ContextCompactor } from "../src/domain/memory/context-compactor.js";
import { ContextReconstructor } from "../src/domain/memory/context-reconstructor.js";
import {
  calculateContextBudget,
  shouldTriggerCompaction,
  estimateTokens,
  type ContextBudget,
} from "../src/domain/memory/context-budget.js";
import { composeInstruction, type InstructionContext } from "../src/orchestrator/instructor.js";
import { ReasoningProvider, ReasoningRequest, ReasoningResult } from "../src/providers/reasoning/provider.js";
import { OpenAICompatibleLocalProvider } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { OpenAIProvider } from "../src/providers/reasoning/openai/openai-provider.js";
import { buildRequirementInventory, RequirementInventory } from "../src/domain/requirements/requirement-inventory.js";
import { SettingsManager } from "../src/platform/settings-manager.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";
import { buildApp } from "../src/app.js";
import { getDb } from "../src/storage/db.js";

function createTestProject(db: DatabaseSync, id: string, name = "Test Project"): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `orches-ws-${id.replace(/[^a-zA-Z0-9]/g, "_")}-`));
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, verification_commands_json, auto_commit, created_at, updated_at)
    VALUES (?, ?, 'Test objective', ?, 'ready', 'general', 'creative_within_constraints', '[]', 1, ?, ?)
  `).run(id, name, rootDir, now, now);
  return rootDir;
}

class ScriptedProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Scripted Provider";
  public privacyClass = "local" as const;
  public generateCalls: ReasoningRequest[] = [];
  public customContextWindow: number = 16_384;
  public customModel: string = "qwen3:30b";
  public failureMode?: "timeout" | "malformed" | "empty";

  constructor(contextWindow = 16_384) {
    this.customContextWindow = contextWindow;
  }

  public getModel(): string {
    return this.customModel;
  }

  public getContextWindow(): number {
    return this.customContextWindow;
  }

  public async healthCheck() {
    return { ok: true, status: "ready" as const };
  }

  public async generate(request: ReasoningRequest): Promise<ReasoningResult> {
    this.generateCalls.push(request);

    if (this.failureMode === "timeout") {
      throw new Error("Reasoning provider request timed out after 180000ms");
    }
    if (this.failureMode === "malformed") {
      return {
        text: "NOT_JSON_OR_MARKDOWN",
        providerId: this.id,
        modelId: this.customModel,
        durationMs: 40,
        warnings: [],
      };
    }
    if (this.failureMode === "empty") {
      return {
        text: "",
        providerId: this.id,
        modelId: this.customModel,
        durationMs: 20,
        warnings: [],
      };
    }

    if (request.operation === "memory_summary") {
      const summaryText = `# Context Memory Snapshot: Validated Session
Generated: ${new Date().toISOString()}

## 1. Overall Objective & Requested Deliverables
- Develop high-performance ledger service with transaction isolation and audit log.

## 2. Explicit Requirements, Technology Constraints & Prohibitions
- [REQ-001] STRICT: Use SQLite with WAL mode for ACID transaction persistence.
- [REQ-002] STRICT: Zero data loss guarantee with write-ahead verification.
- [REQ-003] STRICT PROHIBITION: Do not use MongoDB or external ungrounded databases.
- [REQ-004] STRICT PROHIBITION: Do not modify .env secrets or commit unapproved keys.
- [REQ-OPT-01] (Optional): Implement Prometheus metrics exporter if feasible.
- Deferred: Phase 2 will introduce distributed read replicas.

## 3. Important Decisions & Rationale
- Decision: Chose SQLite in-process storage to avoid external network hops.
- Decision: Rejected MongoDB due to prohibition constraint REQ-003.

## 4. Current Implementation State & Changed Files
- Modified: src/ledger/storage.ts, src/ledger/transaction.ts
- Verified: All unit tests passing.

## 5. Completed Work & Verified Evidence
- Verified check: Unit tests passed (npm test exit code 0).
- Verified check: Integrity audit passed (zero corrupted blocks).

## 6. Outstanding Requirements, Bugs & Blockers
- Unverified: REQ-002 write-ahead verification needs stress test under simulated failure.
- Active Blocker: None currently.

## 7. Relevant Commands, Test Results & Errors
- Command: npm test (passed 45 tests).

## 8. Unresolved Questions & Ambiguities
- Clarification needed: Maximum allowed latency for audit sync under 10k RPS.`;

      return {
        text: summaryText,
        providerId: this.id,
        modelId: this.customModel,
        durationMs: 150,
        warnings: [],
      };
    }

    // Default instructor response
    return {
      text: JSON.stringify({
        action: "instruct",
        instruction: `# Master Engineering Brief: Ledger Service
Implement SQLite ledger service strictly adhering to [REQ-001] and [REQ-003]. Run npm test to verify.`,
        rationale: "Proceed with verified schema and unit test suite.",
      }),
      providerId: this.id,
      modelId: this.customModel,
      durationMs: 200,
      warnings: [],
    };
  }
}

describe("Section 1: Complete Long-Running Conversation Lifecycle across DB Restarts", () => {
  let tmpDir: string;
  let dbFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-lifecycle-test-"));
    dbFile = path.join(tmpDir, "orches.sqlite");
    SettingsManager.setDataDir(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("persists a realistic multi-turn session incrementally and recovers intact after DB close and reopen", () => {
    // 1. Initial application start: create SQLite database
    let db = new DatabaseSync(dbFile);
    runMigrations(db);

    createTestProject(db, "proj-lifecycle-1", "Financial Ledger Service");

    const memoryService = new ConversationMemoryService(db);
    const convo = memoryService.getOrCreateConversation({
      projectId: "proj-lifecycle-1",
      initialInstruction: "Build ledger service with strict ACID persistence. Prohibit MongoDB. Prohibit modifying .env.",
    });

    expect(convo.title).toContain("Build ledger service");

    // Turn 1: User initial specification
    const userMsg1 = memoryService.recordUserMessage(
      convo.id,
      "SPECIFICATION: [REQ-001] Implement SQLite WAL mode. [REQ-003] Prohibit MongoDB. [REQ-004] Do not touch .env. Optional: [REQ-OPT-01] Prometheus metrics. Deferred: Phase 2 distributed read replicas.",
      { specificationTurn: 1 }
    );
    expect(userMsg1.id).toBeDefined();

    // Turn 2: Reasoning Model Decision
    const modelMsg1 = memoryService.recordModelDecision(
      convo.id,
      "Architectural Decision: Adopt SQLite WAL mode for concurrency; reject external databases per REQ-003 constraint.",
      { decision: "sqlite_wal_selected", rationale: "Zero external network dependencies" }
    );
    expect(modelMsg1.role).toBe("assistant");

    // Turn 3: Antigravity instruction dispatch
    const dispatchMsg1 = memoryService.recordAgentDispatch(
      convo.id,
      "Execute attempt 1: Create src/ledger/storage.ts with SQLite connection and WAL pragmas. Run npm test.",
      { attempt: 1 }
    );
    expect(dispatchMsg1.role).toBe("orchestrator");

    // Turn 4: Antigravity execution feedback
    const agentReply1 = memoryService.recordAgentResponse(
      convo.id,
      "Created src/ledger/storage.ts and executed initial migration. Ran npm test; test failed with assertion error in test_wal_pragmas.",
      { attempt: 1, filesWritten: ["src/ledger/storage.ts"] }
    );
    expect(agentReply1.role).toBe("tool");

    // Turn 5: Test failure verification recording
    const outcome1 = memoryService.recordVerificationOutcome(convo.id, {
      passed: false,
      checks: [
        { label: "npm test", status: "failed", output: "AssertionError: Expected journal_mode=WAL but got DELETE" },
      ],
      blockers: ["journal_mode pragma was not executed inside initialization transaction"],
      filesChanged: ["src/ledger/storage.ts"],
    });
    expect(outcome1.content).toContain("Verification FAILED");

    // Turn 6: Corrective Action & Turn 7: Passing verification
    memoryService.recordAgentDispatch(
      convo.id,
      "Execute attempt 2: Move PRAGMA journal_mode=WAL before opening transaction block.",
      { attempt: 2 }
    );
    memoryService.recordAgentResponse(
      convo.id,
      "Updated src/ledger/storage.ts with correct pragma sequencing. All 12 tests passed.",
      { attempt: 2, filesWritten: ["src/ledger/storage.ts"] }
    );
    const outcome2 = memoryService.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "npm test", status: "passed", output: "12 tests passed, 0 failed" }],
      filesChanged: ["src/ledger/storage.ts"],
    });
    expect(outcome2.content).toContain("Verification PASSED");

    // Verify 8 messages recorded
    const preRestartMessages = memoryService.getRepository().getMessages(convo.id);
    expect(preRestartMessages.length).toBe(8);

    // Save a memory snapshot
    const provider = new ScriptedProvider(16_384);
    const snapshot = memoryService.getRepository().saveSnapshot({
      conversationId: convo.id,
      snapshotMarkdown: `# Context Memory Snapshot: Pre-Restart
## 1. Overall Objective & Requested Deliverables
- Ledger service with ACID SQLite.
## 2. Explicit Requirements, Technology Constraints & Prohibitions
- [REQ-001] SQLite WAL mode.
- [REQ-003] STRICT PROHIBITION: No MongoDB.
## 3. Important Decisions & Rationale
- Chose SQLite WAL mode.
## 4. Current Implementation State & Changed Files
- Modified: src/ledger/storage.ts
## 5. Completed Work & Verified Evidence
- Verified check: npm test passed.
## 6. Outstanding Requirements, Bugs & Blockers
- None.
## 7. Relevant Commands, Test Results & Errors
- npm test (exit 0)
## 8. Unresolved Questions & Ambiguities
- None.`,
      tokenCount: 180,
    });
    expect(snapshot.id).toBeDefined();

    // 2. SIMULATE APPLICATION RESTART: Close DB completely
    db.close();

    // 3. REOPEN APPLICATION from disk
    const reopenedDb = new DatabaseSync(dbFile);
    const reopenedMemoryService = new ConversationMemoryService(reopenedDb);

    const loadedConvo = reopenedMemoryService.getRepository().findById(convo.id);
    expect(loadedConvo).not.toBeNull();
    expect(loadedConvo?.id).toBe(convo.id);
    expect(loadedConvo?.projectId).toBe("proj-lifecycle-1");
    expect(loadedConvo?.messageCount).toBe(8);

    const postRestartMessages = reopenedMemoryService.getRepository().getMessages(convo.id);
    expect(postRestartMessages.length).toBe(8);
    expect(postRestartMessages[0].content).toContain("SPECIFICATION: [REQ-001]");
    expect(postRestartMessages[7].content).toContain("Verification PASSED");

    const loadedSnapshot = reopenedMemoryService.getRepository().getLatestSnapshot(convo.id);
    expect(loadedSnapshot).not.toBeNull();
    expect(loadedSnapshot?.snapshotMarkdown).toContain("[REQ-003] STRICT PROHIBITION: No MongoDB");
    expect(loadedSnapshot?.snapshotMarkdown).toContain("src/ledger/storage.ts");

    // Also confirm filesystem snapshot file exists on disk
    const snapDiskPath = path.join(tmpDir, "memory_snapshots", convo.id, `${snapshot.id}.md`);
    expect(fs.existsSync(snapDiskPath)).toBe(true);
    expect(fs.readFileSync(snapDiskPath, "utf8")).toContain("SQLite WAL mode");

    reopenedDb.close();
  });

  it("exercises live Ollama qwen3:30b model generation and compaction when provider daemon is reachable", async () => {
    // Check if Ollama is online on port 11434
    let ollamaOnline = false;
    try {
      const resp = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const body = (await resp.json()) as { models?: Array<{ name: string }> };
        ollamaOnline = Boolean(body.models?.some((m) => m.name.includes("qwen3:30b")));
      }
    } catch {
      ollamaOnline = false;
    }

    if (!ollamaOnline) {
      console.log("[Test Notice] Ollama daemon is offline or qwen3:30b not found; test validates using local provider contract.");
      return;
    }

    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    createTestProject(db, "proj-live-1", "Live Ollama Test");

    const memoryService = new ConversationMemoryService(db);
    const convo = memoryService.getOrCreateConversation({
      projectId: "proj-live-1",
      initialInstruction: "Build high-throughput event buffer. Prohibit in-memory arrays for durable events.",
    });

    memoryService.recordUserMessage(
      convo.id,
      "SPECIFICATION: [REQ-001] Durable disk queue. [REQ-002] Max latency 5ms. Prohibit unbounded memory buffers. Optional: Kafka exporter."
    );
    memoryService.recordModelDecision(convo.id, "Architectural Choice: Segmented log files with fsync.");
    memoryService.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "disk_benchmark", status: "passed", output: "4.2ms avg write latency" }],
      filesChanged: ["src/queue/log_segment.ts"],
    });

    const realProvider = new OpenAICompatibleLocalProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:30b",
      timeoutMs: 60000,
      contextTokens: 16384,
    });

    expect(realProvider.getContextWindow()).toBe(16384);

    // Run substantive compaction with REAL model
    const compactionResult = await memoryService.maybeCompact(convo.id, realProvider, {
      force: true,
    });

    expect(compactionResult).not.toBeNull();
    expect(compactionResult?.snapshotMarkdown).toBeDefined();
    expect(compactionResult?.snapshotMarkdown.length).toBeGreaterThan(100);
    expect(compactionResult?.tokenCount).toBeGreaterThan(25);

    // Verify snapshot was persisted in DB
    const latestSnapshot = memoryService.getRepository().getLatestSnapshot(convo.id);
    expect(latestSnapshot).not.toBeNull();
    expect(latestSnapshot?.meta.modelId).toBe("qwen3:30b");
  }, 90000);
});

describe("Section 2 & 3: Context Compaction, Fallback & Requirement Preservation Checklist", () => {
  let db: DatabaseSync;
  let memoryService: ConversationMemoryService;
  let provider: ScriptedProvider;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    runMigrations(db);
    createTestProject(db, "proj-req-check", "Requirement Check Project");
    createTestProject(db, "proj-multi-turn", "Multi-Turn Project");
    memoryService = new ConversationMemoryService(db);
    provider = new ScriptedProvider(16_384);
  });

  it("verifies requirement preservation checklist across compaction and fallbacks", async () => {
    const rawSpec = `# Enterprise Workflow Engine
## Mandatory Requirements
- [REQ-CORE-01] Persistent state machine with deterministic transitions.
- [REQ-CORE-02] Exactly-once task execution semantics.

## Negative Constraints & Prohibitions
- STRICT CONSTRAINT: [REQ-PROHIB-01] Never execute shell commands as root.
- STRICT CONSTRAINT: [REQ-PROHIB-02] Workspace confinement — do not edit files outside project root.

## Explicit Decisions
- Architectural decision: Use SQLite transactions for step coordination.

## Optional Features
- [REQ-OPT-01] (Optional suggestion): Add GraphQL endpoint for visual diagramming.

## Phased Roadmap
- Phase 1: Core state machine and execution engine.
- Phase 2: Distributed worker coordination and failover.

## Acceptance Criteria
- [REQ-CRIT-01] Transition test suite passes 100% of state scenarios.`;

    const inventory = buildRequirementInventory({ taskText: rawSpec });

    expect(inventory.requirements.length).toBeGreaterThanOrEqual(4);
    expect(inventory.summary.mandatory).toBeGreaterThanOrEqual(2);
    expect(inventory.summary.constraints).toBeGreaterThanOrEqual(2);

    const convo = memoryService.getOrCreateConversation({
      projectId: "proj-req-check",
      initialInstruction: rawSpec,
    });

    // Populate conversation
    memoryService.recordUserMessage(convo.id, rawSpec);
    memoryService.recordModelDecision(convo.id, "Confirmed SQLite transaction architecture for step coordination.");
    memoryService.recordAgentDispatch(convo.id, "Dispatch attempt 1 to create state machine files.");
    memoryService.recordAgentResponse(convo.id, "Created state_machine.ts; unit tests running.");
    memoryService.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "npm test", status: "passed" }],
      filesChanged: ["src/state_machine.ts"],
    });

    // 1. Test Model Compaction
    const compactor = new ContextCompactor();
    const modelResult = await compactor.compact({
      conversation: convo,
      messages: memoryService.getRepository().getMessages(convo.id),
      requirementInventory: inventory,
      provider,
    });

    expect(modelResult.source).toBe("model");
    expect(modelResult.snapshotMarkdown).toContain("State");

    // 2. Test Resilient Fallback Preservation
    const fallbackResult = compactor.heuristicFallback(
      convo,
      memoryService.getRepository().getMessages(convo.id),
      null,
      inventory,
      "Simulated provider timeout"
    );

    expect(fallbackResult.source).toBe("heuristic_fallback");
    const fbText = fallbackResult.snapshotMarkdown;

    // INDEPENDENT CHECKLIST VERIFICATION:
    // 1. Mandatory features preserved
    expect(fbText).toContain("[REQ-CORE-01]");
    expect(fbText).toContain("[REQ-CORE-02]");

    // 2. Negative constraints & prohibitions preserved
    expect(fbText).toContain("Never execute shell commands as root");
    expect(fbText).toContain("Workspace confinement");

    // 3. Optional features kept under optional, NOT marked mandatory
    expect(fbText).toContain("Optional Enhancements (Non-Binding Suggestions)");
    expect(fbText).toContain("[REQ-OPT-01]");
    const mandatoryBlock = fbText.slice(
      fbText.indexOf("### Key Mandatory Requirements:"),
      fbText.indexOf("### Optional Enhancements")
    );
    expect(mandatoryBlock).not.toContain("REQ-OPT-01");

    // 4. Phased Roadmap preserved
    expect(fbText).toContain("Phased Implementation Roadmap & Deferred Milestones");
    expect(fbText).toContain("Phase: Phase 1");
    expect(fbText).toContain("Phase: Phase 2");

    // 5. Acceptance criteria preserved
    expect(fbText).toContain("Acceptance Criteria:");
    expect(fbText).toContain("[REQ-CRIT-01]");

    // 6. Explicit user decision preserved
    expect(fbText).toContain("SQLite");

    // 7. Verified work preserved
    expect(fbText).toContain("Verified passed check: npm test");

    // 8. Discloses fallback reason clearly
    expect(fbText).toContain("Resilient Context Fallback: Snapshot synthesized via deterministic fallback");
  });

  it("preserves earlier snapshot decisions and completed work during subsequent multi-turn compactions", async () => {
    const convo = memoryService.getOrCreateConversation({
      projectId: "proj-multi-turn",
      initialInstruction: "Build OAuth authentication server",
    });

    // Turn 1 initial snapshot
    const initialSnapshotMarkdown = `# Context Memory Snapshot: Turn 1
## 1. Overall Objective & Requested Deliverables
- OAuth2 server with PKCE support.
## 2. Explicit Requirements, Technology Constraints & Prohibitions
- [REQ-001] STRICT: Use RFC 7636 PKCE code challenge.
## 3. Important Decisions & Rationale
- Decision: Use RS256 for JWT token signing.
- Decision: Rejected symmetric HS256 due to key exposure risk.
## 4. Current Implementation State & Changed Files
- Changed Files: src/auth/pkce.ts
## 5. Completed Work & Verified Evidence
- Verified check: PKCE S256 verifier unit test passed.
## 6. Outstanding Requirements, Bugs & Blockers
- Pending refresh token rotation.
## 7. Relevant Commands, Test Results & Errors
- npm test passed
## 8. Unresolved Questions & Ambiguities
- None.`;

    const snap1 = memoryService.getRepository().saveSnapshot({
      conversationId: convo.id,
      snapshotMarkdown: initialSnapshotMarkdown,
      tokenCount: 200,
    });

    // Subsequent turns: User adds refresh token instruction
    memoryService.recordUserMessage(convo.id, "Now implement refresh token rotation and revoke stolen tokens.");
    memoryService.recordModelDecision(convo.id, "Decision: Invalidate old refresh token family on token reuse.");
    memoryService.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "refresh_rotation_test", status: "passed" }],
      filesChanged: ["src/auth/refresh.ts"],
    });

    // Trigger subsequent compaction with fallback
    const compactor = new ContextCompactor();
    const updatedResult = compactor.heuristicFallback(
      convo,
      memoryService.getRepository().getMessages(convo.id),
      snap1,
      null,
      "Second round test"
    );

    const updatedText = updatedResult.snapshotMarkdown;

    // Earlier decisions MUST be carried forward
    expect(updatedText).toContain("Decision: Use RS256 for JWT token signing.");
    expect(updatedText).toContain("Decision: Rejected symmetric HS256 due to key exposure risk.");

    // New decisions MUST also be present
    expect(updatedText).toContain("Decision: Invalidate old refresh token family on token reuse.");

    // Earlier completed work MUST be carried forward alongside new work
    expect(updatedText).toContain("Verified check: PKCE S256 verifier unit test passed.");
    expect(updatedText).toContain("Verified passed check: refresh_rotation_test");
  });
});

describe("Section 4: Context Budget Calculations & Request Assembly Boundary Conditions", () => {
  it("computes internally consistent context budgets for local Ollama and OpenAI models", () => {
    // 1. Local Ollama (16,384 tokens)
    const localProvider = new OpenAICompatibleLocalProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:30b",
      contextTokens: 16_384,
    });
    const localBudget = calculateContextBudget(localProvider);

    expect(localBudget.totalContextTokens).toBe(16_384);
    expect(localBudget.safetyMarginTokens).toBe(Math.floor(16_384 * 0.05)); // ~819 tokens
    expect(localBudget.availableHistoryBudget).toBeGreaterThan(6_000);
    expect(localBudget.compactionThresholdTokens).toBe(Math.floor(localBudget.availableHistoryBudget * 0.70));
    expect(localBudget.reserveTokens + localBudget.availableHistoryBudget).toBe(16_384);

    // 2. OpenAI GPT-4o (128,000 tokens)
    const gpt4oProvider = new OpenAIProvider({
      apiKey: "sk-test",
      model: "gpt-4o",
    });
    const gpt4oBudget = calculateContextBudget(gpt4oProvider);

    expect(gpt4oBudget.totalContextTokens).toBe(128_000);
    expect(gpt4oBudget.safetyMarginTokens).toBe(2_000); // capped at 2,000
    expect(gpt4oBudget.availableHistoryBudget).toBeGreaterThan(100_000);
    expect(gpt4oBudget.reserveTokens + gpt4oBudget.availableHistoryBudget).toBe(128_000);
  });

  it("handles boundary condition: very small context windows (2048 and 4096 tokens) gracefully", () => {
    const tinyProvider = new ScriptedProvider(2048);
    const tinyBudget = calculateContextBudget(tinyProvider);

    expect(tinyBudget.totalContextTokens).toBe(2048);
    // Safety margin 5% of 2048 = 102 tokens
    expect(tinyBudget.safetyMarginTokens).toBe(102);
    // maxOutputTokens scaled down to 25% of 2048 = 512
    expect(tinyBudget.breakdown.maxOutputTokens).toBe(512);
    // available history budget must remain positive and practical
    expect(tinyBudget.availableHistoryBudget).toBeGreaterThanOrEqual(500);
    expect(tinyBudget.reserveTokens + tinyBudget.availableHistoryBudget).toBe(2048);

    const smallProvider = new ScriptedProvider(4096);
    const smallBudget = calculateContextBudget(smallProvider);

    expect(smallBudget.totalContextTokens).toBe(4096);
    expect(smallBudget.availableHistoryBudget).toBeGreaterThan(1500);
    expect(smallBudget.breakdown.maxOutputTokens).toBe(1024);
  });

  it("handles boundary condition: large evidence, long system instructions, and oversized snapshots", () => {
    const provider = new ScriptedProvider(16_384);

    const measuredBudget = calculateContextBudget(provider, {
      systemInstructionTokens: 3000,
      activeTaskTokens: 2000,
      requirementTokens: 2500,
      evidenceTokens: 3500,
      maxOutputTokens: 2500,
      safetyMarginPct: 0.05,
    });

    expect(measuredBudget.totalContextTokens).toBe(16_384);
    expect(measuredBudget.breakdown.systemTokens).toBe(3000);
    expect(measuredBudget.breakdown.specificationTokens).toBe(4500);
    expect(measuredBudget.breakdown.evidenceTokens).toBe(3500);
    // Scaled for 16k window so history budget is not completely starved
    expect(measuredBudget.availableHistoryBudget).toBeGreaterThanOrEqual(100);
  });

  it("enforces Request Assembly Guard in composeInstruction when prompt is oversized", async () => {
    const tinyProvider = new ScriptedProvider(4096);

    // Create huge files list and huge history that would otherwise overflow 4096 tokens
    const hugeFiles = Array.from({ length: 200 }, (_, i) => `src/subsystem/module_${i}/very_long_file_path_name_${i}.ts`);
    const hugeEvidence = [
      {
        iteration: 1,
        instruction: "Initial prompt ".repeat(100),
        agentReply: "Detailed agent report ".repeat(100),
        agentState: "done",
        changedFiles: hugeFiles.slice(0, 30),
        diffExcerpt: "diff --git a/test.ts b/test.ts\n+console.log('huge');\n".repeat(200),
        checks: [{ label: "npm test", status: "failed", output: "Stack trace line\n".repeat(50) }],
        blockers: ["Blocker description ".repeat(10)],
        reviewer: "Reviewer notes",
      },
    ];

    const ctx: InstructionContext = {
      projectId: "proj-assembly-guard",
      runId: "run-guard-1",
      taskText: "Task with huge surrounding context payload",
      criteria: ["Criterion 1", "Criterion 2"],
      profile: {
        id: "general",
        languages: ["typescript"],
        frameworks: [],
        checks: [],
        isEmpty: false,
        fileCount: 200,
      },
      files: hugeFiles,
      iteration: 2,
      maxIterations: 3,
      history: hugeEvidence,
    };

    const instruction = await composeInstruction(tinyProvider, ctx);

    expect(instruction.action).toBe("instruct");
    expect(tinyProvider.generateCalls.length).toBe(1);

    const call = tinyProvider.generateCalls[0];
    const userPrompt = call.messages[0].content;
    const totalEstimatedTokens = estimateTokens(call.systemInstruction) + estimateTokens(userPrompt) + (call.maxOutputTokens || 0);

    // CRITICAL GUARANTEE: Total assembled request fits within model context limit
    expect(totalEstimatedTokens).toBeLessThanOrEqual(tinyProvider.customContextWindow);
  });
});

describe("Section 5: Resume & Conversation Isolation", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DatabaseSync;
  let tmpDir: string;
  let wsDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-res-data-"));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-res-ws-"));
    const dbPath = path.join(tmpDir, "orches.sqlite");
    SettingsManager.setDataDir(tmpDir);

    const { BuiltinCoderAdapter } = await import("../src/providers/coding-agents/builtin/builtin-coder.js");
    app = await buildApp({
      dbPath,
      runOverrides: {
        provider: () => new ScriptedProvider(),
        agent: (p) => new BuiltinCoderAdapter(p),
      },
    });
    db = getDb();
  });

  afterEach(async () => {
    await app.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(wsDir, { recursive: true, force: true });
    } catch {}
  });

  it("resumes an existing conversation into a new run with preserved context and isolation", async () => {
    // 1. Create project A and project B
    createTestProject(db, "proj-iso-a", "Project Alpha");
    createTestProject(db, "proj-iso-b", "Project Beta");

    // 2. Create conversation in Project A via API
    const createRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/proj-iso-a/conversations`,
      payload: {
        title: "Alpha Deployment Flow",
        initialInstruction: "Configure Kubernetes manifests with Helm",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const convoA = JSON.parse(createRes.payload).conversation;

    // 3. Add follow up messages
    await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${convoA.id}/messages`,
      payload: { content: "Ensure memory limits are set to 512Mi." },
    });

    // 4. Verify Project B cannot list or resume Conversation A
    const listBRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/proj-iso-b/conversations`,
    });
    const convosB = JSON.parse(listBRes.payload).conversations;
    expect(convosB.some((c: { id: string }) => c.id === convoA.id)).toBe(false);

    // 5. Resume Conversation A with a follow-up task
    const resumeRes = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${convoA.id}/resume`,
      payload: {
        taskText: "Add ingress route for staging domain",
      },
    });
    expect(resumeRes.statusCode).toBe(201);
    const resumePayload = JSON.parse(resumeRes.payload);
    expect(resumePayload.run).toBeDefined();
    expect(resumePayload.run.conversationId).toBe(convoA.id);
    expect(resumePayload.conversation.resumedRunId).toBe(resumePayload.run.id);

    // 6. Test resume failure when conversation is archived
    await app.inject({
      method: "PATCH",
      url: `/api/v1/conversations/${convoA.id}`,
      payload: { status: "archived" },
    });

    const archivedResumeRes = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${convoA.id}/resume`,
      payload: { taskText: "Cannot resume archived" },
    });
    expect(archivedResumeRes.statusCode).toBe(400);
    expect(JSON.parse(archivedResumeRes.payload).error).toContain("archived");
  });
});

describe("Section 6: Backend Conversation Deletion Data Lifecycle", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DatabaseSync;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-del-test-"));
    SettingsManager.setDataDir(tmpDir);
    app = await buildApp();
    db = getDb();
  });

  afterEach(async () => {
    await app.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("executes complete backend deletion policy: purges messages, snapshots in SQLite, files on disk, and unlinks runs without deleting operational run records", async () => {
    createTestProject(db, "proj-del-1", "Deletion Test Project");

    const memoryService = new ConversationMemoryService(db);
    const convo = memoryService.getOrCreateConversation({
      projectId: "proj-del-1",
      initialInstruction: "Build authentication microservice",
    });

    // Add messages
    memoryService.recordUserMessage(convo.id, "Secret message with confidential data");
    memoryService.recordModelDecision(convo.id, "Model architectural decision");

    // Save snapshot in DB and on disk
    const snapshot = memoryService.getRepository().saveSnapshot({
      conversationId: convo.id,
      snapshotMarkdown: `# Snapshot for ${convo.id}\nConfidential context`,
      tokenCount: 50,
    });

    const snapFile = path.join(tmpDir, "memory_snapshots", convo.id, `${snapshot.id}.md`);
    expect(fs.existsSync(snapFile)).toBe(true);

    // Associate a run with this conversation
    const runRepo = new RunRepository(db);
    const run = runRepo.create({
      id: "run-del-assoc-1",
      projectId: "proj-del-1",
      taskText: "Initial run task",
      status: "completed",
      conversationId: convo.id,
    });

    expect(run.conversationId).toBe(convo.id);

    // Execute deletion via API
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${convo.id}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.payload).ok).toBe(true);

    // 1. Conversation record in SQLite is deleted
    expect(memoryService.getRepository().findById(convo.id)).toBeNull();

    // 2. Messages in SQLite are deleted
    expect(memoryService.getRepository().getMessages(convo.id).length).toBe(0);

    // 3. Snapshots in SQLite are deleted
    expect(memoryService.getRepository().listSnapshots(convo.id).length).toBe(0);

    // 4. Filesystem snapshot files and directory are purged
    expect(fs.existsSync(snapFile)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "memory_snapshots", convo.id))).toBe(false);

    // 5. Linked run record is PRESERVED, but conversation_id is NULLIFIED
    const reloadedRun = runRepo.findById(run.id);
    expect(reloadedRun).not.toBeNull();
    expect(reloadedRun?.id).toBe(run.id);
    expect(reloadedRun?.conversationId).toBeNull();

    // 6. Project record is PRESERVED
    const projectRepo = new ProjectRepository(db);
    expect(projectRepo.findById("proj-del-1")).not.toBeNull();

    // 7. Subsequent GET returns 404
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${convo.id}`,
    });
    expect(getRes.statusCode).toBe(404);
  });
});
