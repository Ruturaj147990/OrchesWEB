import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/index.js";
import { Task, VerificationResult } from "@orchestrator/shared-types";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  const dummyTask: Task = {
    id: "task-01",
    projectId: "proj-01",
    runId: "run-01",
    title: "Test Task",
    objective: "Verify path safety",
    roadmapItemId: "ROADMAP-01",
    requirementIds: [],
    status: "queued",
    priority: "medium",
    risk: "medium",
    allowedPaths: ["src/**"],
    forbiddenPaths: [".env*", ".orchestrator/**", "**/*.pem"],
    acceptanceCriteria: [],
    verificationPlan: ["npm test"],
    attemptCount: 0,
    currentAttemptId: null,
    maxAttempts: 3,
    requiresApproval: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("flags forbidden path modifications like .env or .orchestrator", () => {
    const violations = engine.evaluatePathPolicy(dummyTask, [
      "src/index.ts",
      ".env",
      ".orchestrator/ROADMAP.md",
      "secrets/id_rsa.pem",
    ]);

    expect(violations.length).toBe(3);
    expect(violations.some((v) => v.message.includes(".env"))).toBe(true);
    expect(violations.some((v) => v.message.includes(".orchestrator"))).toBe(true);
    expect(violations.some((v) => v.message.includes("id_rsa.pem"))).toBe(true);
  });

  it("passes safe project paths", () => {
    const violations = engine.evaluatePathPolicy(dummyTask, [
      "src/components/Button.tsx",
      "src/utils/format.ts",
    ]);
    expect(violations.length).toBe(0);
  });

  it("flags failed verification runs as hard violations", () => {
    const results: VerificationResult[] = [
      {
        id: "v-1",
        taskId: "task-01",
        attemptId: "att-01",
        checkType: "lint",
        command: "npm run lint",
        argv: ["npm", "run", "lint"],
        cwd: "/project",
        status: "passed",
        exitCode: 0,
        durationMs: 400,
        outputArtifactId: null,
        stdoutSnippet: "Clean",
        stderrSnippet: "",
        truncated: false,
        timestamp: new Date().toISOString(),
      },
      {
        id: "v-2",
        taskId: "task-01",
        attemptId: "att-01",
        checkType: "test",
        command: "npm test",
        argv: ["npm", "test"],
        cwd: "/project",
        status: "failed",
        exitCode: 1,
        durationMs: 1200,
        outputArtifactId: null,
        stdoutSnippet: "",
        stderrSnippet: "Error: assertion failed",
        truncated: false,
        timestamp: new Date().toISOString(),
      },
    ];

    const violations = engine.evaluateVerificationPolicy(results);
    expect(violations.length).toBe(1);
    expect(violations[0].class).toBe("hard");
    expect(violations[0].message).toContain("failed with exit code 1");
  });
});
