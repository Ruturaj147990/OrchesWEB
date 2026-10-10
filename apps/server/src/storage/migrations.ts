import { DatabaseSync } from "node:sqlite";
import { INITIAL_MIGRATION_SQL } from "./schema.js";

export function runMigrations(db: DatabaseSync): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const check = db.prepare("SELECT name FROM schema_migrations WHERE name = ?");
  const initialApplied = check.get("0001_initial_schema");

  if (!initialApplied) {
    db.exec(INITIAL_MIGRATION_SQL);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run("0001_initial_schema", new Date().toISOString());
  }
}
