import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { HumanMessageKind, HumanMessageSchema } from "@orchestrator/shared-types";
import { EventStore } from "../../events/event-store.js";

export interface HumanMessageRecord {
  id: string;
  projectId: string;
  kind: HumanMessageKind;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "consumed" | "canceled";
  createdAt: string;
  consumedAt: string | null;
}

export class InboxService {
  constructor(
    private db: DatabaseSync,
    private eventStore: EventStore
  ) {}

  public sendMessage(
    projectId: string,
    kind: HumanMessageKind,
    content: string,
    priority: "low" | "normal" | "high" | "urgent" = "normal"
  ): HumanMessageRecord {
    const id = `msg-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO human_messages (id, project_id, kind, content, priority, status, created_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
    `);
    stmt.run(id, projectId, kind, content, priority, now);

    this.eventStore.record(projectId, "human_message.created", {
      messageId: id,
      kind,
      content,
      priority,
    });

    return {
      id,
      projectId,
      kind,
      content,
      priority,
      status: "pending",
      createdAt: now,
      consumedAt: null,
    };
  }

  public getMessages(projectId: string): HumanMessageRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM human_messages 
      WHERE project_id = ? 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public getPendingMessages(projectId: string): HumanMessageRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM human_messages 
      WHERE project_id = ? AND status = 'pending'
      ORDER BY CASE priority 
        WHEN 'urgent' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'normal' THEN 3 
        ELSE 4 END, created_at ASC
    `);
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public consumePendingMessages(projectId: string): HumanMessageRecord[] {
    const pending = this.getPendingMessages(projectId);
    if (pending.length === 0) return [];

    const now = new Date().toISOString();
    const updateStmt = this.db.prepare(`
      UPDATE human_messages SET status = 'consumed', consumed_at = ? WHERE id = ?
    `);

    for (const msg of pending) {
      updateStmt.run(now, msg.id);
      this.eventStore.record(projectId, "human_message.consumed", {
        messageId: msg.id,
        kind: msg.kind,
      });
    }

    return pending.map((p) => ({ ...p, status: "consumed", consumedAt: now }));
  }

  public cancelMessage(messageId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE human_messages SET status = 'canceled' WHERE id = ? AND status = 'pending'
    `);
    const res = stmt.run(messageId);
    return res.changes > 0;
  }

  private mapRow(row: Record<string, unknown>): HumanMessageRecord {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      kind: row.kind as HumanMessageKind,
      content: row.content as string,
      priority: row.priority as HumanMessageRecord["priority"],
      status: row.status as HumanMessageRecord["status"],
      createdAt: row.created_at as string,
      consumedAt: (row.consumed_at as string) || null,
    };
  }
}
