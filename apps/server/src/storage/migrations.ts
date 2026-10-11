import { DatabaseSync } from "node:sqlite";
import { INITIAL_MIGRATION_SQL } from "./schema.js";

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/** Columns added by 0002: what a run actually did, with which provider and mechanism. */
const RUN_EVIDENCE_COLUMNS: Array<[string, string, string]> = [
  ["runs", "task_text", "TEXT"],
  ["runs", "title", "TEXT"],
  ["runs", "provider_id", "TEXT"],
  ["runs", "model_id", "TEXT"],
  ["runs", "agent_id", "TEXT"],
  ["runs", "outcome", "TEXT"],
  ["runs", "summary", "TEXT"],
  ["runs", "safety_mode", "TEXT"],
  ["runs", "commit_sha", "TEXT"],
  ["runs", "details_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["task_attempts", "snapshot_id", "TEXT"],
  ["task_attempts", "files_changed_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["task_attempts", "diff_text", "TEXT"],
  ["task_attempts", "gate_json", "TEXT"],
  ["task_attempts", "agent_summary", "TEXT"],
  ["task_attempts", "agent_error", "TEXT"],
  ["task_attempts", "rollback_json", "TEXT"],
  ["verification_runs", "phase", "TEXT NOT NULL DEFAULT 'attempt'"],
  ["verification_runs", "source", "TEXT"],
  ["projects", "verification_commands_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["projects", "auto_commit", "INTEGER NOT NULL DEFAULT 1"],
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = (name: string) => Boolean(db.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(name));
  const mark = (name: string) =>
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());

  if (!applied("0001_initial_schema")) {
    db.exec(INITIAL_MIGRATION_SQL);
    mark("0001_initial_schema");
  }

  if (!applied("0002_run_evidence")) {
    db.exec("BEGIN");
    try {
      for (const [table, column, type] of RUN_EVIDENCE_COLUMNS) {
        if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id ON task_attempts(task_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id)");
      mark("0002_run_evidence");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
