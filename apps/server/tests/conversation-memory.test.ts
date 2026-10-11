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
import { calculateContextBudget, shouldTriggerCompaction, estimateTokens } from "../src/domain/memory/context-budget.js";
import { ReasoningProvider, ReasoningRequest, ReasoningResult } from "../src/providers/reasoning/provider.js";
import { OpenAICompatibleLocalProvider } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { OpenAIProvider } from "../src/providers/reasoning/openai/openai-provider.js";
import { RequirementInventory } from "../src/domain/requirements/requirement-inventory.js";
import { SettingsManager } from "../src/platform/settings-manager.js";
import { buildApp } from "../src/app.js";
import { ProjectRepository } from "../src/storage/repositories/project-repository.js";
import { RunRepository } from "../src/storage/repositories/run-repository.js";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const now = new Date().toISOString();
  for (const id of ["proj-1", "proj-A", "proj-B", "proj-demo"]) {
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, created_at, updated_at)
      VALUES (?, ?, '', 'C:\\workspace', 'ready', 'general', 'creative_within_constraints', ?, ?)
    `).run(id, id, now, now);
  }
  return db;
}

class MockReasoningProvider implements ReasoningProvider {
  public id = "openai-compatible-local";
  public displayName = "Mock Reasoning Provider";
  public privacyClass = "local" as const;
  public generateCalls: ReasoningRequest[] = [];
  public customContextWindow: number = 16_384;
  public throwOnError: boolean = false;
  public returnInvalidMarkdown: boolean = false;

  constructor(public model = "qwen3:30b") {}

  public getModel(): string {
    return this.model;
  }

  public getContextWindow(): number {
    return this.customContextWindow;
  }

  public async healthCheck() {
    return { ok: true, status: "ready" as const };
  }

  public async generate(request: ReasoningRequest): Promise<ReasoningResult> {
    this.generateCalls.push(request);
    if (this.throwOnError) {
      throw new Error("Provider network timeout or internal connection failure");
    }
    if (this.returnInvalidMarkdown) {
      return {
        text: "Too short",
        providerId: this.id,
        modelId: this.model,
        durationMs: 50,
        warnings: [],
      };
    }

    const text = `# Context Memory Snapshot: Test Session
Generated: ${new Date().toISOString()}

## 1. Overall Objective & Requested Deliverables
- Implement persistent memory and compaction system for Orches engineering runs.

## 2. Explicit Requirements, Technology Constraints & Prohibitions
- [REQ-001] STRICT: Use SQLite for persistence and avoid scattering files in user repo.
- [REQ-002] Prohibit dropping unverified assumptions into completed status.

## 3. Important Decisions & Rationale
- Adopted model-aware budgeting to support both local Ollama and OpenAI API.

## 4. Current Implementation State & Changed Files
- Modified: apps/server/src/domain/memory/conversation-memory-service.ts
- Verified: All unit tests passing.

## 5. Completed Work & Verified Evidence
- Verified check: npm test passed (128 tests).
- Critic review: Endorsed acceptance.

## 6. Outstanding Requirements, Bugs & Blockers
- None outstanding.

## 7. Relevant Commands, Test Results & Errors
- Command: npm test (exit code 0).

