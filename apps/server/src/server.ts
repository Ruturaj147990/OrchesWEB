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

const { buildApp } = await import("./app.js");
const { config } = await import("./config/env.js");

const app = await buildApp();
try {
  const address = await app.listen({ host: config.host, port: config.port });
  console.log(`[orchestrator] Listening on ${address} (data: ${config.dataDir})`);
} catch (err) {
  console.error(`[orchestrator] Failed to start: ${(err as Error).message}`);
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
