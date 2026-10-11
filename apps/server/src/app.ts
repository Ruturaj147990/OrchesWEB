import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config, ORCHESTRATOR_ROOT } from "./config/env.js";
import { initDb } from "./storage/db.js";
import { runMigrations } from "./storage/migrations.js";
import { EventStore } from "./events/event-store.js";
import { ReasoningUsageLedger } from "./domain/budgets/usage-ledger.js";
import { RunManager, RunManagerOverrides } from "./orchestrator/run-manager.js";
import { healthRoutes } from "./api/routes/health.js";
import { projectRoutes } from "./api/routes/projects.js";
import { runRoutes } from "./api/routes/runs.js";
import { eventRoutes } from "./api/routes/events.js";
import { messageRoutes } from "./api/routes/messages.js";
import { settingsRoutes } from "./api/routes/settings.js";
import { ideRoutes } from "./api/routes/ide.js";
import { gitRoutes } from "./api/routes/git.js";

declare module "fastify" {
  interface FastifyInstance {
    runManager: RunManager;
  }
}

export interface BuildAppOptions {
  dbPath?: string;
  runOverrides?: RunManagerOverrides;
  /** Serve the built web UI from apps/web/dist when present (default true). */
  serveWeb?: boolean;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions | string = {}): Promise<FastifyInstance> {
  const opts: BuildAppOptions = typeof options === "string" ? { dbPath: options } : options;
  const db = initDb(opts.dbPath);
  runMigrations(db);
  ReasoningUsageLedger.getShared(db);

  const app = fastify({ logger: config.env === "development" ? { level: "warn" } : false });

  // DNS-rebinding protection: only answer requests addressed to a loopback host name.
  app.addHook("onRequest", async (request, reply) => {
    const host = (request.headers.host || "").split(":")[0].toLowerCase();
    if (host && !["127.0.0.1", "localhost", "[::1]"].includes(host)) {
      return reply.status(403).send({ error: "This server only accepts requests addressed to localhost." });
    }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.allowedOrigins.includes(origin) || isLoopbackOrigin(origin)) return cb(null, true);
      cb(new Error("Cross-origin request rejected: only loopback origins may call this API."), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  const events = new EventStore(db);
  const runManager = new RunManager(db, events, opts.runOverrides);
  app.decorate("runManager", runManager);
  const recovered = runManager.recoverInterruptedRuns();
  if (recovered > 0) console.warn(`[orchestrator] Recovered ${recovered} run(s) interrupted by a previous shutdown.`);

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(projectRoutes, { prefix: "/api/v1" });
  await app.register(runRoutes, { prefix: "/api/v1" });
  await app.register(eventRoutes, { prefix: "/api/v1" });
  await app.register(messageRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1" });
  await app.register(ideRoutes, { prefix: "/api/v1" });
  await app.register(gitRoutes, { prefix: "/api/v1" });

  const webDist = path.join(ORCHESTRATOR_ROOT, "apps", "web", "dist");
  if (opts.serveWeb !== false && fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    await runManager.shutdown();
  });
  return app;
}
