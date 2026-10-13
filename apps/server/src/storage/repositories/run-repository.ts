import { DatabaseSync } from "node:sqlite";
import { Run } from "@orchestrator/shared-types";

export const ACTIVE_RUN_STATUSES = ["ready", "running", "pausing", "paused"] as const;
const TERMINAL = new Set(["completed", "completed_with_warnings", "stopped", "failed", "budget_exhausted", "stalled", "canceled"]);

export class RunRepository {
  constructor(private db: DatabaseSync) {}

  public create(run: Run): Run {
    this.db
      .prepare(`
        INSERT INTO runs (id, project_id, status, current_task_id, iteration_count, stop_reason, started_at, ended_at,
                          task_text, title, provider_id, model_id, agent_id, outcome, summary, safety_mode, commit_sha, conversation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.projectId,
        run.status,
        run.currentTaskId ?? null,
        run.iterationCount ?? 0,
        run.stopReason ?? null,
        run.startedAt ?? new Date().toISOString(),
        run.endedAt ?? null,
        run.taskText ?? "",
        run.title ?? "",
        run.providerId ?? "",
        run.modelId ?? "",
        run.agentId ?? "",
        run.outcome ?? null,
        run.summary ?? null,
        run.safetyMode ?? "creative_within_constraints",
        run.commitSha ?? null,
        run.conversationId ?? null
      );
    return run;
  }

  public findById(id: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listByProject(projectId: string, limit = 50): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public findActiveByProjectId(projectId: string): Run | null {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE project_id = ? AND status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(",")}) ORDER BY started_at DESC LIMIT 1`)
      .get(projectId, ...ACTIVE_RUN_STATUSES) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listActive(): Run[] {
    const rows = this.db
      .prepare(`SELECT * FROM runs WHERE status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(",")})`)
      .all(...ACTIVE_RUN_STATUSES) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(id: string, status: Run["status"], stopReason?: string): void {
    this.db
      .prepare(`
        UPDATE runs SET status = ?, stop_reason = COALESCE(?, stop_reason),
          ended_at = CASE WHEN ? = 1 THEN ? ELSE ended_at END
        WHERE id = ?
      `)
      .run(status, stopReason ?? null, TERMINAL.has(status) ? 1 : 0, new Date().toISOString(), id);
  }

  public updateFields(id: string, fields: Partial<Pick<Run, "title" | "currentTaskId" | "outcome" | "summary" | "safetyMode" | "commitSha" | "conversationId">>): void {
    const map: Record<string, string> = {
      title: "title",
      currentTaskId: "current_task_id",
      outcome: "outcome",
      summary: "summary",
      safetyMode: "safety_mode",
      commitSha: "commit_sha",
      conversationId: "conversation_id",
    };
    const keys = Object.keys(fields).filter((k) => k in map);
    if (keys.length === 0) return;
    this.db
      .prepare(`UPDATE runs SET ${keys.map((k) => `${map[k]} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => (fields as Record<string, string | null>)[k] ?? null), id);
  }

  public setDetails(id: string, details: Record<string, unknown>): void {
    this.db.prepare("UPDATE runs SET details_json = ? WHERE id = ?").run(JSON.stringify(details), id);
  }

  public getDetails(id: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT details_json FROM runs WHERE id = ?").get(id) as { details_json?: string } | undefined;
    try {
      return JSON.parse(row?.details_json || "{}");
    } catch {
      return {};
    }
  }

  public incrementIteration(id: string): void {
    this.db.prepare("UPDATE runs SET iteration_count = iteration_count + 1 WHERE id = ?").run(id);
  }

  public setIterationCount(id: string, count: number): void {
    this.db.prepare("UPDATE runs SET iteration_count = ? WHERE id = ?").run(count, id);
  }

  private mapRow(row: Record<string, unknown>): Run {
    const s = (k: string) => (row[k] as string) || null;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      status: row.status as Run["status"],
      currentTaskId: s("current_task_id"),
      iterationCount: Number(row.iteration_count || 0),
      stopReason: s("stop_reason"),
      startedAt: s("started_at"),
      endedAt: s("ended_at"),
      taskText: s("task_text"),
      title: s("title"),
      providerId: s("provider_id"),
      modelId: s("model_id"),
      agentId: s("agent_id"),
      outcome: s("outcome"),
      summary: s("summary"),
      safetyMode: s("safety_mode"),
      commitSha: s("commit_sha"),
      conversationId: s("conversation_id"),
    };
  }
}
