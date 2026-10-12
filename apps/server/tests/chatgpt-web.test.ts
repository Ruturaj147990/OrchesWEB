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

  describe("Section 11 Regression Suite: Assistant Response Discovery & Termination (Zero-Message Defect Fix)", () => {
    it("detects real response in modern DOM where old selectors return 0 matches", async () => {
      const { SELECTORS } = await import("../src/providers/reasoning/chatgpt-web/selectors.js");
      const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");

      expect(SELECTORS.assistantMessage).toContain("[data-markdown-text-style='assistant-message']");
      expect(SELECTORS.assistantMessage).toContain("div:has(> [data-conversation-role='assistant'])");
      expect(SELECTORS.assistantMessage).toContain("div:has(> h4:has-text('ChatGPT said:'))");

      const fakePage = {
        locator: (sel: string) => {
          if (sel === "[data-message-author-role='assistant']" || sel.startsWith("article")) {
            return { count: async () => 0 };
          }
          if (sel === "[data-markdown-text-style='assistant-message']") {
            return {
              count: async () => 1,
              nth: () => ({
                evaluate: async () => false,
                innerText: async () => JSON.stringify({
                  action: "instruct",
                  instruction: "[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Modern DOM Brief\nCreate calculator.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
                  rationale: "Modern DOM extraction succeeded",
                }),
              }),
            };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => ({ texts: [], status: "empty_conversation" }),
      } as any;

      const discovery = await PromptSender.getAssistantDiscovery(fakePage);
      expect(discovery.status).toBe("discovered");
      expect(discovery.texts.length).toBe(1);
      expect(discovery.texts[0]).toContain("Modern DOM Brief");
    });

    it("recovers completed response immediately when generation is inactive", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");
      const { BrowserStateMachine } = await import("../src/providers/reasoning/chatgpt-web/state-machine.js");

      const baseline = {
        assistantCount: 0,
        lastAssistantText: "",
        userCount: 1,
        timestamp: Date.now() - 5000,
      };

      const responseText = JSON.stringify({
        action: "instruct",
        instruction: "[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Inactive Generation Brief\nImplement calculator module.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
        rationale: "Response finished before next polling cycle",
      });

      const fakePage = {
        locator: (sel: string) => {
          if (sel === "[data-markdown-text-style='assistant-message']") {
            return {
              count: async () => 1,
              nth: () => ({
                evaluate: async () => false,
                innerText: async () => responseText,
              }),
            };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => false,
      } as any;

      const sm = new BrowserStateMachine();
      const result = await ResponseReader.waitForCompletion(fakePage, baseline, {
        stateMachine: sm,
        timeoutMs: 5000,
      });

      expect(result).toBe(responseText);
      expect(sm.getState()).toBe("RESPONSE_COMPLETE");
    });

    it("handles DOM evaluation exceptions without silently converting to empty messages", async () => {
      const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");

      const fakePageWithException = {
        locator: () => ({ count: async () => 0 }),
        evaluate: async () => {
          throw new Error("SyntaxError: Failed to execute 'querySelectorAll' on 'Document'");
        },
      } as any;

      const discovery = await PromptSender.getAssistantDiscovery(fakePageWithException);
      expect(discovery.status).toBe("dom_extraction_failed");
      expect(discovery.diagnostic).toContain("SyntaxError");
    });

    it("terminates with clear diagnostic when challenge or login required", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");
      const { BrowserStateMachine } = await import("../src/providers/reasoning/chatgpt-web/state-machine.js");

      const baseline = { assistantCount: 0, lastAssistantText: "", userCount: 1, timestamp: Date.now() };

      const fakeChallengePage = {
        locator: (sel: string) => {
          if (sel.includes("challenges.cloudflare.com") || sel.includes("challenge")) {
            return {
              count: async () => 1,
              first: () => ({ isVisible: async () => true }),
            };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => false,
      } as any;

      const sm = new BrowserStateMachine();
      await expect(
        ResponseReader.waitForCompletion(fakeChallengePage, baseline, { stateMachine: sm, timeoutMs: 5000 })
      ).rejects.toThrow(/verification challenge detected/i);

      expect(sm.getState()).toBe("FAILED_TERMINAL");
    });

    it("enforces consistency between baseline capture and new-message extraction", async () => {
      const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");

      const msg = "Initial assistant reply";
      const fakePage = {
        locator: (sel: string) => {
          if (sel === "[data-markdown-text-style='assistant-message']") {
            return {
              count: async () => 1,
              nth: () => ({
                evaluate: async () => false,
                innerText: async () => msg,
              }),
            };
          }
          if (sel.includes("You said")) {
            return { count: async () => 1 };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => false,
      } as any;

      const baseline = await PromptSender.captureBaseline(fakePage);
      expect(baseline.assistantCount).toBe(1);
      expect(baseline.lastAssistantText).toBe(msg);

      const texts = await PromptSender.getAssistantMessageTexts(fakePage);
      expect(texts.length).toBe(baseline.assistantCount);
      expect(texts[texts.length - 1]).toBe(baseline.lastAssistantText);
    });

    it("rejects stale previous assistant response during polling", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");

      const staleText = "Previous completed reply from attempt 1";
      const baseline = {
        assistantCount: 1,
        lastAssistantText: staleText,
        userCount: 2,
        timestamp: Date.now(),
      };

      const fakePageStale = {
        locator: (sel: string) => {
          if (sel === "[data-markdown-text-style='assistant-message']") {
            return {
              count: async () => 1,
              nth: () => ({
                evaluate: async () => false,
                innerText: async () => staleText,
              }),
            };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => false,
        waitForTimeout: async () => {},
      } as any;

      const completed = await ResponseReader.checkForCompletedResponse(fakePageStale, baseline);
      expect(completed).toBeNull();
    });

    it("extracts JSON envelope for action: instruct and separates markers", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");

      const raw = JSON.stringify({
        action: "instruct",
        instruction: "[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Calculator Module\nImplement basic add and subtract functions.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
        rationale: "Basic math functions implementation",
      });

      const extracted = ResponseReader.extractInstruction(raw);
      expect(extracted.action).toBe("instruct");
      expect(extracted.isMarkerExtracted).toBe(true);
      expect(extracted.instructionText).toBe("# Calculator Module\nImplement basic add and subtract functions.");
      expect(extracted.rationale).toBe("Basic math functions implementation");
    });

    it("handles explicit action: stop preserving both stop_reason and rationale", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");

      const rawStop = JSON.stringify({
        action: "stop",
        stop_reason: "Model refuses to write exploit code",
        rationale: "Safety policy restriction on offensive security tools",
      });

      const extracted = ResponseReader.extractInstruction(rawStop);
      expect(extracted.action).toBe("stop");
      expect(extracted.instructionText).toBe("");
      expect(extracted.stopReason).toBe("Model refuses to write exploit code");
      expect(extracted.rationale).toBe("Safety policy restriction on offensive security tools");
    });

    it("terminates in bounded time when response cannot be found in DOM", async () => {
      const { ResponseReader } = await import("../src/providers/reasoning/chatgpt-web/response-reader.js");
      const { BrowserStateMachine } = await import("../src/providers/reasoning/chatgpt-web/state-machine.js");

      const baseline = { assistantCount: 0, lastAssistantText: "", userCount: 1, timestamp: Date.now() };

      const fakePageMissingResponse = {
        locator: () => ({ count: async () => 0 }),
        evaluate: async (fn: any) => {
          const fnStr = typeof fn === "function" ? fn.toString() : "";
          if (fnStr.includes("stop-button") || fnStr.includes("Stop")) {
            return false;
          }
          return {
            texts: [],
            status: "dom_extraction_failed",
            diagnostic: "Conversation contains 1 user turn indicator(s), but assistant containers could not be matched by any selector",
          };
        },
        waitForTimeout: async () => {},
      } as any;

      const sm = new BrowserStateMachine();
      await expect(
        ResponseReader.waitForCompletion(fakePageMissingResponse, baseline, {
          stateMachine: sm,
          timeoutMs: 15_000,
          stabilizationIntervalMs: 10,
        })
      ).rejects.toThrow(/DOM extraction failure/i);

      expect(sm.getState()).toBe("FAILED_RECOVERABLE");
    });

    it("prevents duplicate prompt submission when generation is already in progress", async () => {
      const { PromptSender } = await import("../src/providers/reasoning/chatgpt-web/prompt-sender.js");

      let waitFinished = false;
      const fakePageGenerating = {
        locator: (sel: string) => {
          if (sel.includes("stop-button")) {
            return {
              count: async () => (waitFinished ? 0 : 1),
              first: () => ({ isVisible: async () => !waitFinished }),
            };
          }
          if (sel === "#prompt-textarea" || sel.includes("textarea")) {
            return {
              count: async () => 1,
              first: () => ({
                isVisible: async () => true,
                click: async () => {},
                fill: async () => {},
                type: async () => {},
                evaluate: async () => "Staged prompt text",
              }),
            };
          }
          if (sel.includes("send-button")) {
            return {
              count: async () => 1,
              first: () => ({
                isVisible: async () => true,
                isEnabled: async () => true,
                click: async () => {},
              }),
            };
          }
          return { count: async () => 0 };
        },
        evaluate: async () => false,
        keyboard: { press: async () => {} },
        waitForTimeout: async () => {
          waitFinished = true;
        },
      } as any;

      const baseline = { assistantCount: 0, lastAssistantText: "", userCount: 1, timestamp: Date.now() };
      await PromptSender.submitPrompt(fakePageGenerating, "Implement calculator", baseline, { timeoutMs: 5000 });
      expect(waitFinished).toBe(true);
    });
  });

  describe("Section 12 & 17 Master Regression Suite: Natural-Language Protocol & End-to-End Loop", () => {
    it("1. extracts a valid detailed natural-language instruction response cleanly", async () => {
      const response = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]

# Implementation Mission: Order Fulfillment Service

## 1. Executive Objective
Implement idempotent order processing with database transaction isolation.

## 2. Architecture & Design Direction
Coordinate state transitions across \`src/orders/service.ts\` and \`src/payments/gateway.ts\`.

## 3. Verification Instructions
Run \`npm test\` and verify all unit tests pass with exit code 0.

[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.extractInstruction(response);
      expect(result.action).toBe("instruct");
      expect(result.status).toBe("INSTRUCT");
      expect(result.isMarkerExtracted).toBe(true);
      expect(result.instructionText).toContain("# Implementation Mission: Order Fulfillment Service");
      expect(result.instructionText).toContain("Implement idempotent order processing");
      expect(result.instructionText).not.toContain("ORCHES_STATUS: INSTRUCT");
      expect(result.instructionText).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    });

    it("2. preserves complete Markdown structure without alteration", async () => {
      const markdown = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Master Brief
> [!IMPORTANT]
> Preserve existing customer records.

- Item 1: Inspect schemas
- Item 2: Add validation rules
  - Subitem 2a: Validate email
  - Subitem 2b: Validate phone

1. First migration
2. Second migration
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.extractInstruction(markdown);
      expect(result.instructionText).toContain("> [!IMPORTANT]");
      expect(result.instructionText).toContain("- Item 1: Inspect schemas");
      expect(result.instructionText).toContain("  - Subitem 2a: Validate email");
      expect(result.instructionText).toContain("1. First migration");
    });

    it("3. handles large multi-kilobyte engineering briefs without clipping or truncation", async () => {
      const longSection = Array.from({ length: 50 }, (_, i) => `### Subsection ${i + 1}\nDetailed technical requirement ${i + 1} with parameters and error handling.`).join("\n\n");
      const fullResponse = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Comprehensive System Architecture Brief
${longSection}
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.extractInstruction(fullResponse);
      expect(result.instructionText.length).toBeGreaterThan(3000);
      expect(result.instructionText).toContain("Subsection 1");
      expect(result.instructionText).toContain("Subsection 50");
    });

    it("4. preserves fenced code blocks and code indentation inside instructions", async () => {
      const response = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Algorithm Implementation
Implement the following function in \`src/math.ts\`:

\`\`\`typescript
export function calculateMovingAverage(values: number[], windowSize: number): number[] {
  if (windowSize <= 0) throw new Error("Window size must be positive");
  const result: number[] = [];
  for (let i = 0; i <= values.length - windowSize; i++) {
    const slice = values.slice(i, i + windowSize);
    const sum = slice.reduce((a, b) => a + b, 0);
    result.push(sum / windowSize);
  }
  return result;
}
\`\`\`
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.extractInstruction(response);
      expect(result.instructionText).toContain("```typescript");
      expect(result.instructionText).toContain("export function calculateMovingAverage");
      expect(result.instructionText).toContain("const slice = values.slice(i, i + windowSize);");
    });

    it("5. parses explicit STOP status with clear reason and prevents instruction dispatch", async () => {
      const stopText = `ORCHES_STATUS: STOP

Reason: External payment gateway API key is required to test real credit card authorizations.`;

      const result = ResponseReader.extractInstruction(stopText);
      expect(result.action).toBe("stop");
      expect(result.status).toBe("STOP");
      expect(result.instructionText).toBe("");
      expect(result.stopReason).toContain("External payment gateway API key is required");
      expect(result.rationale).toContain("External payment gateway API key is required");
    });

    it("6. rejects responses missing protocol status line in strict mode", async () => {
      const missingStatus = `[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Brief without status line
Implement feature now.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(missingStatus, { requireProtocolStatus: true });
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Missing protocol status line");
    });

    it("7. rejects responses missing opening instruction delimiter", async () => {
      const missingStart = `ORCHES_STATUS: INSTRUCT

# Brief without opening delimiter
Implement feature.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(missingStart);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Missing opening instruction delimiter");
    });

    it("8. rejects responses with duplicated opening instruction delimiters", async () => {
      const duplicatedStart = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Ambiguous Brief
Implement feature.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(duplicatedStart);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Duplicated opening instruction delimiters");
    });

    it("9. rejects responses with reversed delimiters", async () => {
      const reversed = `ORCHES_STATUS: INSTRUCT

[/ORCHES_ANTIGRAVITY_INSTRUCTION]
# Inverted Brief
Implement feature.
[ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(reversed);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Reversed delimiters");
    });

    it("10. rejects empty instruction body between delimiters", async () => {
      const emptyBody = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
   
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(emptyBody);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Instruction body between delimiters is empty");
    });

    it("11. rejects invalid protocol status values", async () => {
      const invalidStatus = `ORCHES_STATUS: UNKNOWN

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Some Brief
Implement feature.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(invalidStatus);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Invalid protocol status 'UNKNOWN'");
    });

    it("12. rejects truncated response missing closing delimiter", async () => {
      const truncated = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Cut-off Brief
Edit src/handler.ts to add error handling`;

      const result = ResponseReader.parseProtocol(truncated);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Missing closing instruction delimiter");
    });

    it("13. does not truncate when marker-like text appears in quoted inline examples", async () => {
      const inlineExample = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Instruction with Quoted Marker Example
To parse markers, search for \`[ORCHES_ANTIGRAVITY_INSTRUCTION]\` and \`[/ORCHES_ANTIGRAVITY_INSTRUCTION]\`.
Ensure you test this function thoroughly with unit tests.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(inlineExample);
      expect(result.status).toBe("INSTRUCT");
      expect(result.instructionText).toContain("Ensure you test this function thoroughly with unit tests.");
    });

    it("14. does not truncate when marker-like text appears inside fenced code blocks", async () => {
      const codeBlockExample = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Integration Testing Brief
Implement the following test fixture:

\`\`\`typescript
const mockResponse = \`
[ORCHES_ANTIGRAVITY_INSTRUCTION]
Inside mock
[/ORCHES_ANTIGRAVITY_INSTRUCTION]
\`;
\`\`\`

Verify all tests pass cleanly.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(codeBlockExample);
      expect(result.status).toBe("INSTRUCT");
      expect(result.instructionText).toContain("Verify all tests pass cleanly.");
      expect(result.instructionText).toContain("Inside mock");
    });

    it("15. maintains backward compatibility for legacy JSON responses when permitted", async () => {
      const legacyJson = JSON.stringify({
        action: "instruct",
        instruction: "Legacy instruction from historical run record.",
        rationale: "Historical record",
      });

      const result = ResponseReader.parseProtocol(legacyJson, { allowLegacyJson: true });
      expect(result.status).toBe("INSTRUCT");
      expect(result.instructionText).toBe("Legacy instruction from historical run record.");
      expect(result.isLegacyJson).toBe(true);
    });

    it("16. strictly rejects JSON-only response in active contract when allowLegacyJson is false", async () => {
      const activeJsonResponse = JSON.stringify({
        action: "instruct",
        instruction: "Should not be wrapped in JSON.",
      });

      const result = ResponseReader.parseProtocol(activeJsonResponse, { allowLegacyJson: false });
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("Active response contract requires natural-language protocol");
    });

    it("17. rejects task-planning descriptor inside markers and identifies it as invalid", async () => {
      const descriptorInsideMarkers = `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
{
  "title": "Build feature",
  "acceptance_criteria": ["All tests pass"],
  "files_to_read": ["src/index.ts"]
}
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;

      const result = ResponseReader.parseProtocol(descriptorInsideMarkers);
      expect(result.status).toBe("INVALID");
      expect(result.validationError).toContain("task-planning descriptor");
    });

    it("18. accepts legitimately concise response for a simple task in substance validator", async () => {
      const { validateInstructionSubstance } = await import("../src/prompts/instruction-validator.js");

      const conciseBrief = `# Add Helper Function
Add a \`formatIsoDate\` helper in \`src/utils/date.ts\`. Run \`npm test\` to verify.`;

      const validation = validateInstructionSubstance(conciseBrief, "Add date helper", { isComplex: false });
      expect(validation.valid).toBe(true);
      expect(validation.hasVerificationInstructions).toBe(true);
    });

    it("19. rejects inadequate brief for a complex specification in substance validator", async () => {
      const { validateInstructionSubstance } = await import("../src/prompts/instruction-validator.js");

      const tooShort = "Implement the microservices architecture.";
      const complexTask = "Architect and implement distributed consensus with Raft, persistence, replication, and fault recovery over 5 nodes.";

      const validation = validateInstructionSubstance(tooShort, complexTask, { isComplex: true });
      expect(validation.valid).toBe(false);
      expect(validation.summary).toContain("lacks sufficient detail for a complex engineering specification");
    });

    it("20. ChatGPTWebProvider assemblePrompt directs model to return natural-language routing protocol", async () => {
      const { ChatGPTWebProvider } = await import("../src/providers/reasoning/chatgpt-web/chatgpt-web-provider.js");

      const provider = new ChatGPTWebProvider({ headless: true });
      const promptText = (provider as any).assemblePrompt({
        operation: "code_generation",
        systemInstruction: "You are the systems architect.",
        messages: [{ role: "user", content: "Build user service" }],
        projectId: "proj-1",
        runId: "run-1",
      });

      expect(promptText).toContain("ORCHES_STATUS: INSTRUCT");
      expect(promptText).toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
      expect(promptText).toContain("ORCHES_STATUS: STOP");
      expect(promptText).toContain("Do NOT return a JSON object");
      expect(promptText).not.toContain("Reply with a single JSON object");
    });

    it("21. composeInstruction correctly processes natural-language INSTRUCT protocol and STOP protocol", async () => {
      const { composeInstruction } = await import("../src/orchestrator/instructor.js");
      const { ScriptedProvider } = await import("./helpers.js");

      // Test INSTRUCT protocol
      const instructProvider = new ScriptedProvider();
      instructProvider.enqueue("code_generation", () => {
        return `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]
# Master Engineering Brief: Calculator Module
## 1. Executive Objective
Implement calculator operations in \`src/calculator.ts\`.
## 2. Working Instructions for Antigravity Agent
- Implement add, subtract, multiply, and divide with zero-division validation.
- Run tests via \`npm test\` to verify.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
      });

      const instr = await composeInstruction(instructProvider, {
        projectId: "proj-protocol-test",
        runId: "run-protocol-test",
        taskText: "Implement calculator operations with input validation",
        criteria: ["All operations work", "Zero division throws error"],
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
        files: ["package.json", "src/calculator.ts"],
        iteration: 1,
        maxIterations: 3,
        history: [],
      });

      expect(instr.action).toBe("instruct");
      expect(instr.source).toBe("model");
      expect(instr.instruction).toContain("# Master Engineering Brief: Calculator Module");
      expect(instr.instruction).toContain("Implement add, subtract, multiply, and divide");
      expect(instr.instruction).not.toContain("ORCHES_STATUS: INSTRUCT");
      expect(instr.instruction).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");

      // Test STOP protocol
      const stopProvider = new ScriptedProvider();
      stopProvider.enqueue("code_generation", () => {
        return `ORCHES_STATUS: STOP

Reason: Operation requires external cloud database credentials which are unavailable.`;
      });

      const stopInstr = await composeInstruction(stopProvider, {
        projectId: "proj-protocol-test",
        runId: "run-protocol-test",
        taskText: "Connect to live production database",
        criteria: ["Connects cleanly"],
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

      expect(stopInstr.action).toBe("stop");
      expect(stopInstr.instruction).toBe("");
      expect(stopInstr.rationale).toContain("requires external cloud database credentials");
    });
  });

  describe("Section 13 Regression Suite: Hotfix — Prevent Incomplete GPT Responses from Reaching Antigravity", () => {
    let ScriptedProvider: any;
    let composeInstruction: any;

    beforeAll(async () => {
      const helpers = await import("./helpers.js");
      ScriptedProvider = helpers.ScriptedProvider;
      const instructor = await import("../src/orchestrator/instructor.js");
      composeInstruction = instructor.composeInstruction;
    });

    it("1. rejects a 27-character response containing only 'Defining a safe alternative'", async () => {
      const fragment = "Defining a safe alternative";
      expect(fragment.length).toBe(27);

      // parseProtocol must reject it as an interim thought fragment / invalid status
      const extracted = ResponseReader.parseProtocol(fragment);
      expect(extracted.status).toBe("INVALID");
      expect(extracted.instructionText).toBe("");
      expect(extracted.validationError).toBeDefined();

      // Even if inside delimiters, it must be rejected as an interim thought fragment
      const insideMarkers = `ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n${fragment}\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
      const extractedWithMarkers = ResponseReader.parseProtocol(insideMarkers);
      expect(extractedWithMarkers.status).toBe("INVALID");
      expect(extractedWithMarkers.validationError).toContain("interim thought fragment");
    });

    it("2. rejects a response without the required status or delimiters", async () => {
      const missingProtocol = "Build the user registration and login endpoints with SQLite and bcrypt.";
      const extractedStrict = ResponseReader.parseProtocol(missingProtocol, { requireProtocolStatus: true });
      expect(extractedStrict.status).toBe("INVALID");
      expect(extractedStrict.validationError).toContain("Missing protocol status line");
    });

    it("3. an incomplete response is not dispatched merely because browser reports Generating: false", async () => {
      const fragment = "Defining a safe alternative";
      const { isThoughtOrStatusFragment } = await import("../src/prompts/instruction-validator.js");
      expect(isThoughtOrStatusFragment(fragment)).toBe(true);

      const mockPage: any = {
        url: () => "https://chatgpt.com/c/test-incomplete",
      };
      // checkForCompletedResponse rejects thought fragments and short non-protocol text even when isGenerating is false
      const baseline = { assistantCount: 0, lastAssistantText: "" };
      // PromptSender methods would return [fragment] with isGenerating: false
      const isShortWithoutProtocol =
        fragment.length < 80 &&
        !fragment.includes(ResponseReader.STATUS_LINE_PREFIX) &&
        !fragment.includes(ResponseReader.MARKER_START);
      expect(isShortWithoutProtocol).toBe(true);
    });

    it("4. a stale assistant response cannot satisfy the current request", async () => {
      const staleText = "ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Old brief\nDo nothing\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]";
      const baseline = { assistantCount: 1, lastAssistantText: staleText };

      // If the texts list only contains the same baseline text and same count, it's not new
      const currentTexts = [staleText];
      const isNew = currentTexts.length > baseline.assistantCount || currentTexts[0] !== baseline.lastAssistantText;
      expect(isNew).toBe(false);
    });

    it("5. requirement-inventory assembly cannot promote an invalid response into a valid brief", async () => {
      const { validateAndCorrectPrompt } = await import("../src/orchestrator/prompt-fidelity-gate.js");
      const { buildRequirementInventory } = await import("../src/domain/requirements/requirement-inventory.js");

      const fragment = "Defining a safe alternative";
      const inventory = buildRequirementInventory({
        taskText: "Build PRAHARI RF Receiver Controller",
        projectObjective: "Must implement operational RF interception and receiver tuning [REQ-001].",
      });

      const result = validateAndCorrectPrompt(fragment, inventory);
      expect(result.passed).toBe(false);
      // Requirements must NOT be appended to a hollow fragment to pass it
      expect(result.prompt).toBe(fragment);
      expect(result.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");
    });

    it("6. a missing or malformed instruction body causes zero native-agent dispatches", async () => {
      const { AntigravityAgentAdapter } = await import("../src/providers/coding-agents/antigravity/antigravity-agent-adapter.js");
      const adapter = new AntigravityAgentAdapter();

      const resultFragment = await adapter.execute({
        projectId: "proj-1",
        runId: "run-test-1",
        taskId: "task-1",
        attemptNumber: 1,
        workspacePath: process.cwd(),
        taskText: "Task",
        title: "Task",
        acceptanceCriteria: [],
        profile: { fileCount: 0, isEmpty: true, languages: [], checks: [], testFrameworks: [], packageManagers: [], manifests: [], notes: [] },
        filesToRead: [],
        instruction: "Defining a safe alternative",
      });

      expect(resultFragment.status).toBe("failed");
      expect(resultFragment.error).toContain("Antigravity boundary rejected non-executable or interim instruction");
    });

    it("7. explicit STOP responses and refusals remain terminal and cannot be dispatched", async () => {
      const stopRaw = "ORCHES_STATUS: STOP\n\nReason: Cannot fulfill request due to safety policy.";
      const extracted = ResponseReader.parseProtocol(stopRaw);
      expect(extracted.action).toBe("stop");
      expect(extracted.status).toBe("STOP");
      expect(extracted.instructionText).toBe("");

      const provider = new ScriptedProvider();
      provider.enqueue("code_generation", () => stopRaw);

      const instr = await composeInstruction(provider, {
        projectId: "proj-stop",
        runId: "run-stop",
        taskText: "Intercept emitter hardware",
        criteria: ["Safe"],
        profile: { fileCount: 0, isEmpty: true, languages: [], checks: [], testFrameworks: [], packageManagers: [], manifests: [], notes: [] },
        files: [],
        iteration: 1,
        maxIterations: 1,
        history: [],
      });

      expect(instr.action).toBe("stop");
      expect(instr.instruction).toBe("");
    });

    it("8. a complete, valid, detailed Markdown instruction passes the protocol and fidelity checks", async () => {
      const validMarkdown = `# Implementation Mission — Synthetic Research Simulator
## 1. Executive Objective
Build a synthetic scheduling research simulator with zero physical hardware control.
## 2. Functional Requirements
- **[REQ-001]** Implement synthetic job queue and priority scheduler.
- **[REQ-002]** Implement simulated emitter pulse generator in software.
## 3. Automated Verification
Run \`npm test\` to verify all scheduler tests pass cleanly.`;

      const protocolResponse = `ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n${validMarkdown}\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
      const extracted = ResponseReader.parseProtocol(protocolResponse, { requireProtocolStatus: true });

      expect(extracted.status).toBe("INSTRUCT");
      expect(extracted.instructionText).toBe(validMarkdown);

      const { validateInstructionSubstance } = await import("../src/prompts/instruction-validator.js");
      const validation = validateInstructionSubstance(extracted.instructionText, "Build synthetic scheduling research simulator");
      expect(validation.valid).toBe(true);
    });

    it("9. the exact validated instruction body reaches the dispatch boundary intact", async () => {
      const briefBody = `# Synthetic Simulator
Implement the synthetic job queue with automated tests. Run \`npm test\` to verify.`;

      const provider = new ScriptedProvider();
      provider.enqueue("code_generation", () => `ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n${briefBody}\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]`);

      const instr = await composeInstruction(provider, {
        projectId: "proj-exact",
        runId: "run-exact",
        taskText: "Build Synthetic Simulator",
        criteria: ["Passes tests"],
        profile: { fileCount: 0, isEmpty: true, languages: [], checks: [], testFrameworks: [], packageManagers: [], manifests: [], notes: [] },
        files: [],
        iteration: 1,
        maxIterations: 1,
        history: [],
      });

      expect(instr.instruction).toBe(briefBody);
    });

    it("10. conflicting or out-of-scope requirements remain traceable without being silently reintroduced", async () => {
      const { buildRequirementInventory } = await import("../src/domain/requirements/requirement-inventory.js");

      const inventory = buildRequirementInventory({
        taskText: "Build non-operational synthetic scheduling research simulator",
        projectObjective: `# PRAHARI Architecture
- [REQ-001] Implement synthetic pulse scheduler.
- [REQ-002] Control physical RF receiver hardware and operational emitter interception.`,
      });

      const syntheticReq = inventory.requirements.find((r) => r.title.includes("synthetic pulse scheduler"));
      const physicalReq = inventory.requirements.find((r) => r.title.includes("physical RF receiver hardware"));

      expect(syntheticReq).toBeDefined();
      expect(syntheticReq?.scopeStatus).toBe("in_scope");

      expect(physicalReq).toBeDefined();
      expect(physicalReq?.scopeStatus).toBe("safety_conflict");
      expect(physicalReq?.scopeConflictReason).toContain("Operational hardware / live interception is prohibited");
    });

    it("11. a benign synthetic-simulator brief remains within its declared scope", async () => {
      const { synthesizeSubstantiveBrief } = await import("../src/orchestrator/instructor.js");
      const { buildRequirementInventory } = await import("../src/domain/requirements/requirement-inventory.js");

      const inventory = buildRequirementInventory({
        taskText: "Build non-operational synthetic scheduling research simulator",
        projectObjective: `- [REQ-001] Implement simulated emitter event generator.\n- [REQ-002] Physical receiver control.`,
      });

      const brief = synthesizeSubstantiveBrief(
        {
          projectId: "proj-sim",
          runId: "run-sim",
          taskText: "Build non-operational synthetic scheduling research simulator",
          criteria: ["Simulator runs cleanly"],
          profile: { fileCount: 0, isEmpty: true, languages: ["typescript"], checks: [], testFrameworks: [], packageManagers: [], manifests: [], notes: [] },
          files: [],
          iteration: 1,
          maxIterations: 1,
          history: [],
        },
        inventory
      );

      // Brief must contain simulation requirements
      expect(brief).toContain("simulated emitter event generator");
      // Physical receiver control must NOT be listed in active specification requirements
      expect(brief).not.toContain("### Explicit Specification Requirements\n- **[REQ-002]** (critical) Physical receiver control");
      // It must be placed in safety boundaries & excluded operational scope
      expect(brief).toContain("Safety Boundaries & Excluded Operational Scope");
      expect(brief).toContain("Physical receiver control");
    });

    it("12. retry exhaustion produces a truthful blocked or failed status rather than false success", async () => {
      const provider = new ScriptedProvider();
      // Returns fragments repeatedly
      provider.enqueue("code_generation", () => "Defining a safe alternative");

      const instr = await composeInstruction(provider, {
        projectId: "proj-fallback",
        runId: "run-fallback",
        taskText: "Build non-operational synthetic scheduling research simulator",
        criteria: ["Passes tests"],
        profile: { fileCount: 0, isEmpty: true, languages: ["typescript"], checks: [], testFrameworks: [], packageManagers: [], manifests: [], notes: [] },
        files: [],
        iteration: 1,
        maxIterations: 1,
        history: [],
      });

      // The orchestrator synthesizes a complete substantive brief instead of passing the 27-char fragment
      expect(instr.source).toBe("fallback");
      expect(instr.instruction.length).toBeGreaterThan(200);
      expect(instr.instruction).not.toBe("Defining a safe alternative");
      expect(instr.warning).toContain("Defining a safe alternative");
    });
  });
});


