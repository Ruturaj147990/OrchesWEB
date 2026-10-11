import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Conversation,
  ConversationMessage,
  ConversationMemorySnapshot,
  ConversationSummary,
  ConversationRole,
  ConversationStatus,
} from "@orchestrator/shared-types";
import { SettingsManager } from "../../platform/settings-manager.js";
import { SecretRedactor } from "../../platform/secret-redactor.js";

function sanitizePathComponent(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class ConversationRepository {
  constructor(private db: DatabaseSync) {}

  public create(params: {
    id?: string;
    projectId: string;
    title: string;
    status?: ConversationStatus;
    resumedRunId?: string | null;
  }): Conversation {
    const id = params.id || `convo-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const status = params.status || "active";

    this.db
      .prepare(`
        INSERT INTO conversations (id, project_id, title, status, created_at, updated_at, resumed_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, params.projectId, params.title, status, now, now, params.resumedRunId ?? null);

    return {
      id,
      projectId: params.projectId,
      title: params.title,
      status,
      createdAt: now,
      updatedAt: now,
      resumedRunId: params.resumedRunId ?? null,
      latestSnapshotId: null,
      messageCount: 0,
      lastActivityAt: now,
    };
  }

  public findById(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const countRow = this.db.prepare("SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ?").get(id) as { count: number };
    const latestSnapshotRow = this.db
      .prepare("SELECT id, created_at FROM conversation_memory_snapshots WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { id: string; created_at: string } | undefined;
    const latestMessageRow = this.db
      .prepare("SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { created_at: string } | undefined;

    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      status: row.status as ConversationStatus,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      resumedRunId: (row.resumed_run_id as string) || null,
      latestSnapshotId: latestSnapshotRow?.id || null,
      messageCount: Number(countRow?.count || 0),
      lastActivityAt: latestMessageRow?.created_at || (row.updated_at as string),
    };
  }

  public listByProject(projectId: string): ConversationSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC")
      .all(projectId) as Record<string, unknown>[];

    return rows.map((r) => this.mapSummary(r));
  }

  public listAll(): ConversationSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];

    return rows.map((r) => this.mapSummary(r));
  }

  public updateTitle(id: string, title: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title.trim(), now, id);
  }

  public updateStatus(id: string, status: ConversationStatus): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  }

  public setResumedRunId(id: string, runId: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE conversations SET resumed_run_id = ?, updated_at = ? WHERE id = ?").run(runId, now, id);
  }

  public touch(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, id);
  }

  public addMessage(params: {
    id?: string;
    conversationId: string;
    role: ConversationRole;
    content: string;
    meta?: Record<string, unknown>;
    createdAt?: string;
  }): ConversationMessage {
    const id = params.id || `msg-${crypto.randomUUID()}`;
    const now = params.createdAt || new Date().toISOString();
    const redactedContent = SecretRedactor.redactString(params.content);
    const redactedMeta = SecretRedactor.redactObject(params.meta || {});

    this.db
      .prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, params.conversationId, params.role, redactedContent, JSON.stringify(redactedMeta), now);

    this.touch(params.conversationId);

    return {
      id,
      conversationId: params.conversationId,
      role: params.role,
      content: redactedContent,
      meta: redactedMeta,
      createdAt: now,
    };
  }

  public getMessages(conversationId: string, limit = 100, offset = 0): ConversationMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(conversationId, limit, offset) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      conversationId: r.conversation_id as string,
      role: r.role as ConversationRole,
      content: r.content as string,
      meta: this.safeParseJson(r.meta_json as string),
      createdAt: r.created_at as string,
    }));
  }

  public getMessageCount(conversationId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ?").get(conversationId) as { count: number };
    return Number(row?.count || 0);
  }

  public saveSnapshot(params: {
    id?: string;
    conversationId: string;
    snapshotMarkdown: string;
    tokenCount?: number;
    meta?: Record<string, unknown>;
    createdAt?: string;
  }): ConversationMemorySnapshot {
    const id = params.id || `snap-${crypto.randomUUID()}`;
    const now = params.createdAt || new Date().toISOString();
    const redactedMarkdown = SecretRedactor.redactString(params.snapshotMarkdown);
    const redactedMeta = SecretRedactor.redactObject(params.meta || {});

    this.db
      .prepare(`
        INSERT INTO conversation_memory_snapshots (id, conversation_id, snapshot_markdown, token_count, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, params.conversationId, redactedMarkdown, params.tokenCount || 0, JSON.stringify(redactedMeta), now);

    this.touch(params.conversationId);

    // Also persist markdown to application data storage outside user project source
    try {
      const snapDir = path.join(SettingsManager.getDataDir(), "memory_snapshots", sanitizePathComponent(params.conversationId));
      fs.mkdirSync(snapDir, { recursive: true });
      const snapFile = path.join(snapDir, `${sanitizePathComponent(id)}.md`);
      fs.writeFileSync(snapFile, redactedMarkdown, "utf8");
    } catch (err) {
      console.warn(`[ConversationRepository] Could not write snapshot file to disk: ${(err as Error).message}`);
    }

    return {
      id,
      conversationId: params.conversationId,
      snapshotMarkdown: redactedMarkdown,
      tokenCount: params.tokenCount || 0,
      meta: redactedMeta,
      createdAt: now,
    };
  }

  public getLatestSnapshot(conversationId: string): ConversationMemorySnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM conversation_memory_snapshots WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(conversationId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      snapshotMarkdown: row.snapshot_markdown as string,
      tokenCount: Number(row.token_count || 0),
      meta: this.safeParseJson(row.meta_json as string),
      createdAt: row.created_at as string,
    };
  }

  public listSnapshots(conversationId: string): ConversationMemorySnapshot[] {
    const rows = this.db
      .prepare("SELECT * FROM conversation_memory_snapshots WHERE conversation_id = ? ORDER BY created_at DESC")
      .all(conversationId) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      conversationId: r.conversation_id as string,
      snapshotMarkdown: r.snapshot_markdown as string,
      tokenCount: Number(r.token_count || 0),
      meta: this.safeParseJson(r.meta_json as string),
      createdAt: r.created_at as string,
    }));
  }

  /**
   * Real backend deletion:
   * 1. Nulls out conversation_id references in runs (preserving execution records and operational integrity).
   * 2. Deletes conversation messages and memory snapshots from SQLite.
   * 3. Deletes snapshot markdown files from the application data directory.
   * 4. Deletes the conversation record from SQLite.
   * 5. Does NOT delete project blueprints or requirements.
   */
  public delete(id: string): boolean {
    const existing = this.db.prepare("SELECT id FROM conversations WHERE id = ?").get(id);
    if (!existing) return false;

    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE runs SET conversation_id = NULL WHERE conversation_id = ?").run(id);
      this.db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(id);
      this.db.prepare("DELETE FROM conversation_memory_snapshots WHERE conversation_id = ?").run(id);
      this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    // Clean up filesystem snapshot files
    try {
      const snapDir = path.join(SettingsManager.getDataDir(), "memory_snapshots", sanitizePathComponent(id));
      if (fs.existsSync(snapDir)) {
        fs.rmSync(snapDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`[ConversationRepository] Failed to delete snapshot folder for ${id}: ${(err as Error).message}`);
    }

    return true;
  }

  private mapSummary(row: Record<string, unknown>): ConversationSummary {
    const id = row.id as string;
    const countRow = this.db.prepare("SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ?").get(id) as { count: number };
    const latestSnapshotRow = this.db
      .prepare("SELECT id FROM conversation_memory_snapshots WHERE conversation_id = ? LIMIT 1")
      .get(id) as { id: string } | undefined;
    const latestMsgRow = this.db
      .prepare("SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { created_at: string } | undefined;

    return {
      id,
      projectId: row.project_id as string,
      title: row.title as string,
      status: row.status as ConversationStatus,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      resumedRunId: (row.resumed_run_id as string) || null,
      messageCount: Number(countRow?.count || 0),
      lastActivityAt: latestMsgRow?.created_at || (row.updated_at as string),
      hasMemorySnapshot: Boolean(latestSnapshotRow?.id),
    };
  }

  private safeParseJson(str?: string): Record<string, unknown> {
    if (!str) return {};
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }
}
