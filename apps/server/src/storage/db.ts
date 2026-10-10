import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";

let instance: DatabaseSync | null = null;

export function initDb(dbPath?: string): DatabaseSync {
  if (instance) return instance;

  const resolvedPath = dbPath || path.join(config.dataDir, "orchestrator.sqlite");

  if (resolvedPath !== ":memory:") {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  instance = new DatabaseSync(resolvedPath);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA busy_timeout = 5000;");

  return instance;
}

export function getDb(): DatabaseSync {
  if (!instance) {
    return initDb();
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
