import { describe, it, expect, afterAll } from "vitest";
import { composeInstruction } from "../src/orchestrator/instructor.js";
import { planTask } from "../src/orchestrator/planner.js";
import { getProjectProfile } from "../src/domain/profiles/project-profiles.js";
import { ScriptedProvider } from "./helpers.js";
import type { ProjectProfile as WorkspaceProfile } from "../src/workspace/project-inspector.js";

const dummyWorkspace: WorkspaceProfile = {
  rootPath: "C:\\mock\\project",
  isEmpty: false,
  fileCount: 12,
  languages: ["typescript"],
  manifests: ["package.json"],
  checks: [{ id: "test", kind: "test", label: "npm test", source: "package.json", timeoutMs: 10_000 }],
  notes: [],
};

describe("Prompt Architecture: Comprehensive Engineering Briefs", () => {
  it("instructs the reasoning model to generate an engineering brief without micro-managing full file source code", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue("repair_diagnosis", (req) => {
      // Assert that the system prompt strictly instructs the model not to write full source files
      expect(req.systemInstruction).toContain("DO NOT write the source code yourself");
      expect(req.systemInstruction).toContain("The agent is a capable engineer");
      expect(req.systemInstruction).toContain("Engineering Brief");

      return JSON.stringify({
        action: "instruct",
        instruction: "### Engineering Brief: Authentication Service\n\nImplement JWT authentication with express middleware.",
        rationale: "Initial feature engineering brief",
      });
    });

    const brief = await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Implement JWT authentication with /login endpoint and auth middleware",
      criteria: ["POST /login issues JWT", "authMiddleware validates Bearer tokens"],
      profile: dummyWorkspace,
      files: ["src/app.ts", "src/routes.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(brief.action).toBe("instruct");
    expect(brief.instruction).toContain("Engineering Brief");
    expect(brief.source).toBe("model");
  });
});

describe("Autonomy & Creativity Modes in Reasoning Prompts", () => {
  it("incorporates 'creative_within_constraints' directive into the prompt", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Build responsive search component",
      criteria: ["Search filters products"],
      profile: dummyWorkspace,
      autonomyMode: "creative_within_constraints",
      files: ["src/index.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("MODE: Creative within constraints");
    expect(promptSent).toContain("Encourage innovative, robust, and clean technical solutions");
    expect(promptSent).toContain("strictly adhering to user requirements");
  });

  it("incorporates 'creative_exploration' directive into the prompt", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Build search component",
      criteria: ["Search works"],
      profile: dummyWorkspace,
      autonomyMode: "creative_exploration",
      files: ["src/index.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("MODE: Creative exploration (Soft constraints)");
    expect(promptSent).toContain("Grant greater autonomy in architectural design");
    expect(promptSent).toContain("reconsidered if a superior, cleaner, or more performant alternative exists");
  });

  it("incorporates 'strict_blueprint_adherence' directive into the prompt", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Implement exact spec",
      criteria: ["Spec fulfilled"],
      profile: dummyWorkspace,
      autonomyMode: "strict_blueprint_adherence",
      files: ["src/index.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("MODE: Strict instruction & blueprint adherence");
    expect(promptSent).toContain("Prioritize exact, faithful implementation");
    expect(promptSent).toContain("Strictly discourage unsolicited features, speculative redesigns");
  });
});

describe("Project Profiles in Reasoning Prompts", () => {
  it("tailors prompt guidelines specifically for AI/ML projects", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    const aimlProfile = getProjectProfile("ai_ml");
    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Train text classification model",
      criteria: ["Accuracy > 85%"],
      profile: dummyWorkspace,
      profileDefinition: aimlProfile,
      files: ["train.py"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("PROJECT PROFILE: AI / ML Project");
    expect(promptSent).toContain("train/validation/test split integrity and verify zero data leakage");
    expect(promptSent).toContain("Fix random seeds for reproducible evaluations");
    expect(promptSent).toContain("Inference smoke testing");
  });

  it("tailors prompt guidelines specifically for Full-Stack projects", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    const fullstackProfile = getProjectProfile("fullstack");
    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Build user dashboard",
      criteria: ["Dashboard loads metrics from API"],
      profile: dummyWorkspace,
      profileDefinition: fullstackProfile,
      files: ["client/app.tsx", "server/api.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("PROJECT PROFILE: Full-Stack Application");
    expect(promptSent).toContain("clear frontend/backend integration contracts");
    expect(promptSent).toContain(".env.example (without secrets)");
    expect(promptSent).toContain("error and loading states");
  });

  it("tailors prompt guidelines specifically for CLI tool projects", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({ action: "instruct", instruction: "Brief", rationale: "" });
    });

    const cliProfile = getProjectProfile("cli_tool");
    await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Add --json output flag to CLI",
      criteria: ["--json outputs machine-readable data"],
      profile: dummyWorkspace,
      profileDefinition: cliProfile,
      files: ["bin/cli.js"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(promptSent).toContain("PROJECT PROFILE: CLI / Developer Tool");
    expect(promptSent).toContain("--help and --version output");
    expect(promptSent).toContain("standard process exit codes");
  });
});

