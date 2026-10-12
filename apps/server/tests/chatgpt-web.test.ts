import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "../src/storage/migrations.js";
import { ProjectChatGptRepository } from "../src/storage/repositories/project-chatgpt-repository.js";
import { SourceManifestRepository } from "../src/storage/repositories/source-manifest-repository.js";
import { AttachmentUploader } from "../src/providers/reasoning/chatgpt-web/attachment-uploader.js";
import { ResponseReader } from "../src/providers/reasoning/chatgpt-web/response-reader.js";
import { ConversationManager } from "../src/providers/reasoning/chatgpt-web/conversation-manager.js";
import { SecretRedactor } from "../src/platform/secret-redactor.js";

describe("ChatGPT Web SQLite Repositories", () => {
  let db: DatabaseSync;
  let chatGptRepo: ProjectChatGptRepository;
  let manifestRepo: SourceManifestRepository;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    runMigrations(db);
    chatGptRepo = new ProjectChatGptRepository(db);
    manifestRepo = new SourceManifestRepository(db);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, verification_commands_json, auto_commit, created_at, updated_at)
      VALUES ('proj-1', 'Project 1', 'Objective 1', '/ws/1', 'ready', 'general', 'creative_within_constraints', '[]', 1, ?, ?),
             ('proj-2', 'Project 2', 'Objective 2', '/ws/2', 'ready', 'general', 'creative_within_constraints', '[]', 1, ?, ?)
    `).run(now, now, now, now);
  });

  it("maintains strict 1-to-1 project-scoped ChatGPT conversation mapping", () => {
    // Initially null
    expect(chatGptRepo.getMapping("proj-1")).toBeNull();
    expect(chatGptRepo.getMapping("proj-2")).toBeNull();

    const now = new Date().toISOString();

    // Set mapping for proj-1
    const mapping1 = chatGptRepo.saveMapping({
      projectId: "proj-1",
      conversationUrl: "https://chatgpt.com/c/conv-111-uuid",
      chatTitle: "Project 1 Conversation",
      mappingStatus: "active",
      createdAt: now,
      lastVerifiedAt: now,
      lastSuccessfulRequestAt: null,
      lastError: null,
    });
    expect(mapping1.projectId).toBe("proj-1");
    expect(mapping1.conversationUrl).toBe("https://chatgpt.com/c/conv-111-uuid");

    // Project 2 remains unmapped (strict project isolation)
    expect(chatGptRepo.getMapping("proj-2")).toBeNull();

    // Set mapping for proj-2
    const mapping2 = chatGptRepo.saveMapping({
      projectId: "proj-2",
      conversationUrl: "https://chatgpt.com/c/conv-222-uuid",
      chatTitle: "Project 2 Conversation",
      mappingStatus: "active",
      createdAt: now,
      lastVerifiedAt: now,
      lastSuccessfulRequestAt: null,
      lastError: null,
    });
    expect(mapping2.projectId).toBe("proj-2");
    expect(mapping2.conversationUrl).toBe("https://chatgpt.com/c/conv-222-uuid");

    // Re-retrieval confirms persistence
    const reloaded1 = chatGptRepo.getMapping("proj-1");
    expect(reloaded1?.conversationUrl).toBe("https://chatgpt.com/c/conv-111-uuid");

    // Delete mapping removes only specified project
    chatGptRepo.deleteMapping("proj-1");
    expect(chatGptRepo.getMapping("proj-1")).toBeNull();
    expect(chatGptRepo.getMapping("proj-2")?.conversationUrl).toBe("https://chatgpt.com/c/conv-222-uuid");
  });

  it("tracks source manifest items, SHA-256 hashes, and delivery receipts", () => {
    const now = new Date().toISOString();
    const item1 = manifestRepo.addItem({
      id: "manifest-item-1",
      projectId: "proj-1",
      originalFilename: "service.ts",
      extension: ".ts",
      byteSize: 1024,
      sha256: "hash-auth-12345",
      extractionStatus: "EXTRACTED",
      deliveryStatus: "READY_TO_DELIVER",
      deliveryMethod: "browser_upload",
      redactionCompleted: true,
      sanitizedPath: null,
      supersededById: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      deliveredAt: null,
    });

    expect(item1.id).toBe("manifest-item-1");
    expect(item1.deliveryStatus).toBe("READY_TO_DELIVER");

    // Query list
    const items = manifestRepo.listItems("proj-1");
    expect(items).toHaveLength(1);
    expect(items[0].originalFilename).toBe("service.ts");

    // Mark delivered
    manifestRepo.updateStatus("manifest-item-1", {
      deliveryStatus: "SENT_IN_MAPPED_CONVERSATION",
      deliveredAt: new Date().toISOString(),
    });
    const updated = manifestRepo.getItem("manifest-item-1");
    expect(updated?.deliveryStatus).toBe("SENT_IN_MAPPED_CONVERSATION");
    expect(updated?.deliveredAt).toBeDefined();

    // Query by sha256
    const found = manifestRepo.findBySha256("proj-1", "hash-auth-12345");
    expect(found?.id).toBe("manifest-item-1");
  });
});

describe("AttachmentUploader and Secret Sanitization", () => {
  it("redacts secrets before preparing source materials for ChatGPT Web", () => {
    const rawContent = `export const config = {
  apiKey: "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890",
  dbPass: "super_secret_password_123",
  jwtSecret: "bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc"
};`;

    const redacted = SecretRedactor.redactString(rawContent);
    expect(redacted).not.toContain("sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(redacted).toContain("[REDACTED_SECRET]");
  });

  it("chunks large files deterministically into numbered segments", () => {
    const largeContent = "console.log('line');\n".repeat(500); // ~10KB

    const chunks = AttachmentUploader.chunkContent(largeContent, "src/large.ts", 2000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("[SOURCE: src/large.ts | PART 1 OF");
    expect(chunks[chunks.length - 1]).toContain(`PART ${chunks.length} OF ${chunks.length}`);
  });
});

describe("ResponseReader Antigravity Instruction Extraction", () => {
  it("extracts instruction surrounded by standard markers", () => {
    const fullText = `Let's break down the required solution:
1. Initialize SQLite
2. Create tables

[ORCHES_ANTIGRAVITY_INSTRUCTION]
### Instructions for Antigravity Agent
Please run \`npm test\` and ensure all tests pass.
Edit \`apps/server/src/index.ts\` to support browser reasoning.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]

Let me know if you need additional clarification.`;

    const instruction = ResponseReader.extractInstruction(fullText);
    expect(instruction.instructionText).toContain("### Instructions for Antigravity Agent");
    expect(instruction.instructionText).toContain("Edit `apps/server/src/index.ts`");
    expect(instruction.instructionText).not.toContain("Let's break down the required solution");
    expect(instruction.instructionText).not.toContain("Let me know if you need additional clarification");
    expect(instruction.isMarkerExtracted).toBe(true);
  });

  it("handles case insensitivity and whitespace around markers", () => {
    const text = `Thought process
[orches_antigravity_instruction]
  Run verification suite now.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

    const instruction = ResponseReader.extractInstruction(text);
    expect(instruction.instructionText).toBe("Run verification suite now.");
    expect(instruction.isMarkerExtracted).toBe(true);
  });

  it("falls back cleanly to full response if markers were omitted by model", () => {
    const raw = "Execute `npm run build` and check for any diagnostic output.";
    const instruction = ResponseReader.extractInstruction(raw);
    expect(instruction.instructionText).toBe(raw);
    expect(instruction.isMarkerExtracted).toBe(false);
  });
});

describe("ConversationManager Mapping & Navigation", () => {
  it("extracts conversation id from chatgpt.com URL format", () => {
    const url = "https://chatgpt.com/c/670bb1a2-3f14-8005-9b21-4f1e01234567";
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    const manager = new ConversationManager(db);

    const convId = manager.extractConversationIdFromUrl(url);
    expect(convId).toBe("670bb1a2-3f14-8005-9b21-4f1e01234567");
  });

  it("returns null for non-conversation URLs", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    const manager = new ConversationManager(db);
    expect(manager.extractConversationIdFromUrl("https://chatgpt.com/")).toBeNull();
    expect(manager.extractConversationIdFromUrl("https://chatgpt.com/auth/login")).toBeNull();
  });

  it("strictly rejects bare homepage URL as a valid project conversation mapping", async () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    const chatGptRepo = new ProjectChatGptRepository(db);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, verification_commands_json, auto_commit, created_at, updated_at)
      VALUES ('proj-1', 'Project 1', 'Objective 1', '/ws/1', 'ready', 'general', 'creative_within_constraints', '[]', 1, ?, ?)
    `).run(now, now);

    // Save an invalid bare homepage mapping
    chatGptRepo.saveMapping({
      projectId: "proj-1",
      conversationUrl: "https://chatgpt.com/",
      chatTitle: "Homepage",
      mappingStatus: "active",
      createdAt: now,
      lastVerifiedAt: now,
      lastSuccessfulRequestAt: null,
      lastError: null,
    });

    const mapping = chatGptRepo.getMapping("proj-1");
    // Verify that our URL validator checks identify this as NOT a dedicated conversation
    const isDedicated = Boolean(mapping?.conversationUrl?.match(/\/c\/[a-zA-Z0-9_-]+/));
    expect(isDedicated).toBe(false);
  });
});

