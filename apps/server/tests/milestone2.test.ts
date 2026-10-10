import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ReasoningRegistry } from "../src/providers/reasoning/registry.js";
import { OpenAICompatibleLocalProvider } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { AntigravityAdapter } from "../src/providers/coding-agents/antigravity/antigravity-adapter.js";
import { MockAgentAdapter } from "../src/providers/coding-agents/mock/mock-adapter.js";
import { BudgetService, BudgetExceededError } from "../src/domain/budgets/budget-service.js";
import { Task, AgentReportSchema } from "@orchestrator/shared-types";

describe("Milestone 2 — Providers, Adapters, and Budget Enforcement", () => {
  const dummyTask: Task = {
    id: "task-0002",
    projectId: "proj-0002",
    runId: "run-0002",
    title: "Implement Token Bucket Rate Limiter",
    objective: "Add rate limiting middleware",
    roadmapItemId: "ROADMAP-002",
    requirementIds: [],
    status: "running",
    priority: "high",
    risk: "medium",
    allowedPaths: ["src/**"],
    forbiddenPaths: [".env*"],
    acceptanceCriteria: [],
    verificationPlan: ["npm test"],
    attemptCount: 1,
    currentAttemptId: "att-0002-1",
    maxAttempts: 3,
    requiresApproval: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("manages reasoning providers and exposes privacy classes honestly", () => {
    const registry = new ReasoningRegistry();
    const list = registry.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const local = registry.get("openai-compatible-local");
    expect(local).toBeDefined();
    expect(local?.privacyClass).toBe("local");

    const cloud = registry.get("openai");
    expect(cloud).toBeDefined();
    expect(cloud?.privacyClass).toBe("cloud");
  });

  it("enforces local-only reasoning and never silently falls back to cloud on failure", async () => {
    // Point to non-existent local port
    const local = new OpenAICompatibleLocalProvider({
      baseUrl: "http://127.0.0.1:59999/v1",
      model: "llama3.1:8b",
    });

    const health = await local.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toContain("Local-only mode strictly forbids falling back to cloud");

    await expect(
      local.generate({
        operation: "task_planning",
        systemInstruction: "You are planner.",
        messages: [{ role: "user", content: "Plan task." }],
        dataClassification: "internal",
        projectId: "proj-01",
      })
    ).rejects.toThrow(/Local-Only Policy Enforcement/);
  });

  it("probes Antigravity CLI and returns honest diagnostic when not installed", async () => {
    const adapter = new AntigravityAdapter("non_existent_agy_binary_xyz");
    const detection = await adapter.detectInstallation();

    expect(detection.installed).toBe(false);
    expect(detection.message).toContain("Install from https://www.antigravity.google/docs/cli/overview");
  });

  it("executes tasks with MockAgentAdapter producing validated reports and modifying workspace files", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-test-"));
    try {
      const mock = new MockAgentAdapter({
        mode: "success",
        filesToModify: [
          { relativePath: "src/rate-limiter.ts", content: "export const rateLimit = true;" },
        ],
      });

      const report = await mock.executeTask(dummyTask, tempDir, "Bounded task context");
      const validated = AgentReportSchema.parse(report);

      expect(validated.status).toBe("reported_complete");
      expect(validated.files_changed).toContain("src/rate-limiter.ts");

      // Verify file was actually created on disk in target workspace
      const createdFile = path.join(tempDir, "src", "rate-limiter.ts");
      expect(fs.existsSync(createdFile)).toBe(true);
      expect(fs.readFileSync(createdFile, "utf8")).toBe("export const rateLimit = true;");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles agent permission requests as explicit blocker states", async () => {
    const mock = new MockAgentAdapter({ mode: "permission_denied" });
    const report = await mock.executeTask(dummyTask, process.cwd(), "context");

    expect(report.status).toBe("awaiting_permission");
    expect(report.requires_human).toBe(true);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it("enforces budgets, estimates token costs, and blocks calls exceeding hard ceilings", () => {
    const budgetService = new BudgetService({
      perRunHardUsd: 0.10, // Small ceiling for testing hard cut-off
      perTaskWarningUsd: 0.01,
    });

    // 1. Local calls incur $0 direct API charge
    const localCost = budgetService.calculateCost("llama3.1:8b", 2000, 500);
    expect(localCost.costUsd).toBe(0);
    expect(localCost.costState).toBe("local_no_api_charge");

    // 2. Cloud calls compute accurate costs from pricing catalogue
    // gpt-4o: $2.50 / 1M in, $10.00 / 1M out -> 10,000 in ($0.025) + 5,000 out ($0.050) = $0.075
    const cloudCost = budgetService.calculateCost("gpt-4o", 10_000, 5_000);
    expect(cloudCost.costUsd).toBeCloseTo(0.075, 4);

    // Record call
    const res = budgetService.recordCall("gpt-4o", 10_000, 5_000);
    expect(res.softWarning).toBe(true); // Exceeds $0.01 soft warning

    // 3. Pre-flight check blocks call when worst-case exceeds $0.10 hard ceiling
    expect(() => {
      budgetService.reserveAndCheckPreflight("gpt-4o", 20_000); // 20k tokens will push total over $0.10
    }).toThrow(BudgetExceededError);
  });

  it("supports querying and switching active reasoning provider via REST API", async () => {
    const { buildApp } = await import("../src/app.js");
    const { closeDb } = await import("../src/storage/db.js");

    closeDb();
    const app = await buildApp(":memory:");

    try {
      // 1. Get reasoning providers
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/providers/reasoning",
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.providers.length).toBeGreaterThanOrEqual(2);
      expect(data.activeProviderId).toBe("openai-compatible-local");

      // 2. Switch to OpenAI provider
      const selectRes = await app.inject({
        method: "POST",
        url: "/api/v1/providers/reasoning/select",
        payload: {
          providerId: "openai",
          apiKey: "sk-test-live-key-1234567890abcdef",
          model: "gpt-4o-mini",
        },
      });
      expect(selectRes.statusCode).toBe(200);
      const selectData = selectRes.json();
      expect(selectData.success).toBe(true);
      expect(selectData.activeProviderId).toBe("openai");
      expect(selectData.activeProvider.privacyClass).toBe("cloud");

      // 3. Switch back to local
      const switchBackRes = await app.inject({
        method: "POST",
        url: "/api/v1/providers/reasoning/select",
        payload: {
          providerId: "openai-compatible-local",
        },
      });
      expect(switchBackRes.statusCode).toBe(200);
      expect(switchBackRes.json().activeProviderId).toBe("openai-compatible-local");
    } finally {
      await app.close();
      closeDb();
    }
  });
});

