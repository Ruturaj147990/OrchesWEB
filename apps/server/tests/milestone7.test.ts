import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../src/app.js";
import { closeDb, initDb } from "../src/storage/db.js";
import { runMigrations } from "../src/storage/migrations.js";
import { SecretRedactor } from "../src/platform/secret-redactor.js";
import { config } from "../src/config/env.js";

describe("Milestone 7 — Advanced UI, Export, Security Hardening and Final Verification", () => {
  let app: FastifyInstance;
  let testWorkspace: string;
  let testDbPath: string;

  beforeAll(async () => {
    closeDb();
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "m7-workspace-"));
    testDbPath = path.join(testWorkspace, "m7-test.sqlite");

    // Initialize repo memory files
    fs.mkdirSync(path.join(testWorkspace, ".orchestrator"), { recursive: true });
    fs.writeFileSync(path.join(testWorkspace, "SPEC.md"), "# Secret Specification\nAPI key: sk-antigravitytestkey1234567890abcdef\n");
    fs.writeFileSync(
      path.join(testWorkspace, ".orchestrator", "ROADMAP.md"),
      "# Approved Roadmap\n- ROADMAP-001: Implement and harden security gates\n"
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

  it("redacts credentials and API keys in strings and complex nested objects", () => {
    const rawApiKey = "sk-1234567890abcdef1234567890abcdef";
    const rawBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload123";
    const sampleText = `Connecting with ${rawApiKey} and auth ${rawBearer}`;

    const redacted = SecretRedactor.redactString(sampleText);
    expect(redacted).not.toContain(rawApiKey);
    expect(redacted).toContain("[REDACTED_SECRET]");

    const nestedObj = {
      apiKey: rawApiKey,
      config: {
        token: rawBearer,
        password: "supersecretpassword123",
        safeValue: "public-read-only",
      },
    };

    const sanitized = SecretRedactor.redactObject(nestedObj);
    expect(sanitized.apiKey).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.config.token).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.config.password).toBe("[REDACTED_CREDENTIAL]");
    expect(sanitized.config.safeValue).toBe("public-read-only");
  });

  it("exports project memory, tasks, and audit log as sanitized JSON bundle", async () => {
    // 1. Create test project in db
    const db = initDb(testDbPath);
    runMigrations(db);

    const now = new Date().toISOString();
    const projectId = "proj-export-test";

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, objective, root_path, profile_id, autonomy_mode, status, created_at, updated_at)
      VALUES (?, 'Export Test Project', 'Verify export endpoints', ?, 'general', 'creative_within_constraints', 'ready', ?, ?)
    `).run(projectId, testWorkspace, now, now);

    db.prepare(`
      INSERT INTO tasks (id, project_id, run_id, title, objective, roadmap_item_id, status, priority, risk, created_at, updated_at)
      VALUES ('task-exp-1', ?, 'run-exp-1', 'Harden Loopback', 'Verify binding', 'ROADMAP-001', 'succeeded', 'high', 'low', ?, ?)
    `).run(projectId, now, now);

    db.prepare(`
      INSERT INTO verification_runs (id, task_id, attempt_id, check_type, command, argv_json, cwd, status, exit_code, duration_ms, stdout_snippet, stderr_snippet, truncated, timestamp)
      VALUES ('vr-exp-1', 'task-exp-1', 'att-1', 'test', 'npm test', '["npm","test"]', ?, 'passed', 0, 120, 'Passed with sk-1234567890abcdef1234567890abcdef', '', 0, ?)
    `).run(testWorkspace, now);

    // 2. Fetch JSON export
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/export`,
    });

    expect(res.statusCode).toBe(200);
    const bundle = res.json();

    expect(bundle.project.id).toBe(projectId);
    expect(bundle.memory.spec).toContain("[REDACTED_SECRET]");
    expect(bundle.memory.spec).not.toContain("sk-antigravitytestkey1234567890abcdef");
    expect(bundle.memory.roadmap).toContain("ROADMAP-001");
    expect(bundle.tasks).toHaveLength(1);
    expect(bundle.verifications).toHaveLength(1);
    expect(bundle.verifications[0].stdout_snippet).toContain("[REDACTED_SECRET]");
  });

  it("exports project run report as formatted Markdown document", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/proj-export-test/export?format=markdown`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");

    const mdContent = res.body;
    expect(mdContent).toContain("# Autonomous Orchestration Run Report: Export Test Project");
    expect(mdContent).toContain("## 1. Project Objective & Memory Summary");
    expect(mdContent).toContain("## 2. Tasks & Independent Verification Evidence");
    expect(mdContent).toContain("ROADMAP-001");
    expect(mdContent).not.toContain("sk-antigravitytestkey1234567890abcdef");
  });

  it("enforces strict loopback policy and rejects disallowed external CORS origins", async () => {
    // Valid loopback origin
    const validRes = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        origin: "http://127.0.0.1:5173",
      },
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");

    // Foreign origin from the internet
    const foreignRes = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        origin: "http://malicious-external-attacker.com",
      },
    });
    // Fastify CORS rejected callback will return 500 error or refuse origin header
    expect(
      foreignRes.statusCode === 500 ||
      foreignRes.headers["access-control-allow-origin"] !== "http://malicious-external-attacker.com"
    ).toBe(true);
  });
});