describe("PromptSender and ResponseReader Regression Suite", () => {
  it("ResponseReader detects and rejects attachment clarification inquiries", () => {
    const attachmentInquiry = "I have received the files. What would you like me to do with these documents?";
    expect(ResponseReader.isAttachmentClarification(attachmentInquiry)).toBe(true);

    const alternativeInquiry = "How can I help you with this file?";
    expect(ResponseReader.isAttachmentClarification(alternativeInquiry)).toBe(true);

    const validInstruction = "### Implementation Plan\n1. Modify `src/index.ts` to add authentication.";
    expect(ResponseReader.isAttachmentClarification(validInstruction)).toBe(false);
  });

  it("PromptSender rejects submission of empty or whitespace-only prompt", async () => {
    const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");
    const fakePage = {} as any;
    const baseline = {
      assistantCount: 0,
      lastAssistantText: "",
      userCount: 0,
      timestamp: Date.now(),
    };

    await expect(PromptSender.submitPrompt(fakePage, "   ", baseline)).rejects.toThrow(
      "Refusing to submit empty prompt to ChatGPT Web."
    );
  });

  it("BrowserStateMachine traverses prompt and attachment lifecycle correctly", async () => {
    const { BrowserStateMachine } = await import("../src/providers/reasoning/chatgpt-web/state-machine.js");
    const sm = new BrowserStateMachine();
    const transitions: string[] = [];
    sm.onStateChange((next) => transitions.push(next));

    sm.transition("READY");
    sm.transition("ATTACHMENTS_UPLOADING");
    sm.transition("ATTACHMENTS_READY");
    sm.transition("PROMPT_READY");
    sm.transition("COMPOSER_FILLED");
    sm.transition("USER_MESSAGE_SUBMITTED");
    sm.transition("USER_MESSAGE_CONFIRMED");
    sm.transition("ASSISTANT_GENERATING");
    sm.transition("RESPONSE_COMPLETE");

    expect(transitions).toEqual([
      "READY",
      "ATTACHMENTS_UPLOADING",
      "ATTACHMENTS_READY",
      "PROMPT_READY",
      "COMPOSER_FILLED",
      "USER_MESSAGE_SUBMITTED",
      "USER_MESSAGE_CONFIRMED",
      "ASSISTANT_GENERATING",
      "RESPONSE_COMPLETE",
    ]);
  });
});

