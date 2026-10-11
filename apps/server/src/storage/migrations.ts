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

  if (!applied("0003_agent_loop")) {
    for (const [table, column, type] of [
      ["task_attempts", "instruction_text", "TEXT"],
      ["task_attempts", "agent_transcript_json", "TEXT"],
    ]) {
      if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    mark("0003_agent_loop");
  }

  if (!applied("0004_blueprints_and_modes")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_blueprints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        extension TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        extracted_text TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_requirements (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        blueprint_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        provenance_kind TEXT NOT NULL DEFAULT 'explicit',
        source_reference TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        proposed_acceptance_test TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_project_blueprints_project_id ON project_blueprints(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_requirements_project_id ON project_requirements(project_id);
    `);
    mark("0004_blueprints_and_modes");
  }

  if (!applied("0005_conversation_memory")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resumed_run_id TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_memory_snapshots (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        snapshot_markdown TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_messages_convo_id ON conversation_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversation_snapshots_convo_id ON conversation_memory_snapshots(conversation_id, created_at);
    `);

    if (!columnExists(db, "runs", "conversation_id")) {
      db.exec("ALTER TABLE runs ADD COLUMN conversation_id TEXT");
    }
    mark("0005_conversation_memory");
  }
}