describe("Blueprint Integration and Iteration Preservation", () => {
  it("injects blueprint requirements into prompt and preserves them across repair iterations", async () => {
    const provider = new ScriptedProvider();
    const prompts: string[] = [];

    provider.enqueue(
      "repair_diagnosis",
      (req) => {
        prompts.push(req.messages[0].content);
        return JSON.stringify({ action: "instruct", instruction: "Initial Brief", rationale: "start" });
      },
      (req) => {
        prompts.push(req.messages[0].content);
        return JSON.stringify({ action: "instruct", instruction: "Repair Brief", rationale: "fix failure" });
      }
    );

    const bpReqs = [
      {
        id: "REQ-001",
        projectId: "proj-1",
        title: "OAuth2 Token Validation",
        description: "Validates bearer token on all private routes",
        provenanceKind: "explicit" as const,
        sourceReference: "spec.md:Line 15",
        status: "approved" as const,
        proposedAcceptanceTest: "Automated test for invalid token rejection",
        createdAt: new Date().toISOString(),
      },
    ];

    // Iteration 1
    const brief1 = await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Implement auth middleware",
      criteria: ["Rejects expired tokens"],
      profile: dummyWorkspace,
      blueprintRequirements: bpReqs,
      files: ["src/auth.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });
    expect(brief1.action).toBe("instruct");
    expect(prompts[0]).toContain("MASTER BLUEPRINT REQUIREMENTS:");
    expect(prompts[0]).toContain("[REQ-001] (explicit) OAuth2 Token Validation");

    // Iteration 2 (Repair iteration with failing check output)
    const brief2 = await composeInstruction(provider, {
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Implement auth middleware",
      criteria: ["Rejects expired tokens"],
      profile: dummyWorkspace,
      blueprintRequirements: bpReqs,
      files: ["src/auth.ts"],
      iteration: 2,
      maxIterations: 3,
      history: [
        {
          iteration: 1,
          instruction: "Initial Brief",
          agentReply: "I wrote auth.ts",
          agentState: "completed",
          changedFiles: ["src/auth.ts"],
          diffExcerpt: "+ export function auth() {}",
          checks: [{ label: "npm test", status: "failed", output: "AssertionError: Expected 401 but got 200" }],
          blockers: ["npm test failed"],
          reviewer: "Token validation not enforced",
        },
      ],
    });

    expect(brief2.action).toBe("instruct");
    // Crucial: Blueprint requirements must persist into iteration 2
    expect(prompts[1]).toContain("[REQ-001] (explicit) OAuth2 Token Validation");
    // Crucial: Real check failure output must be fed to the model
    expect(prompts[1]).toContain("AssertionError: Expected 401 but got 200");
    expect(prompts[1]).toContain("Iteration 1");
  });
});

describe("Semantic Quality Gate: Rejection of Shallow Meta-Prompts & Substantive Synthesis", () => {
  it("rejects a shallow meta-prompt and synthesizes a full substantive engineering brief for Library Management System", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue("repair_diagnosis", () => {
      // Return the exact shallow meta-instruction that previously affected the application
      return JSON.stringify({
        action: "instruct",
        instruction: "Construct a comprehensive Markdown Engineering Brief for the Antigravity Agent to implement the Library Management System, adhering to project guidelines and constraints.",
        rationale: "Delegated brief creation to agent",
      });
    });

    const brief = await composeInstruction(provider, {
      projectId: "proj-lib-1",
      runId: "run-lib-1",
      taskText: "Library Management System",
      criteria: ["Book checkout and return functional", "Overdue calculations correct"],
      profile: dummyWorkspace,
      files: ["app.py", "models.py"],
      iteration: 1,
      maxIterations: 4,
      history: [],
    });

    expect(brief.action).toBe("instruct");
    // Crucial: The shallow meta-instruction must be rejected
    expect(brief.source).toBe("fallback");
    expect(brief.warning).toContain("The reasoning model returned a meta-instruction");

    // Crucial: The synthesized brief must contain actual domain substance, not a meta-sentence
    expect(brief.instruction).toContain("# Library Management System — Implementation Engineering Brief");
    expect(brief.instruction).toContain("## 1. Executive Objective & Scope");
    expect(brief.instruction).toContain("## 2. Working Instructions for Antigravity Agent");
    expect(brief.instruction).toContain("## 5. Functional Specifications & Domain Workflows");

    // Must include domain entities
    expect(brief.instruction).toContain("**Book**");
    expect(brief.instruction).toContain("**Member**");
    expect(brief.instruction).toContain("**Loan / Checkout**");

    // Must include operational workflows
    expect(brief.instruction).toContain("Catalog Management");
    expect(brief.instruction).toContain("Circulation (Checkout)");
    expect(brief.instruction).toContain("Circulation (Return)");

    // Must include business rules
    expect(brief.instruction).toContain("Zero-Copy Rejection");
    expect(brief.instruction).toContain("Loan Limit");

    // Must include verification strategy & acceptance criteria
    expect(brief.instruction).toContain("## 8. Verification Strategy & Acceptance Criteria");
    expect(brief.instruction).toContain("Book checkout and return functional");
    expect(brief.instruction).toContain("Overdue calculations correct");
  });

  it("preserves explicit user technology stacks, constraints, and custom contracts in full fidelity", async () => {
    const provider = new ScriptedProvider();
    let promptSent = "";
    provider.enqueue("repair_diagnosis", (req) => {
      promptSent = req.messages[0].content;
      return JSON.stringify({
        action: "instruct",
        instruction: `# Custom Microservice Implementation Prompt
## 1. Architecture & Required Stack
- Framework: Fastify v4.26 with Node.js
- Persistence: SQLite with Better-SQLite3 (Strictly NO ORMs: No TypeORM, No Prisma)
- Validation: Zod schemas
- Endpoints: POST /api/v1/tokens, GET /api/v1/status
## 2. Acceptance Criteria
- All endpoints respond with JSON
- Rate limiter blocks requests exceeding 100 req/min`,
        rationale: "Preserved explicit stack",
      });
    });

    const detailedTask = `Build Token Service with strict requirements:
- Mandatory Stack: Fastify v4.26, SQLite via Better-SQLite3
- FORBIDDEN: Do not use TypeORM, Prisma, or Express.
- Endpoints: POST /api/v1/tokens, GET /api/v1/status
- Rule: Issue JWTs signed with RS256.`;

    const brief = await composeInstruction(provider, {
      projectId: "proj-strict",
      runId: "run-strict",
      taskText: detailedTask,
      criteria: ["POST /api/v1/tokens issues RS256 signed JWT", "Better-SQLite3 used directly without ORM"],
      profile: dummyWorkspace,
      files: ["package.json", "src/server.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    // The user's explicit task must be conveyed to the model
    expect(promptSent).toContain("Mandatory Stack: Fastify v4.26");
    expect(promptSent).toContain("FORBIDDEN: Do not use TypeORM, Prisma, or Express");

    // The substantive brief from the model is accepted and preserved
    expect(brief.action).toBe("instruct");
    expect(brief.source).toBe("model");
    expect(brief.instruction).toContain("Fastify v4.26");
    expect(brief.instruction).toContain("Strictly NO ORMs: No TypeORM, No Prisma");
  });
});

describe("Universal Project Specification & Instructions Ingestion", () => {
  it("incorporates persistent project objective into task planning and prompt generation", async () => {
    const provider = new ScriptedProvider();
    let planningPrompt = "";
    let instructionPrompt = "";

    provider.enqueue("task_planning", (req) => {
      planningPrompt = req.messages[0].content;
      return JSON.stringify({
        title: "Implement Library Catalog",
        acceptance_criteria: ["Search books by title or author", "Display available copies count"],
        files_to_read: ["catalog.ts"],
      });
    });
    provider.enqueue("code_generation", (req) => {
      instructionPrompt = req.messages[0].content;
      return JSON.stringify({
        action: "instruct",
        instruction: `# Implementation Prompt
## 1. Scope
Follow Universal Project Specifications.`,
        rationale: "Incorporate universal spec",
      });
    });

    const universalSpec = `GLOBAL ARCHITECTURE RULES:
- Use TypeScript strict mode everywhere
- All dates must be stored in ISO 8601 UTC
- Enforce repository pattern with dependency injection`;

    // 1. Task Planning
    const plan = await planTask(provider, {
      projectId: "proj-spec-1",
      runId: "run-spec-1",
      taskText: "Implement Book Catalog",
      projectObjective: universalSpec,
      workspacePath: "C:\\mock\\project",
      profile: dummyWorkspace,
    });

    expect(plan.title).toBe("Implement Library Catalog");
    expect(planningPrompt).toContain("PROJECT SPECIFICATION & INSTRUCTIONS (Universal Guidelines):");
    expect(planningPrompt).toContain("GLOBAL ARCHITECTURE RULES:");
    expect(planningPrompt).toContain("All dates must be stored in ISO 8601 UTC");

    // 2. Compose Instruction
    await composeInstruction(provider, {
      projectId: "proj-spec-1",
      runId: "run-spec-1",
      taskText: "Implement Book Catalog",
      projectObjective: universalSpec,
      criteria: plan.acceptanceCriteria,
      profile: dummyWorkspace,
      files: ["catalog.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(instructionPrompt).toContain("UNIVERSAL PROJECT SPECIFICATION & INSTRUCTIONS (Authoritative Source of Truth):");
    expect(instructionPrompt).toContain("GLOBAL ARCHITECTURE RULES:");
    expect(instructionPrompt).toContain("Enforce repository pattern with dependency injection");
  });
});

describe("User-Configurable Maximum Agent Iterations & Validation", () => {
  it("allows setting custom iterations up to 30 and enforces schema bounds", async () => {
    const { SettingsManager } = await import("../src/platform/settings-manager.js");
    const { tempDir, removeDir } = await import("./helpers.js");

    const td = tempDir("settings-test");
    try {
      SettingsManager.setDataDir(td);

      // 1. Valid custom iteration value: 10
      const s1 = SettingsManager.saveSettings({ maxAttempts: 10 });
      expect(s1.maxAttempts).toBe(10);
      expect(SettingsManager.loadSettings().maxAttempts).toBe(10);

      // 2. Valid custom iteration value: 30 (safety ceiling)
      const s2 = SettingsManager.saveSettings({ maxAttempts: 30 });
      expect(s2.maxAttempts).toBe(30);
      expect(SettingsManager.loadSettings().maxAttempts).toBe(30);

      // 3. Round-trip verification from disk
      const loaded = SettingsManager.loadSettings();
      expect(loaded.maxAttempts).toBe(30);
    } finally {
      SettingsManager.reset();
      removeDir(td);
    }
  });

  it("validates API schema bounds for maxAttempts between 1 and 30", async () => {
    const { makeApp } = await import("./helpers.js");
    const { app, dataDir } = await makeApp();
    const { removeDir } = await import("./helpers.js");

    try {
      // Valid custom limit: 12
      const res1 = await app.inject({ method: "PUT", url: "/api/v1/settings", payload: { maxAttempts: 12 } });
      expect(res1.statusCode).toBe(200);
      expect(JSON.parse(res1.body).maxAttempts).toBe(12);

      // Invalid: 0 (less than 1)
      const res2 = await app.inject({ method: "PUT", url: "/api/v1/settings", payload: { maxAttempts: 0 } });
      expect(res2.statusCode).toBe(400);

      // Invalid: 35 (exceeds safety ceiling 30)
      const res3 = await app.inject({ method: "PUT", url: "/api/v1/settings", payload: { maxAttempts: 35 } });
      expect(res3.statusCode).toBe(400);

      // Invalid: fractional float
      const res4 = await app.inject({ method: "PUT", url: "/api/v1/settings", payload: { maxAttempts: 4.5 } });
      expect(res4.statusCode).toBe(400);
    } finally {
      await app.close();
      removeDir(dataDir);
    }
  });
});

describe("Prompt Fidelity: Display Matches Submitted Bridge Prompt", () => {
  it("ensures transcript from Antigravity agent preserves exact delivered prompt", async () => {
    const { transcriptFrom } = await import("../src/providers/coding-agents/antigravity/antigravity-agent-adapter.js");

    const submitted = "[orches abc12345#1] Engineering Brief from Orches Orchestrator (iteration 1).\n### Implementation Spec\nBuild Library System";
    const transcript = transcriptFrom(null, "finished", "C:\\mock\\project", submitted);

    expect(transcript.prompt).toBe(submitted);
  });
});


