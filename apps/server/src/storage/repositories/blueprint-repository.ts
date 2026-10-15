import { DatabaseSync } from "node:sqlite";
import { ImportedDocument } from "../../domain/blueprints/importer.js";
import { CandidateRequirement } from "../../domain/blueprints/requirement-extractor.js";

export class BlueprintRepository {
  constructor(private db: DatabaseSync) {}

  public addBlueprint(projectId: string, doc: ImportedDocument): ImportedDocument {
    this.db
      .prepare(`
        INSERT INTO project_blueprints (id, project_id, filename, extension, byte_size, sha256, extracted_text, warnings_json, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        doc.id,
        projectId,
        doc.filename,
        doc.extension,
        doc.byteSize,
        doc.sha256,
        doc.extractedText,
        JSON.stringify(doc.warnings),
        doc.importedAt
      );
    return doc;
  }

  public listBlueprints(projectId: string): ImportedDocument[] {
    const rows = this.db
      .prepare("SELECT * FROM project_blueprints WHERE project_id = ? ORDER BY imported_at DESC")
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapBlueprint(r));
  }

  public getBlueprint(id: string): ImportedDocument | null {
    const row = this.db.prepare("SELECT * FROM project_blueprints WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapBlueprint(row) : null;
  }

  public deleteBlueprint(id: string): boolean {
    this.db.prepare("DELETE FROM project_requirements WHERE blueprint_id = ?").run(id);
    const result = this.db.prepare("DELETE FROM project_blueprints WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  public addRequirements(reqs: CandidateRequirement[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO project_requirements (id, project_id, blueprint_id, title, description, provenance_kind, source_reference, status, proposed_acceptance_test, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of reqs) {
      stmt.run(r.id, r.projectId, r.blueprintId ?? null, r.title, r.description, r.provenanceKind, r.sourceReference, r.status, r.proposedAcceptanceTest, r.createdAt);
    }
  }

  public listRequirements(projectId: string): CandidateRequirement[] {
    const rows = this.db
      .prepare("SELECT * FROM project_requirements WHERE project_id = ? ORDER BY id ASC")
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRequirement(r));
  }

  public updateRequirement(id: string, patch: Partial<Pick<CandidateRequirement, "title" | "description" | "status" | "proposedAcceptanceTest">>): CandidateRequirement | null {
    const current = this.db.prepare("SELECT * FROM project_requirements WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!current) return null;

    const next = {
      title: patch.title ?? (current.title as string),
      description: patch.description ?? (current.description as string),
      status: patch.status ?? (current.status as string),
      proposedAcceptanceTest: patch.proposedAcceptanceTest ?? (current.proposed_acceptance_test as string),
    };

    this.db
      .prepare("UPDATE project_requirements SET title = ?, description = ?, status = ?, proposed_acceptance_test = ? WHERE id = ?")
      .run(next.title, next.description, next.status, next.proposedAcceptanceTest, id);

    const updated = this.db.prepare("SELECT * FROM project_requirements WHERE id = ?").get(id) as Record<string, unknown>;
    return this.mapRequirement(updated);
  }

  private mapBlueprint(row: Record<string, unknown>): ImportedDocument {
    let warnings: string[] = [];
    try {
      warnings = JSON.parse((row.warnings_json as string) || "[]");
    } catch (err) {
      console.error(`[BlueprintRepository] Unreadable warnings_json for blueprint ${String(row.id)}: ${(err as Error).message}`);
    }
    return {
      id: row.id as string,
      filename: row.filename as string,
      extension: row.extension as string,
      byteSize: Number(row.byte_size),
      sha256: row.sha256 as string,
      extractedText: row.extracted_text as string,
      warnings,
      importedAt: row.imported_at as string,
    };
  }

  private mapRequirement(row: Record<string, unknown>): CandidateRequirement {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      blueprintId: (row.blueprint_id as string) || undefined,
      title: row.title as string,
      description: row.description as string,
      provenanceKind: row.provenance_kind as "explicit" | "inferred",
      sourceReference: row.source_reference as string,
      status: row.status as "candidate" | "approved" | "rejected",
      proposedAcceptanceTest: row.proposed_acceptance_test as string,
      createdAt: row.created_at as string,
    };
  }
}