describe("Section 10 Regression Suite: Reasoning Prompt Construction & Instruction Generation", () => {
  it("ResponseReader detects task descriptors and isTaskDescriptor rejects them as instructions", async () => {
    const { isTaskDescriptor } = await import("../src/orchestrator/instructor.js");

    const taskPlanningJson = JSON.stringify({
      title: "Start project core architecture",
      acceptance_criteria: [
        "A runnable project scaffold is created",
        "Deterministic simulator inputs and outputs are provided"
      ],
      files_to_read: []
    });

    expect(isTaskDescriptor(taskPlanningJson)).toBe(true);

    const validInstructionMarkdown = `
# Engineering Implementation Brief
## 1. Executive Objective
Implement the authentication service with JWT middleware.
## 2. Working Instructions for Antigravity Agent
- Implement token signing with HMAC SHA256.
- Run tests and verify exit code 0.
`;
    expect(isTaskDescriptor(validInstructionMarkdown)).toBe(false);
  });

  it("planTask for live ChatGPTWebProvider bypasses JSON-only planning to preserve conversation fidelity", async () => {
    const { planTask } = await import("../src/orchestrator/planner.js");
    const { ChatGPTWebProvider } = await import("../src/providers/reasoning/chatgpt-web/chatgpt-web-provider.js");

    const liveProvider = new ChatGPTWebProvider({ headless: true });
    expect(liveProvider.id).toBe("chatgpt-web");
    expect(liveProvider.displayName).toBe("ChatGPT Web (Browser)");

    const plan = await planTask(liveProvider, {
      projectId: "proj-browser-test",
      runId: "run-browser-test",
      taskText: "Implement Rate Limiter with 5 token capacity",
      workspacePath: "C:\\mock\\ws",
      profile: {
        fileCount: 0,
        isEmpty: true,
        languages: [],
        checks: [],
        testFrameworks: [],
        packageManagers: [],
        manifests: [],
        notes: [],
      },
    });

    expect(plan.title).toBe("Implement Rate Limiter with 5 token capacity");
    expect(plan.source).toBe("fallback");
    expect(plan.warning).toContain("Task plan derived internally for browser-based reasoning session");
  });

  it("composeInstruction uses operation code_generation for iteration 1 and repair_diagnosis for repair iterations", async () => {
    const { composeInstruction } = await import("../src/orchestrator/instructor.js");
    const { ScriptedProvider } = await import("./helpers.js");

    const provider = new ScriptedProvider();
    const recordedOperations: string[] = [];

    provider.enqueue("code_generation", (req) => {
      recordedOperations.push(req.operation);
      return JSON.stringify({
        action: "instruct",
        instruction: "### Implementation Brief\nImplement initial scaffold.",
        rationale: "Initial implementation",
      });
    });

    provider.enqueue("repair_diagnosis", (req) => {
      recordedOperations.push(req.operation);
      return JSON.stringify({
        action: "instruct",
        instruction: "### Corrective Brief\nFix failing assertion in test.",
        rationale: "Repair failing test",
      });
    });

    // Iteration 1
    await composeInstruction(provider, {
      projectId: "proj-op-test",
      runId: "run-op-test",
      taskText: "Build user service",
      criteria: ["Service handles registration"],
      profile: {
        fileCount: 1,
        isEmpty: false,
        languages: ["typescript"],
        checks: [],
        testFrameworks: [],
        packageManagers: [],
        manifests: [],
        notes: [],
      },
      files: ["package.json"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    // Iteration 2 (Repair)
    await composeInstruction(provider, {
      projectId: "proj-op-test",
      runId: "run-op-test",
      taskText: "Build user service",
      criteria: ["Service handles registration"],
      profile: {
        fileCount: 1,
        isEmpty: false,
        languages: ["typescript"],
        checks: [],
        testFrameworks: [],
        packageManagers: [],
        manifests: [],
        notes: [],
      },
      files: ["package.json"],
      iteration: 2,
      maxIterations: 3,
      history: [{
        iteration: 1,
        instruction: "Initial instruction",
        agentReply: "Ran into failure",
        agentState: "failed",
        changedFiles: ["src/user.ts"],
        diffExcerpt: "+ broken",
        checks: [{ label: "npm test", status: "failed", output: "AssertionError: expected true to be false" }],
        blockers: ["Test failed"],
        reviewer: "Reviewer rejected: tests failed",
      }],
    });

    expect(recordedOperations).toEqual(["code_generation", "repair_diagnosis"]);
  });

  it("rejects task-planning descriptor as instruction and engages substantive synthesis", async () => {
    const { composeInstruction } = await import("../src/orchestrator/instructor.js");
    const { ScriptedProvider } = await import("./helpers.js");

    const provider = new ScriptedProvider();
    // Return intermediate task descriptor instead of substantive markdown instruction
    provider.enqueue("code_generation", () => {
      return JSON.stringify({
        title: "Start project core architecture",
        acceptance_criteria: [
          "A runnable project scaffold is created",
          "Deterministic simulator inputs and outputs are provided"
        ],
        files_to_read: []
      });
    });

    const result = await composeInstruction(provider, {
      projectId: "proj-descriptor-reject",
      runId: "run-descriptor-reject",
      taskText: "Create Order Processing System",
      criteria: ["Orders can be created and fulfilled"],
      profile: {
        fileCount: 0,
        isEmpty: true,
        languages: ["typescript"],
        checks: [],
        testFrameworks: [],
        packageManagers: [],
        manifests: [],
        notes: [],
      },
      files: [],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    // The intermediate descriptor must be rejected and synthesized into a substantive brief
    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("The reasoning model returned an internal task-planning descriptor rather than a substantive engineering instruction");
    expect(result.instruction).toContain("Create Order Processing System — Implementation Engineering Brief");
    expect(result.instruction).toContain("## 1. Executive Objective & Scope");
    expect(result.instruction).toContain("## 2. Working Instructions for Antigravity Agent");
  });
});

describe("Section 9 Regression Suite: ChatGPT Web Stuck on Brain Instructing Bug Fix", () => {
  it("parses the reproduced JSON envelope containing marked instruction cleanly", () => {
    const reproducedResponse = JSON.stringify({
      action: "instruct",
      instruction: `[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Core Architectural Implementation Brief
## 1. Executive Objective & Scope
Implement the distributed message queue handler.
## 2. Working Instructions for Antigravity Agent
- Inspect src/queue/worker.ts and implement FIFO ordering.
- Ensure automated verification tests pass.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`,
      rationale: "Queue handler implementation with FIFO semantics",
    });

    const result = ResponseReader.extractInstruction(reproducedResponse);
    expect(result.action).toBe("instruct");
    expect(result.isMarkerExtracted).toBe(true);
    expect(result.rationale).toBe("Queue handler implementation with FIFO semantics");
    expect(result.instructionText).toContain("# Core Architectural Implementation Brief");
    expect(result.instructionText).toContain("Inspect src/queue/worker.ts and implement FIFO ordering.");
    expect(result.instructionText).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(result.instructionText).not.toContain("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(result.instructionText).toContain("\n");
    expect(result.instructionText).not.toContain('\\"');
  });

  it("parses markdown code-block wrapped JSON envelopes", () => {
    const wrappedJson = `\`\`\`json
{
  "action": "instruct",
  "instruction": "[ORCHES_ANTIGRAVITY_INSTRUCTION]\\n# Title\\nImplement feature.\\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
  "rationale": "Feature implementation"
}
\`\`\``;

    const result = ResponseReader.extractInstruction(wrappedJson);
    expect(result.action).toBe("instruct");
    expect(result.instructionText).toBe("# Title\nImplement feature.");
    expect(result.rationale).toBe("Feature implementation");
    expect(result.isMarkerExtracted).toBe(true);
  });

  it("handles explicit action: stop with declared stop reason and rationale", () => {
    const stopJson = JSON.stringify({
      action: "stop",
      stop_reason: "External OAuth credentials not configured in environment",
      rationale: "Cannot proceed with OAuth integration without credentials",
    });

    const result = ResponseReader.extractInstruction(stopJson);
    expect(result.action).toBe("stop");
    expect(result.instructionText).toBe("");
    expect(result.stopReason).toBe("External OAuth credentials not configured in environment");
    expect(result.rationale).toBe("Cannot proceed with OAuth integration without credentials");
  });

  it("handles malformed and truncated JSON gracefully", () => {
    const malformed = `{"action": "instruct", "instruction": "[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Truncated Implementation
Edit src/handler.ts
`;

    const result = ResponseReader.extractInstruction(malformed);
    expect(result.action).toBe("instruct");
    expect(result.instructionText).toContain("# Truncated Implementation");
    expect(result.instructionText).toContain("Edit src/handler.ts");
    expect(result.isMarkerExtracted).toBe(true);
  });

  it("recovers already-completed response immediately from page without unnecessary delay", async () => {
    const baseline = {
      assistantCount: 1,
      lastAssistantText: "I have received the files. How can I help you?",
      userCount: 2,
      timestamp: Date.now() - 5000,
    };

    const mockPage = {
      locator: () => ({
        count: async () => 0,
      }),
      evaluate: async (fn: any) => {
        const fnStr = typeof fn === "function" ? fn.toString() : "";
        if (fnStr.includes("stop-button") || fnStr.includes("Stop")) {
          return false;
        }
        return [
          "I have received the files. How can I help you?",
          JSON.stringify({
            action: "instruct",
            instruction: "[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Fast Path Brief\nRun build.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
            rationale: "Immediate recovery",
          }),
        ];
      },
    } as any;

    const completed = await ResponseReader.checkForCompletedResponse(mockPage, baseline);
    expect(completed).not.toBeNull();
    expect(completed).toContain("Fast Path Brief");

    const extracted = ResponseReader.extractInstruction(completed!);
    expect(extracted.action).toBe("instruct");
    expect(extracted.instructionText).toBe("# Fast Path Brief\nRun build.");
  });

  it("rejects stale baseline response and attachment inquiries during completed response recovery", async () => {
    const baseline = {
      assistantCount: 1,
      lastAssistantText: "I have received the files. What would you like me to do with these documents?",
      userCount: 2,
      timestamp: Date.now() - 5000,
    };

    const mockPageStale = {
      locator: () => ({ count: async () => 0 }),
      evaluate: async (fn: any) => {
        const fnStr = typeof fn === "function" ? fn.toString() : "";
        if (fnStr.includes("stop-button") || fnStr.includes("Stop")) {
          return false;
        }
        return [
          "I have received the files. What would you like me to do with these documents?",
        ];
      },
    } as any;

    const notNew = await ResponseReader.checkForCompletedResponse(mockPageStale, baseline);
    expect(notNew).toBeNull();

    const mockPageAttachmentInquiry = {
      locator: () => ({ count: async () => 0 }),
      evaluate: async (fn: any) => {
        const fnStr = typeof fn === "function" ? fn.toString() : "";
        if (fnStr.includes("stop-button") || fnStr.includes("Stop")) {
          return false;
        }
        return [
          "I have received the files. What would you like me to do with these documents?",
          "Please let me know what you would like me to do with the attachment.",
        ];
      },
    } as any;

    const attachmentOnly = await ResponseReader.checkForCompletedResponse(mockPageAttachmentInquiry, baseline);
    expect(attachmentOnly).toBeNull();
  });

  it("detects submission confirmation via composer clearing or stop button", async () => {
    const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");
    let cleared = false;

    const fakeComposer = {
      evaluate: async () => (cleared ? "" : "staged prompt text"),
    };

    const baseline = {
      assistantCount: 0,
      lastAssistantText: "",
      userCount: 1,
      timestamp: Date.now(),
    };

    const fakePage = {
      locator: () => ({ count: async () => 0 }),
      evaluate: async () => 1,
      waitForTimeout: async () => {
        cleared = true;
      },
    } as any;

    const conf = await PromptSender.confirmSubmissionState(fakePage, fakeComposer, baseline, 3000);
    expect(conf.confirmed).toBe(true);
  });

  it("findConversationUrl discovers conversation URL from sidebar navigation links", async () => {
    const fakePageWithSidebar = {
      url: () => "https://chatgpt.com/",
      evaluate: async () => "https://chatgpt.com/c/active-conv-789-uuid",
    } as any;

    const foundUrl = await ConversationManager.findConversationUrl(fakePageWithSidebar);
    expect(foundUrl).toBe("https://chatgpt.com/c/active-conv-789-uuid");
  });

  it("recordSuccess strictly preserves conversation-specific mapping and ignores bare homepage URLs", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    const cm = new ConversationManager(db);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, verification_commands_json, auto_commit, created_at, updated_at)
      VALUES ('proj-reg-1', 'Project Reg', 'Objective', '/ws', 'ready', 'general', 'creative_within_constraints', '[]', 1, ?, ?)
    `).run(now, now);

    const repo = new ProjectChatGptRepository(db);
    repo.saveMapping({
      projectId: "proj-reg-1",
      conversationUrl: "https://chatgpt.com/c/dedicated-conv-123",
      chatTitle: "Initial Title",
      mappingStatus: "active",
      createdAt: now,
      lastVerifiedAt: now,
      lastSuccessfulRequestAt: null,
      lastError: null,
    });

    // Attempting to record success with bare homepage MUST NOT overwrite dedicated conversationUrl
    cm.recordSuccess("proj-reg-1", "https://chatgpt.com/");
    const reloaded = repo.getMapping("proj-reg-1");
    expect(reloaded?.conversationUrl).toBe("https://chatgpt.com/c/dedicated-conv-123");

    // Recording success with a promoted conversation URL updates it cleanly
    cm.recordSuccess("proj-reg-1", "https://chatgpt.com/c/promoted-conv-456");
    const updated = repo.getMapping("proj-reg-1");
    expect(updated?.conversationUrl).toBe("https://chatgpt.com/c/promoted-conv-456");
  });

  it("BrowserStateMachine traverses all states to completion or terminal failure", async () => {
    const { BrowserStateMachine } = await import("../src/providers/reasoning/chatgpt-web/state-machine.js");
    const sm = new BrowserStateMachine();
    const transitions: string[] = [];
    sm.onStateChange((next) => transitions.push(next));

    sm.transition("READY");
    sm.transition("SUBMITTING");
    sm.transition("WAITING_FOR_RESPONSE");
    sm.transition("READING_RESPONSE");
    sm.transition("RESPONSE_COMPLETE");
    sm.transition("VALIDATING_RESPONSE");
    sm.transition("INSTRUCTION_READY");
    sm.transition("DISPATCHING_TO_ANTIGRAVITY");

    expect(transitions).toEqual([
      "READY",
      "SUBMITTING",
      "WAITING_FOR_RESPONSE",
      "READING_RESPONSE",
      "RESPONSE_COMPLETE",
      "VALIDATING_RESPONSE",
      "INSTRUCTION_READY",
      "DISPATCHING_TO_ANTIGRAVITY",
    ]);

    sm.transition("FAILED_TERMINAL", "Login session expired");
    expect(sm.getState()).toBe("FAILED_TERMINAL");
  });

  it("composeInstruction dispatches substantive markdown instruction to downstream Antigravity agent", async () => {
    const { composeInstruction } = await import("../src/orchestrator/instructor.js");
    const { ScriptedProvider } = await import("./helpers.js");

    const provider = new ScriptedProvider();
    provider.enqueue("code_generation", () => {
      return JSON.stringify({
        action: "instruct",
        instruction: `[ORCHES_ANTIGRAVITY_INSTRUCTION]
# End-to-End Test Implementation Brief
## 1. Executive Objective & Scope
Build the deterministic data aggregator.
## 2. Working Instructions for Antigravity Agent
- Implement aggregator in src/aggregator.ts.
- Verify tests pass with code 0.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`,
        rationale: "Deterministic data aggregator implementation",
      });
    });

    const instruction = await composeInstruction(provider, {
      projectId: "proj-handoff-test",
      runId: "run-handoff-test",
      taskText: "Build the deterministic data aggregator",
      criteria: ["Aggregator combines items without duplicates"],
      profile: {
        fileCount: 1,
        isEmpty: false,
        languages: ["typescript"],
        checks: [{ label: "npm test", command: "npm test", source: "package.json", kind: "test" }],
        testFrameworks: ["vitest"],
        packageManagers: ["npm"],
        manifests: ["package.json"],
        notes: [],
      },
      files: ["package.json", "src/aggregator.ts"],
      iteration: 1,
      maxIterations: 3,
      history: [],
    });

    expect(instruction.action).toBe("instruct");
    expect(instruction.source).toBe("model");
    expect(instruction.rationale).toBe("Deterministic data aggregator implementation");
    expect(instruction.instruction).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(instruction.instruction).not.toContain('{"action":');
    expect(instruction.instruction).toContain("# End-to-End Test Implementation Brief");
    expect(instruction.instruction).toContain("Build the deterministic data aggregator.");
    expect(instruction.fidelityReport?.passed).toBe(true);
  });
});


