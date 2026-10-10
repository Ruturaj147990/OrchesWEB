import { buildApp } from "./app.js";
import { config } from "./config/env.js";

async function start() {
  const app = await buildApp();
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(`[Orchestrator Server] Running on ${address} (Host: ${config.host})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  start();
}
