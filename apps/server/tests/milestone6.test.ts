import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../src/app.js";
import { closeDb, initDb } from "../src/storage/db.js";
import { runMigrations } from "../src/storage/migrations.js";
import { InboxService } from "../src/domain/human-messages/inbox-service.js";
import { EventStore } from "../src/events/event-store.js";
import { AutonomousLoop } from "../src/orchestrator/loop.js";
import { PlannerService } from "../src/orchestrator/planner.js";
import { CriticService } from "../src/orchestrator/critic.js";
import { BudgetService } from "../src/domain/budgets/budget-service.js";
import { ContextBuilder } from "../src/prompts/context-builder.js";
import { OpenAICompatibleLocalProvider } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { MockAgentAdapter } from "../src/providers/coding-agents/mock/mock-adapter.js";
import { config } from "../src/config/env.js";

describe("Milestone 6 — Human Direction, Operator Inbox, and Visual Verification Inspection", () => {
  let app: FastifyInstance;
  let testWorkspace: string;
  let testDbPath: string;

  beforeAll(async () => {
    closeDb();
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "m6-workspace-"));
    testDbPath = path.join(testWorkspace, "m6-test.sqlite");

    // Initialize repo memory
    fs.mkdirSync(path.join(testWorkspace, ".orchestrator"), { recursive: true });
    fs.writeFileSync(
      path.join(testWorkspace, ".orchestrator", "ROADMAP.md"),
      "# Approved Roadmap\n- ROADMAP-001: Core UI components"
    );

    app = await buildApp(testDbPath);
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it("prioritizes urgent human messages and allows message cancellation", () => {
    const db = initDb(testDbPath);
    const eventStore = new EventStore(db);
    const inbox = new InboxService(db, eventStore);

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, objective, root_path, profile_id, autonomy_mode, status, created_at, updated_at)
      VALUES ('proj-test-1', 'Test Project 1', 'Testing messages', ?, 'general', 'creative_within_constraints', 'ready', datetime('now'), datetime('now'))
    `).run(testWorkspace);

    const normalMsg = inbox.sendMessage("proj-test-1", "guidance", "Use CSS modules", "normal");
    const urgentMsg = inbox.sendMessage("proj-test-1", "safe_interrupt", "Emergency halt", "urgent");

    const pending = inbox.getPendingMessages("proj-test-1");
    expect(pending).toHaveLength(2);
    // Urgent message must come first
    expect(pending[0].id).toBe(urgentMsg.id);
    expect(pending[1].id).toBe(normalMsg.id);

    // Cancel normal message
    const canceled = inbox.cancelMessage(normalMsg.id);
    expect(canceled).toBe(true);

    const remainingPending = inbox.getPendingMessages("proj-test-1");
    expect(remainingPending).toHaveLength(1);
    expect(remainingPending[0].id).toBe(urgentMsg.id);

    // Consume urgent message
    const consumed = inbox.consumePendingMessages("proj-test-1");
    expect(consumed).toHaveLength(1);
    expect(consumed[0].status).toBe("consumed");

    expect(inbox.getPendingMessages("proj-test-1")).toHaveLength(0);
  });

  it("supports human message REST API endpoints", async () => {
    // 1. Create a project
    const projRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "Human Direction Test Project",
        objective: "Verify human messaging REST routes",
      },
    });
    expect(projRes.statusCode).toBe(201);
    const project = projRes.json();

    // 2. Post human message
    const msgRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/messages`,
      payload: {
        kind: "guidance",
        content: "Prioritize responsive mobile navigation first",
        priority: "high",
      },
    });
    expect(msgRes.statusCode).toBe(201);
    const createdMsg = msgRes.json();
    expect(createdMsg.id).toBeDefined();
    expect(createdMsg.status).toBe("pending");
    expect(createdMsg.priority).toBe("high");

    // 3. List messages
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/messages`,
    });
    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json();
    expect(listData.messages.length).toBeGreaterThanOrEqual(1);

    // 4. Cancel message
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/messages/${createdMsg.id}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().success).toBe(true);
  });

  it("halts execution immediately when safe_interrupt message is present in loop", async () => {
    const db = initDb(testDbPath);
    runMigrations(db);
    const eventStore = new EventStore(db);
    const inbox = new InboxService(db, eventStore);
    const budgetService = new BudgetService(db);

    // Create project and run in db
    db.prepare(`
      INSERT INTO projects (id, name, objective, root_path, profile_id, autonomy_mode, status, created_at, updated_at)
      VALUES ('proj-interrupt', 'Interrupt Project', 'Testing interrupt', ?, 'general', 'creative_within_constraints', 'ready', datetime('now'), datetime('now'))
    `).run(testWorkspace);

    // Post safe interrupt message
    inbox.sendMessage("proj-interrupt", "safe_interrupt", "Operator requested immediate stop", "urgent");

    db.prepare(`
      INSERT INTO runs (id, project_id, status, iteration_count, started_at)
      VALUES ('run-interrupt', 'proj-interrupt', 'running', 0, datetime('now'))
    `).run();

    const plannerMock = new OpenAICompatibleLocalProvider();
    const contextBuilder = new ContextBuilder(testWorkspace);
    const planner = new PlannerService(plannerMock, contextBuilder);
    const critic = new CriticService(plannerMock, contextBuilder);

    const loop = new AutonomousLoop(db, testWorkspace, planner, critic, budgetService);
    const mockAgent = new MockAgentAdapter("success");

    const result = await loop.runSingleTask({
      projectId: "proj-interrupt",
      runId: "run-interrupt",
      workspacePath: testWorkspace,
      agentAdapter: mockAgent,
      approvedRoadmapIds: ["ROADMAP-001"],
    });

    expect(result.status).toBe("stopped");
    expect(result.error).toContain("Safe interrupt: Operator requested immediate stop");

    // Verify run status transitioned to stopped
    const runRow = db.prepare("SELECT status FROM runs WHERE id = 'run-interrupt'").get() as { status: string };
    expect(runRow.status).toBe("stopped");
  });

  it("retrieves full task verification evidence and critic reviews via task inspection API", async () => {
    const db = initDb(testDbPath);
    const now = new Date().toISOString();

    const taskId = "task-inspector-test-1";
    const projectId = "proj-inspection";

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, objective, root_path, profile_id, autonomy_mode, status, created_at, updated_at)
      VALUES (?, 'Inspection Project', 'Objective', ?, 'general', 'creative_within_constraints', 'ready', ?, ?)
    `).run(projectId, testWorkspace, now, now);

    db.prepare(`
      INSERT INTO tasks (id, project_id, run_id, title, objective, roadmap_item_id, status, priority, risk, created_at, updated_at)
      VALUES (?, ?, 'run-1', 'Implement Navbar', 'Build responsive navbar', 'ROADMAP-001', 'succeeded', 'high', 'low', ?, ?)
    `).run(taskId, projectId, now, now);

    db.prepare(`
      INSERT INTO task_attempts (id, task_id, attempt_number, adapter_id, provider_id, model_id, status, process_exit_code, started_at, ended_at)
      VALUES ('att-insp-1', ?, 1, 'mock-agent', 'mock', 'mock', 'succeeded', 0, ?, ?)
    `).run(taskId, now, now);

    db.prepare(`
      INSERT INTO verification_runs (id, task_id, attempt_id, check_type, command, argv_json, cwd, status, exit_code, duration_ms, stdout_snippet, stderr_snippet, truncated, timestamp)
      VALUES ('vr-insp-1', ?, 'att-insp-1', 'test', 'npm test', '["npm","test"]', ?, 'passed', 0, 150, 'All 4 unit tests passing', '', 0, ?)
    `).run(taskId, testWorkspace, now);

    db.prepare(`
      INSERT INTO critic_reviews (id, task_id, attempt_id, verdict, per_criterion_json, findings_json, repair_instructions_json, rationale, created_at)
      VALUES ('cr-insp-1', ?, 'att-insp-1', 'accept', '[]', '[]', '[]', 'Independent critic accepted changes with clean verifier proof', ?)
    `).run(taskId, now);

    // Test list tasks endpoint
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/tasks`,
    });
    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json();
    expect(listData.tasks.length).toBeGreaterThanOrEqual(1);
    expect(listData.tasks[0].id).toBe(taskId);
    expect(listData.tasks[0].attempt_count).toBe(1);

    // Test task detail inspection endpoint
    const taskRes = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`,
    });
    expect(taskRes.statusCode).toBe(200);
    const taskDetail = taskRes.json();
    expect(taskDetail.task.id).toBe(taskId);
    expect(taskDetail.attempts).toHaveLength(1);
    expect(taskDetail.attempts[0].adapter_id).toBe("mock-agent");
    expect(taskDetail.verifications).toHaveLength(1);
    expect(taskDetail.verifications[0].exit_code).toBe(0);
    expect(taskDetail.criticReviews).toHaveLength(1);
    expect(taskDetail.criticReviews[0].verdict).toBe("accept");
  });

  it("serves static visual artifacts safely via /api/v1/artifacts/", async () => {
    const artifactsDir = path.join(config.dataDir, "artifacts");
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const testArtifactFilename = `test_screenshot_${Date.now()}.png`;
    const artifactPath = path.join(artifactsDir, testArtifactFilename);
    const dummyPngData = Buffer.from("dummy-png-screenshot-content-data");
    fs.writeFileSync(artifactPath, dummyPngData);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${testArtifactFilename}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe("dummy-png-screenshot-content-data");

    // Clean up artifact
    if (fs.existsSync(artifactPath)) {
      fs.unlinkSync(artifactPath);
    }
  });
});
