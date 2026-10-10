import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config/env.js";
import { initDb } from "./storage/db.js";
import { runMigrations } from "./storage/migrations.js";
import { healthRoutes } from "./api/routes/health.js";
import { projectRoutes } from "./api/routes/projects.js";
import { runRoutes } from "./api/routes/runs.js";
import { eventRoutes } from "./api/routes/events.js";
import { blueprintRoutes } from "./api/routes/blueprints.js";
import { messageRoutes } from "./api/routes/messages.js";
import { taskRoutes } from "./api/routes/tasks.js";
import { providerRoutes } from "./api/routes/providers.js";
import { ideRoutes } from "./api/routes/ide.js";
import { gitRoutes } from "./api/routes/git.js";
import { diagnosticsRoutes } from "./api/routes/diagnostics.js";

export async function buildApp(dbPath?: string): Promise<FastifyInstance> {
  // Initialize SQLite database and apply migrations
  const db = initDb(dbPath);
  runMigrations(db);

  const app = fastify({
    logger: config.env !== "test",
  });

  // Strict origin checking for CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like curl, test runners, local scripts)
      if (!origin) return cb(null, true);

      // Verify origin is in allowed loopback list
      if (
        config.allowedOrigins.includes(origin) ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("http://localhost:")
      ) {
        return cb(null, true);
      }
      return cb(new Error("Cross-origin request rejected by loopback policy"), false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  // Static artifact serving
  const artifactsDir = path.join(config.dataDir, "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  await app.register(fastifyStatic, {
    root: artifactsDir,
    prefix: "/api/v1/artifacts/",
    decorateReply: false,
  });

  // Register API routes
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(projectRoutes, { prefix: "/api/v1" });
  await app.register(runRoutes, { prefix: "/api/v1" });
  await app.register(eventRoutes, { prefix: "/api/v1" });
  await app.register(blueprintRoutes, { prefix: "/api/v1" });
  await app.register(messageRoutes, { prefix: "/api/v1" });
  await app.register(taskRoutes, { prefix: "/api/v1" });
  await app.register(providerRoutes, { prefix: "/api/v1" });
  await app.register(ideRoutes, { prefix: "/api/v1" });
  await app.register(gitRoutes, { prefix: "/api/v1" });
  await app.register(diagnosticsRoutes, { prefix: "/api/v1" });

  return app;
}
