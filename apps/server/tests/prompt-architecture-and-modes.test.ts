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
