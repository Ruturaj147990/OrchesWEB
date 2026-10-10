import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/env.js";
import { initDb } from "./storage/db.js";
import { runMigrations } from "./storage/migrations.js";
import { healthRoutes } from "./api/routes/health.js";
import { projectRoutes } from "./api/routes/projects.js";
import { runRoutes } from "./api/routes/runs.js";
import { eventRoutes } from "./api/routes/events.js";

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

  // Register API routes
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(projectRoutes, { prefix: "/api/v1" });
  await app.register(runRoutes, { prefix: "/api/v1" });
  await app.register(eventRoutes, { prefix: "/api/v1" });

  return app;
}
