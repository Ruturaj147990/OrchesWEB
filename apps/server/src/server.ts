import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env before the config module reads process.env (cwd first, then the repository root).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
for (const candidate of [path.resolve(process.cwd(), ".env"), path.join(repoRoot, ".env")]) {
  if (fs.existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch (err) {
      console.warn(`[orchestrator] Could not load ${candidate}: ${(err as Error).message}`);
    }
  }
}

// Validate runtime version (requires built-in node:sqlite in Node.js 22.5+)
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  console.error(`[orchestrator] Node.js 22.5.0 or higher is required (current: ${process.version}). Orches relies on built-in node:sqlite.`);
  process.exit(1);
}

const { buildApp } = await import("./app.js");
const { config } = await import("./config/env.js");

const app = await buildApp();
try {
  const address = await app.listen({ host: config.host, port: config.port });
  console.log(`[orchestrator] Listening on ${address} (data: ${config.dataDir})`);
} catch (err) {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "EADDRINUSE") {
    console.error(`[orchestrator] Port ${config.port} is already in use by another process. Stop the existing instance or set ORCHESTRATOR_PORT in .env.`);
  } else {
    console.error(`[orchestrator] Failed to start: ${error.message}`);
  }
  process.exit(1);
}

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    console.log(`[orchestrator] ${signal} received: stopping active runs and rolling back unfinished attempts…`);
    await app.close();
    process.exit(0);
  });
}
