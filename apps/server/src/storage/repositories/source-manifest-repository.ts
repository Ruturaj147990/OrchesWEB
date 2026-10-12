import { DatabaseSync } from "node:sqlite";
import type { SourceManifestItem, SourceManifestStatus } from "@orchestrator/shared-types";

export class SourceManifestRepository {
  constructor(private db: DatabaseSync) {}

  public addItem(item: SourceManifestItem): SourceManifestItem {
    this.db
      .prepare(`
        INSERT INTO source_manifest_items (
          id, project_id, original_filename, extension, byte_size, sha256,
          extraction_status, delivery_status, delivery_method, redaction_completed,
          sanitized_path, superseded_by_id, error_message, created_at, updated_at, delivered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          extraction_status = excluded.extraction_status,
          delivery_status = excluded.delivery_status,
          delivery_method = excluded.delivery_method,
          redaction_completed = excluded.redaction_completed,
          sanitized_path = excluded.sanitized_path,
          superseded_by_id = excluded.superseded_by_id,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at,
          delivered_at = excluded.delivered_at
      `)
      .run(
        item.id,
        item.projectId,
        item.originalFilename,
        item.extension,
        item.byteSize,
        item.sha256,
        item.extractionStatus,
        item.deliveryStatus,
        item.deliveryMethod,
        item.redactionCompleted ? 1 : 0,
        item.sanitizedPath ?? null,
        item.supersededById ?? null,
        item.errorMessage ?? null,
        item.createdAt,
        item.updatedAt,
        item.deliveredAt ?? null
      );
    return item;
  }

  public listItems(projectId: string): SourceManifestItem[] {
    const rows = this.db
      .prepare("SELECT * FROM source_manifest_items WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public getItem(id: string): SourceManifestItem | null {
    const row = this.db
      .prepare("SELECT * FROM source_manifest_items WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findBySha256(projectId: string, sha256: string): SourceManifestItem | null {
    const row = this.db
      .prepare("SELECT * FROM source_manifest_items WHERE project_id = ? AND sha256 = ? LIMIT 1")
      .get(projectId, sha256) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public updateStatus(
    id: string,
    patch: Partial<
      Pick<
        SourceManifestItem,
        | "extractionStatus"
        | "deliveryStatus"
        | "deliveryMethod"
        | "redactionCompleted"
        | "sanitizedPath"
        | "supersededById"
        | "errorMessage"
        | "deliveredAt"
      >
    >
  ): SourceManifestItem | null {
    const current = this.getItem(id);
    if (!current) return null;

    const now = new Date().toISOString();
    const updated: SourceManifestItem = {
      ...current,
      extractionStatus: patch.extractionStatus ?? current.extractionStatus,
      deliveryStatus: patch.deliveryStatus ?? current.deliveryStatus,
      deliveryMethod: patch.deliveryMethod ?? current.deliveryMethod,
      redactionCompleted:
        patch.redactionCompleted !== undefined ? patch.redactionCompleted : current.redactionCompleted,
      sanitizedPath: patch.sanitizedPath !== undefined ? patch.sanitizedPath : current.sanitizedPath,
      supersededById: patch.supersededById !== undefined ? patch.supersededById : current.supersededById,
      errorMessage: patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
      deliveredAt: patch.deliveredAt !== undefined ? patch.deliveredAt : current.deliveredAt,
      updatedAt: now,
    };
    return this.addItem(updated);
  }

  public deleteItem(id: string): boolean {
    const res = this.db.prepare("DELETE FROM source_manifest_items WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  private mapRow(row: Record<string, unknown>): SourceManifestItem {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      originalFilename: String(row.original_filename),
      extension: String(row.extension),
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      extractionStatus: String(row.extraction_status),
      deliveryStatus: row.delivery_status as SourceManifestStatus,
      deliveryMethod: (row.delivery_method as any) || "browser_upload",
      redactionCompleted: Number(row.redaction_completed) === 1,
      sanitizedPath: row.sanitized_path ? String(row.sanitized_path) : null,
      supersededById: row.superseded_by_id ? String(row.superseded_by_id) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    };
  }
}
