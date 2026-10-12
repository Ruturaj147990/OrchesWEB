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
});
