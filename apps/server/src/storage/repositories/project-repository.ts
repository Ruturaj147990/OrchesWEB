import { DatabaseSync } from "node:sqlite";
import { Project } from "@orchestrator/shared-types";

export class ProjectRepository {
  constructor(private db: DatabaseSync) {}

  public create(project: Project): Project {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      project.id,
      project.name,
      project.objective,
      project.rootPath,
      project.status,
      project.profileId,
      project.autonomyMode,
      project.createdAt,
      project.updatedAt
    );
    return project;
  }

  public findById(id: string): Project | null {
    const stmt = this.db.prepare("SELECT * FROM projects WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public list(): Project[] {
    const stmt = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC");
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(id: string, status: Project["status"]): void {
    const stmt = this.db.prepare(`
      UPDATE projects SET status = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(status, new Date().toISOString(), id);
  }

  public updateRootPath(id: string, rootPath: string): void {
    const stmt = this.db.prepare(`
      UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(rootPath, new Date().toISOString(), id);
  }

  private mapRow(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      objective: (row.objective as string) || "",
      rootPath: row.root_path as string,
      status: row.status as Project["status"],
      profileId: (row.profile_id as string) || "general",
      autonomyMode: row.autonomy_mode as Project["autonomyMode"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
