import { DatabaseSync } from "node:sqlite";
import type { ProjectChatGptMapping } from "@orchestrator/shared-types";

export class ProjectChatGptRepository {
  constructor(private db: DatabaseSync) {}

  public getMapping(projectId: string): ProjectChatGptMapping | null {
    const row = this.db
      .prepare("SELECT * FROM project_chatgpt_conversations WHERE project_id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public saveMapping(mapping: ProjectChatGptMapping): ProjectChatGptMapping {
    this.db
      .prepare(`
        INSERT INTO project_chatgpt_conversations (
          project_id, conversation_url, chat_title, mapping_status, created_at, last_verified_at, last_successful_request_at, last_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          conversation_url = excluded.conversation_url,
          chat_title = excluded.chat_title,
          mapping_status = excluded.mapping_status,
          last_verified_at = excluded.last_verified_at,
          last_successful_request_at = excluded.last_successful_request_at,
          last_error = excluded.last_error
      `)
      .run(
        mapping.projectId,
        mapping.conversationUrl ?? null,
        mapping.chatTitle ?? null,
        mapping.mappingStatus,
        mapping.createdAt,
        mapping.lastVerifiedAt ?? null,
        mapping.lastSuccessfulRequestAt ?? null,
        mapping.lastError ?? null
      );
    return mapping;
  }

  public updateStatus(
    projectId: string,
    patch: Partial<
      Pick<
        ProjectChatGptMapping,
        "conversationUrl" | "chatTitle" | "mappingStatus" | "lastVerifiedAt" | "lastSuccessfulRequestAt" | "lastError"
      >
    >
  ): void {
    const current = this.getMapping(projectId);
    if (!current) {
      const now = new Date().toISOString();
      this.saveMapping({
        projectId,
        conversationUrl: patch.conversationUrl ?? null,
        chatTitle: patch.chatTitle ?? null,
        mappingStatus: patch.mappingStatus ?? "active",
        createdAt: now,
        lastVerifiedAt: patch.lastVerifiedAt ?? now,
        lastSuccessfulRequestAt: patch.lastSuccessfulRequestAt ?? null,
        lastError: patch.lastError ?? null,
      });
      return;
    }
    const updated: ProjectChatGptMapping = {
      ...current,
      conversationUrl: patch.conversationUrl !== undefined ? patch.conversationUrl : current.conversationUrl,
      chatTitle: patch.chatTitle !== undefined ? patch.chatTitle : current.chatTitle,
      mappingStatus: patch.mappingStatus ?? current.mappingStatus,
      lastVerifiedAt: patch.lastVerifiedAt !== undefined ? patch.lastVerifiedAt : current.lastVerifiedAt,
      lastSuccessfulRequestAt:
        patch.lastSuccessfulRequestAt !== undefined ? patch.lastSuccessfulRequestAt : current.lastSuccessfulRequestAt,
      lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
    };
    this.saveMapping(updated);
  }

  public deleteMapping(projectId: string): boolean {
    const res = this.db.prepare("DELETE FROM project_chatgpt_conversations WHERE project_id = ?").run(projectId);
    return Number(res.changes) > 0;
  }

  private mapRow(row: Record<string, unknown>): ProjectChatGptMapping {
    return {
      projectId: String(row.project_id),
      conversationUrl: row.conversation_url ? String(row.conversation_url) : null,
      chatTitle: row.chat_title ? String(row.chat_title) : null,
      mappingStatus: (row.mapping_status as any) || "active",
      createdAt: String(row.created_at),
      lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
      lastSuccessfulRequestAt: row.last_successful_request_at ? String(row.last_successful_request_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
    };
  }
}