## 8. Unresolved Questions & Ambiguities
- None.`;

    return {
      text,
      providerId: this.id,
      modelId: this.model,
      durationMs: 80,
      warnings: [],
    };
  }
}

describe("Section 1 & 6: Persistent Conversation History across Restarts & Storage Safety", () => {
  let tmpDir: string;
  let dbFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-convo-test-"));
    dbFile = path.join(tmpDir, "orches.sqlite");
    SettingsManager.setDataDir(tmpDir);
  });

  afterEach(() => {
    SettingsManager.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("persists conversations, messages, and memory snapshots incrementally across DB reopens", () => {
    // Stage 1: First session
    const db1 = new DatabaseSync(dbFile);
    runMigrations(db1);

    const projectRepo1 = new ProjectRepository(db1);
    projectRepo1.create({
      id: "proj-1",
      name: "Test Project",
      objective: "Build feature",
      rootPath: path.join(tmpDir, "workspace"),
      status: "ready",
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      verificationCommands: [],
      autoCommit: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const repo1 = new ConversationRepository(db1);
    const convo1 = repo1.create({
      projectId: "proj-1",
      title: "Feature Implementation Session",
    });

    repo1.addMessage({
      conversationId: convo1.id,
      role: "user",
      content: "Please implement persistent memory storage.",
    });

    repo1.addMessage({
      conversationId: convo1.id,
      role: "assistant",
      content: "Planning database schema and repository interfaces.",
      meta: { step: 1 },
    });

    repo1.saveSnapshot({
      conversationId: convo1.id,
      snapshotMarkdown: "# Snapshot 1\nVerified: Database schema created.",
      tokenCount: 42,
    });

    db1.close();

    // Stage 2: Reopen database (simulating server restart)
    const db2 = new DatabaseSync(dbFile);
    runMigrations(db2);
    const repo2 = new ConversationRepository(db2);

    const retrieved = repo2.findById(convo1.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe("Feature Implementation Session");
    expect(retrieved?.messageCount).toBe(2);

    const messages = repo2.getMessages(convo1.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Please implement persistent memory storage.");
    expect(messages[1].role).toBe("assistant");

    const snapshot = repo2.getLatestSnapshot(convo1.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.snapshotMarkdown).toContain("Snapshot 1");
    expect(snapshot?.tokenCount).toBe(42);

    // Verify snapshot file backup exists in data directory, outside workspace
    const snapDir = path.join(tmpDir, "memory_snapshots", convo1.id);
    expect(fs.existsSync(snapDir)).toBe(true);

    db2.close();
  });

  it("redacts credentials and secrets before storing in conversation messages and snapshots", () => {
    const db = createTestDb();
    const repo = new ConversationRepository(db);
    const convo = repo.create({ projectId: "proj-1", title: "Secret Test" });

    const msg = repo.addMessage({
      conversationId: convo.id,
      role: "user",
      content: "Connect using OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456789 and Bearer secret-token-xyz1234567890",
      meta: { apiKey: "sk-secret12345678901234567890" },
    });

    expect(msg.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456789");
    expect(msg.content).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify(msg.meta)).toContain("[REDACTED_CREDENTIAL]");

    const snap = repo.saveSnapshot({
      conversationId: convo.id,
      snapshotMarkdown: "Configured key: sk-abcdefghijklmnopqrstuvwxyz123456789",
    });

    expect(snap.snapshotMarkdown).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456789");
    expect(snap.snapshotMarkdown).toContain("[REDACTED_SECRET]");
  });
});

describe("Section 2 & 8: Context Budgeting across Ollama and OpenAI Providers", () => {
  it("computes model-aware context budget for local Ollama without hardcoding cloud limits", () => {
    const localProvider = new OpenAICompatibleLocalProvider({
      model: "qwen3:30b",
      contextTokens: 16_384,
    });

    const budget = calculateContextBudget(localProvider);
    expect(budget.providerId).toBe("openai-compatible-local");
    expect(budget.modelId).toBe("qwen3:30b");
    expect(budget.totalContextTokens).toBe(16_384);
    // Reserve scales for 16k window: 55% of 16384 = ~9011
    expect(budget.reserveTokens).toBeLessThan(budget.totalContextTokens);
    expect(budget.availableHistoryBudget).toBeGreaterThan(3000);
    expect(budget.compactionThresholdTokens).toBe(Math.floor(budget.availableHistoryBudget * 0.70));
  });

  it("computes model-aware context budget for external OpenAI API models", () => {
    const openaiProvider = new OpenAIProvider({
      apiKey: "dummy-key-for-budget-test",
      model: "gpt-4o-mini",
    });

    const budget = calculateContextBudget(openaiProvider);
    expect(budget.providerId).toBe("openai");
    expect(budget.modelId).toBe("gpt-4o-mini");
    expect(budget.totalContextTokens).toBe(128_000);
    expect(budget.reserveTokens).toBe(11500);
    expect(budget.availableHistoryBudget).toBe(128_000 - 11500);
    expect(budget.compactionThresholdTokens).toBe(Math.floor((128_000 - 11500) * 0.70));
  });

  it("triggers compaction only when approaching model-specific budget threshold", () => {
    const localProvider = new OpenAICompatibleLocalProvider({ contextTokens: 8192 });
    const localBudget = calculateContextBudget(localProvider);

    expect(shouldTriggerCompaction(100, localBudget)).toBe(false);
    expect(shouldTriggerCompaction(localBudget.compactionThresholdTokens + 10, localBudget)).toBe(true);

    const openaiProvider = new OpenAIProvider({ apiKey: "dummy", model: "gpt-4o" });
    const openaiBudget = calculateContextBudget(openaiProvider);

    // Tokens that would exceed local threshold do not prematurely trigger cloud OpenAI compaction
    expect(shouldTriggerCompaction(localBudget.compactionThresholdTokens + 10, openaiBudget)).toBe(false);
  });
});

describe("Section 2 & 8: Context Compaction, Fallback, and Preservation of Raw Messages", () => {
  let db: DatabaseSync;
  let service: ConversationMemoryService;
  let provider: MockReasoningProvider;

  beforeEach(() => {
    db = createTestDb();
    service = new ConversationMemoryService(db);
    provider = new MockReasoningProvider();
  });

  it("compacts conversation into structured markdown and preserves all original messages", async () => {
    const convo = service.getOrCreateConversation({ projectId: "proj-1", initialInstruction: "Build authentication" });

    // Append multiple messages
    service.recordUserMessage(convo.id, "Requirement 1: Add JWT login with bcrypt hashing.");
    service.recordModelDecision(convo.id, "Architectural Decision: Use bcryptjs and sign 1h JWT tokens.");
    service.recordAgentDispatch(convo.id, "Implementation prompt: add auth route in src/auth.ts");
    service.recordAgentResponse(convo.id, "Wrote src/auth.ts and tests/auth.test.ts");
    service.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "npm test", status: "passed", output: "2 tests passing" }],
      filesChanged: ["src/auth.ts", "tests/auth.test.ts"],
    });

    const messagesBefore = service.getRepository().getMessages(convo.id);
    expect(messagesBefore.length).toBeGreaterThanOrEqual(5);

    // Trigger compaction (force = true for test)
    const result = await service.maybeCompact(convo.id, provider, { force: true });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("model");
    expect(result?.snapshotMarkdown).toContain("Context Memory Snapshot");
    expect(result?.snapshotMarkdown).toContain("1. Overall Objective");
    expect(result?.snapshotMarkdown).toContain("5. Completed Work & Verified Evidence");

    // CRITICAL REQUIREMENT: Raw messages must NOT be erased or rewritten
    const messagesAfter = service.getRepository().getMessages(convo.id);
    expect(messagesAfter.length).toBe(messagesBefore.length);
    expect(messagesAfter[0].content).toBe(messagesBefore[0].content);
    expect(messagesAfter[1].content).toBe(messagesBefore[1].content);

    // Latest snapshot is persisted
    const latestSnapshot = service.getRepository().getLatestSnapshot(convo.id);
    expect(latestSnapshot).not.toBeNull();
    expect(latestSnapshot?.snapshotMarkdown).toBe(result?.snapshotMarkdown);
  });

  it("gracefully engages heuristic fallback when provider summarization fails or times out", async () => {
    const convo = service.getOrCreateConversation({ projectId: "proj-1", initialInstruction: "Refactor database layer" });

    service.recordUserMessage(convo.id, "Refactor database queries and enforce strict pool size 10.");
    service.recordModelDecision(convo.id, "Plan: migrate to connection pool with safety limit.");
    service.recordVerificationOutcome(convo.id, {
      passed: false,
      blockers: ["Pool timeout exceeded on test connection"],
      checks: [{ label: "npm test", status: "failed", output: "Connection pool exhausted" }],
      filesChanged: ["src/db.ts"],
    });

    // Inject failure into provider
    provider.throwOnError = true;

    const result = await service.maybeCompact(convo.id, provider, { force: true });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("heuristic_fallback");
    // Fallback must never be empty
    expect(result?.snapshotMarkdown.length).toBeGreaterThan(150);
    expect(result?.snapshotMarkdown).toContain("Heuristic Resilient Fallback");
    expect(result?.snapshotMarkdown).toContain("Pool timeout exceeded");
    expect(result?.snapshotMarkdown).toContain("src/db.ts");

    // Raw messages still preserved
    const messages = service.getRepository().getMessages(convo.id);
    expect(messages.length).toBe(3);
  });
});

describe("Section 3 & 8: Context Reconstruction and Strict Project Isolation", () => {
  let db: DatabaseSync;
  let service: ConversationMemoryService;
  let provider: MockReasoningProvider;

  beforeEach(() => {
    db = createTestDb();
    service = new ConversationMemoryService(db);
    provider = new MockReasoningProvider();
  });

  it("reconstructs context according to priority hierarchy (Task > Requirements > Snapshot > Recent History)", () => {
    const convo = service.getOrCreateConversation({ projectId: "proj-1", initialInstruction: "Implement payments" });

    service.recordUserMessage(convo.id, "Step 1: Stripe checkout integration");
    service.recordVerificationOutcome(convo.id, {
      passed: true,
      checks: [{ label: "test-stripe", status: "passed" }],
    });

    service.getRepository().saveSnapshot({
      conversationId: convo.id,
      snapshotMarkdown: "# Memory Snapshot: Payments\n- Stripe API integrated.",
      tokenCount: 50,
    });

    service.recordUserMessage(convo.id, "Step 2: Add refund handling");

    const inventory: RequirementInventory = {
      projectId: "proj-1",
      updatedAt: new Date().toISOString(),
      requirements: [
        {
          id: "REQ-010",
          title: "Refunds webhook",
          description: "Must verify HMAC signature before processing refund",
          classification: "explicit_constraint",
          importance: "critical",
          sourceReference: "spec.md:L45",
          status: "candidate",
          proposedAcceptanceTest: "test refund signature",
          createdAt: new Date().toISOString(),
        },
      ],
      summary: { total: 1, mandatory: 0, constraints: 1, optional: 0, contradictions: 0, verified: 0, unverified: 1 },
    };

    const reconstructed = service.reconstructContext({
      conversationId: convo.id,
      projectId: "proj-1",
      currentTaskText: "Implement refund handling endpoint",
      requirementInventory: inventory,
      provider,
    });

    expect(reconstructed.snapshotIncluded).toBe(true);
    expect(reconstructed.promptSection).toContain("NON-NEGOTIABLE REQUIREMENTS & CONSTRAINTS");
    expect(reconstructed.promptSection).toContain("REQ-010");
    expect(reconstructed.promptSection).toContain("Must verify HMAC signature");
    expect(reconstructed.promptSection).toContain("PERSISTENT CONTEXT MEMORY SNAPSHOT");
    expect(reconstructed.promptSection).toContain("Stripe API integrated");
    expect(reconstructed.promptSection).toContain("Step 2: Add refund handling");
  });

  it("strictly isolates conversations and prevents cross-project context leakage", () => {
    const convoA = service.getOrCreateConversation({ projectId: "proj-A", initialInstruction: "Secret project A code" });
    service.recordUserMessage(convoA.id, "Secret financial algorithms for Project A");
    service.getRepository().saveSnapshot({
      conversationId: convoA.id,
      snapshotMarkdown: "CONFIDENTIAL PROJECT A ALGORITHM",
      tokenCount: 10,
    });

    // Attempt to reconstruct context for Project B using Conversation A's ID
    const crossProjectRecon = service.reconstructContext({
      conversationId: convoA.id,
      projectId: "proj-B", // Different project!
      currentTaskText: "Build Project B",
      provider,
    });

    expect(crossProjectRecon.promptSection).toBe("");
    expect(crossProjectRecon.snapshotIncluded).toBe(false);
    expect(crossProjectRecon.promptSection).not.toContain("CONFIDENTIAL PROJECT A ALGORITHM");
  });
});

describe("Section 4, 5 & 8: Dashboard Chat History API & Backend Deletion", () => {
  let app: any;
  let db: DatabaseSync;
  let tmpDir: string;
  let wsDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-api-data-"));
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-api-ws-"));
    dbPath = path.join(tmpDir, "orches.sqlite");
    SettingsManager.setDataDir(tmpDir);

    const { BuiltinCoderAdapter } = await import("../src/providers/coding-agents/builtin/builtin-coder.js");
    app = await buildApp({
      dbPath,
      runOverrides: {
        provider: () => new MockReasoningProvider(),
        agent: (p) => new BuiltinCoderAdapter(p),
      },
    });
    db = (await import("../src/storage/db.js")).getDb();

    const projectRepo = new ProjectRepository(db);
    projectRepo.create({
      id: "proj-demo",
      name: "Demo Project",
      objective: "Dashboard test",
      rootPath: wsDir,
      status: "ready",
      profileId: "general",
      autonomyMode: "creative_within_constraints",
      verificationCommands: [],
      autoCommit: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await app.close();
    (await import("../src/storage/db.js")).closeDb();
    SettingsManager.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(wsDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists, views, updates title, resumes, and deletes conversations via REST API", async () => {
    // 1. Create a conversation
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects/proj-demo/conversations",
      payload: { title: "API Gateway Integration", initialInstruction: "Configure fastify reverse proxy routes" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body).conversation;
    expect(created.title).toBe("API Gateway Integration");
    const convoId = created.id;

    // 2. List conversations
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/projects/proj-demo/conversations",
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body).conversations;
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(convoId);
    expect(list[0].messageCount).toBe(1);

    // 3. Inspect conversation detail
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${convoId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const detail = JSON.parse(getRes.body);
    expect(detail.conversation.id).toBe(convoId);
    expect(detail.messages.length).toBe(1);
    expect(detail.messages[0].content).toBe("Configure fastify reverse proxy routes");

    // 4. Update title
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/conversations/${convoId}`,
      payload: { title: "Renamed Gateway Setup" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).conversation.title).toBe("Renamed Gateway Setup");

    // 5. Append message
    const msgRes = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${convoId}/messages`,
      payload: { content: "Follow-up instruction: add rate limiting" },
    });
    expect(msgRes.statusCode).toBe(201);

    // 6. Delete conversation (real backend deletion)
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${convoId}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).ok).toBe(true);

    // 7. Verify hard deletion: subsequent GET is 404 and data cannot enter subsequent prompts
    const getAfterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${convoId}`,
    });
    expect(getAfterDelete.statusCode).toBe(404);

    // Verify messages table is cleaned
    const msgCount = db.prepare("SELECT COUNT(*) as c FROM conversation_messages WHERE conversation_id = ?").get(convoId) as { c: number };
    expect(msgCount.c).toBe(0);

    // Verify filesystem snapshot folder is cleaned
    const snapDir = path.join(tmpDir, "memory_snapshots", convoId);
    expect(fs.existsSync(snapDir)).toBe(false);
  });

  it("resumes a conversation with saved context and links the new run", async () => {
    // 1. Create initial conversation
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects/proj-demo/conversations",
      payload: { title: "Refactor Auth Session", initialInstruction: "Refactor session store" },
    });
    const convoId = JSON.parse(createRes.body).conversation.id;

    // 2. Add an assistant message and memory snapshot
    const memoryService = new ConversationMemoryService(db);
    memoryService.recordModelDecision(convoId, "Prior decision: using Redis token store");
    memoryService.getRepository().saveSnapshot({
      conversationId: convoId,
      snapshotMarkdown: "# Memory Snapshot\n- Redis session store selected.",
      tokenCount: 40,
    });

    // 3. Resume the conversation via POST /api/v1/conversations/:id/resume
    const resumeRes = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${convoId}/resume`,
      payload: { taskText: "Add session TTL expiry and tests" },
    });
    if (resumeRes.statusCode !== 201) console.log("RESUME ERROR:", resumeRes.body);
    expect(resumeRes.statusCode).toBe(201);
    const body = JSON.parse(resumeRes.body);
    expect(body.run).toBeDefined();
    expect(body.run.conversationId).toBe(convoId);
    expect(body.conversation.resumedRunId).toBe(body.run.id);

    // 4. Verify context reconstruction for the resumed conversation continues with Redis memory
    const recon = memoryService.reconstructContext({
      conversationId: convoId,
      projectId: "proj-demo",
      currentTaskText: "Add session TTL expiry and tests",
      provider: new MockReasoningProvider(),
    });
    expect(recon.snapshotIncluded).toBe(true);
    expect(recon.promptSection).toContain("Redis session store selected");
  });

  it("verifies context management works with both local Ollama and external OpenAI providers", () => {
    // 1. Local Ollama Provider setup
    const ollamaProvider = new OpenAICompatibleLocalProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:30b",
      contextTokens: 16_384,
    });
    expect(ollamaProvider.getContextWindow()).toBe(16_384);
    const ollamaBudget = calculateContextBudget(ollamaProvider);
    expect(ollamaBudget.totalContextTokens).toBe(16_384);
    expect(ollamaBudget.availableHistoryBudget).toBeGreaterThan(0);
    expect(ollamaBudget.compactionThresholdTokens).toBeGreaterThan(2000);

    // 2. External OpenAI API Provider setup
    const openaiProvider = new OpenAIProvider({
      apiKey: "test-openai-api-key",
      model: "gpt-4o",
    });
    expect(openaiProvider.getContextWindow()).toBe(128_000);
    const openaiBudget = calculateContextBudget(openaiProvider);
    expect(openaiBudget.totalContextTokens).toBe(128_000);
    expect(openaiBudget.reserveTokens).toBe(11500);
    expect(openaiBudget.availableHistoryBudget).toBe(128_000 - 11500);

    // 3. Both providers evaluate budget and token estimation deterministically
    const samplePrompt = "Implement a high-performance Redis cache layer with 10k RPS throughput";
    const sampleTokens = estimateTokens(samplePrompt);
    expect(sampleTokens).toBe(Math.ceil(samplePrompt.length / 4));

    // Neither triggers premature compaction for short prompts
    expect(shouldTriggerCompaction(sampleTokens, ollamaBudget)).toBe(false);
    expect(shouldTriggerCompaction(sampleTokens, openaiBudget)).toBe(false);

    // A large transcript of 10,000 tokens triggers compaction on Ollama (16k) but not on OpenAI (128k)
    expect(shouldTriggerCompaction(10_000, ollamaBudget)).toBe(true);
    expect(shouldTriggerCompaction(10_000, openaiBudget)).toBe(false);
  });
});

