import { DatabaseSync } from "node:sqlite";
import { Project } from "@orchestrator/shared-types";

export class ProjectRepository {
  constructor(private db: DatabaseSync) {}

  public create(project: Project): Project {
    this.db
      .prepare(`
        INSERT INTO projects (id, name, objective, root_path, status, profile_id, autonomy_mode, verification_commands_json, auto_commit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        project.id,
        project.name,
        project.objective,
        project.rootPath,
        project.status,
        project.profileId,
        project.autonomyMode,
        JSON.stringify(project.verificationCommands ?? []),
        project.autoCommit === false ? 0 : 1,
        project.createdAt,
        project.updatedAt
      );
    return project;
  }

  public findById(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public list(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public update(
    id: string,
    fields: Partial<Pick<Project, "name" | "objective" | "rootPath" | "status" | "profileId" | "autonomyMode" | "verificationCommands" | "autoCommit">>
  ): Project | null {
    const current = this.findById(id);
    if (!current) return null;
    const next = { ...current, ...fields, updatedAt: new Date().toISOString() };
    this.db
      .prepare(`
        UPDATE projects SET name = ?, objective = ?, root_path = ?, status = ?, profile_id = ?, autonomy_mode = ?, verification_commands_json = ?, auto_commit = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(next.name, next.objective, next.rootPath, next.status, next.profileId, next.autonomyMode, JSON.stringify(next.verificationCommands), next.autoCommit ? 1 : 0, next.updatedAt, id);
    return next;
  }

  public updateStatus(id: string, status: Project["status"]): void {
    this.update(id, { status });
  }

  public updateRootPath(id: string, rootPath: string): void {
    this.update(id, { rootPath });
  }

  private mapRow(row: Record<string, unknown>): Project {
    let commands: string[] = [];
    try {
      const parsed = JSON.parse((row.verification_commands_json as string) || "[]");
      if (Array.isArray(parsed)) commands = parsed.filter((c) => typeof c === "string");
    } catch {}
    return {
      id: row.id as string,
      name: row.name as string,
      objective: (row.objective as string) || "",
      rootPath: row.root_path as string,
      status: row.status as Project["status"],
      profileId: (row.profile_id as string) || "general",
      autonomyMode: row.autonomy_mode as Project["autonomyMode"],
      verificationCommands: commands,
      autoCommit: row.auto_commit === undefined ? true : Number(row.auto_commit) === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
