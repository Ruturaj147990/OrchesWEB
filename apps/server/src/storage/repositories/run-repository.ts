import { DatabaseSync } from "node:sqlite";
import { Run } from "@orchestrator/shared-types";

export class RunRepository {
  constructor(private db: DatabaseSync) {}

  public create(run: Run): Run {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, project_id, status, current_task_id, iteration_count, stop_reason, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.projectId,
      run.status,
      run.currentTaskId,
      run.iterationCount,
      run.stopReason,
      run.startedAt,
      run.endedAt
    );
    return run;
  }

  public findById(id: string): Run | null {
    const stmt = this.db.prepare("SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findActiveByProjectId(projectId: string): Run | null {
    const stmt = this.db.prepare(`
      SELECT * FROM runs 
      WHERE project_id = ? AND status IN ('ready', 'running', 'pausing', 'paused')
      ORDER BY started_at DESC LIMIT 1
    `);
    const row = stmt.get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public updateStatus(id: string, status: Run["status"], stopReason?: string): void {
    const stmt = this.db.prepare(`
      UPDATE runs 
      SET status = ?, 
          stop_reason = COALESCE(?, stop_reason),
          ended_at = CASE WHEN ? IN ('completed', 'completed_with_warnings', 'stopped', 'failed', 'budget_exhausted', 'stalled') THEN ? ELSE ended_at END
      WHERE id = ?
    `);
    const now = new Date().toISOString();
    stmt.run(status, stopReason || null, status, now, id);
  }

  public incrementIteration(id: string): void {
    const stmt = this.db.prepare("UPDATE runs SET iteration_count = iteration_count + 1 WHERE id = ?");
    stmt.run(id);
  }

  private mapRow(row: Record<string, unknown>): Run {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      status: row.status as Run["status"],
      currentTaskId: (row.current_task_id as string) || null,
      iterationCount: (row.iteration_count as number) || 0,
      stopReason: (row.stop_reason as string) || null,
      startedAt: (row.started_at as string) || null,
      endedAt: (row.ended_at as string) || null,
    };
  }
}
