import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { RunEvent } from "@orchestrator/shared-types";
import { SecretRedactor } from "../platform/secret-redactor.js";

type EventListener = (event: RunEvent) => void;

/**
 * Subscribers are shared by every EventStore instance: routes and the run pipeline each
 * construct their own store, and a per-instance registry meant live SSE clients never saw
 * events recorded by the pipeline.
 */
const sharedListeners: Map<string, Set<EventListener>> = new Map();

export class EventStore {
  private listeners = sharedListeners;

  constructor(private db: DatabaseSync) {}

  public record(
    projectId: string,
    type: string,
    payload: Record<string, unknown>,
    runId?: string | null,
    taskId?: string | null
  ): RunEvent {
    // Get latest sequence for project
    const seqStmt = this.db.prepare("SELECT MAX(event_seq) as max_seq FROM run_events WHERE project_id = ?");
    const seqRow = seqStmt.get(projectId) as { max_seq: number | null } | undefined;
    const nextSeq = (seqRow?.max_seq || 0) + 1;

    const event: RunEvent = {
      id: `ev-${crypto.randomUUID()}`,
      eventSeq: nextSeq,
      projectId,
      runId: runId || null,
      taskId: taskId || null,
      type,
      // Event payloads include model output and command logs; never persist or stream secrets.
      payload: SecretRedactor.redactObject(payload),
      timestamp: new Date().toISOString(),
    };

    const insertStmt = this.db.prepare(`
      INSERT INTO run_events (id, event_seq, project_id, run_id, task_id, type, payload_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      event.id,
      event.eventSeq,
      event.projectId,
      event.runId,
      event.taskId,
      event.type,
      JSON.stringify(event.payload),
      event.timestamp
    );

    // Notify active SSE subscribers for this project
    const projectListeners = this.listeners.get(projectId);
    if (projectListeners) {
      for (const listener of projectListeners) {
        try {
          listener(event);
        } catch (err) {
          console.error("Error in SSE listener:", err);
        }
      }
    }

    return event;
  }

  public getEventsSince(projectId: string, cursorSeq: number): RunEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM run_events 
      WHERE project_id = ? AND event_seq > ?
      ORDER BY event_seq ASC
    `);
    const rows = stmt.all(projectId, cursorSeq) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  /** The most recent `limit` events, oldest first. */
  public getRecentEvents(projectId: string, limit: number): RunEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM run_events WHERE project_id = ? ORDER BY event_seq DESC LIMIT ?")
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r)).reverse();
  }

  public getEvents(projectId: string): RunEvent[] {
    return this.getEventsSince(projectId, 0);
  }

  public subscribe(projectId: string, listener: EventListener): () => void {
    if (!this.listeners.has(projectId)) {
      this.listeners.set(projectId, new Set());
    }
    this.listeners.get(projectId)!.add(listener);

    return () => {
      const set = this.listeners.get(projectId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(projectId);
        }
      }
    };
  }

  private mapRow(row: Record<string, unknown>): RunEvent {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json as string);
    } catch {
      payload = {};
    }

    return {
      id: row.id as string,
      eventSeq: row.event_seq as number,
      projectId: row.project_id as string,
      runId: (row.run_id as string) || null,
      taskId: (row.task_id as string) || null,
      type: row.type as string,
      payload,
      timestamp: row.timestamp as string,
    };
  }
}
