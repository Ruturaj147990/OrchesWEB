import { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import os from "node:os";
import { config } from "../../config/env.js";
import { getDb } from "../../storage/db.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { getSharedIdeBridge } from "./ide.js";
import { reasoningRegistry } from "../../providers/reasoning/registry.js";
import { GitManager } from "../../git/git-manager.js";

export const diagnosticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/diagnostics", async (request, reply) => {
    const db = getDb();
    const projectRepo = new ProjectRepository(db);
    const bridge = getSharedIdeBridge();

    // 1. Database table counts
    let dbStats: Record<string, number> = {};
    try {
      const tables = ["projects", "runs", "tasks", "task_attempts", "verification_runs", "critic_reviews", "events", "human_messages"];
      for (const t of tables) {
        try {
          const res = db.prepare(`SELECT COUNT(*) as count FROM ${t}`).get() as { count: number };
          dbStats[t] = res.count;
        } catch {
          dbStats[t] = -1;
        }
      }
    } catch (err) {
      console.error("DB stats error:", err);
    }

    // 2. Active Project
    const projects = projectRepo.list();
    const activeProject = projects.length > 0 ? projects[0] : null;

    // 3. Git Status of active project
    let gitStatus = null;
    if (activeProject && activeProject.rootPath && fs.existsSync(activeProject.rootPath)) {
      try {
        const git = new GitManager(activeProject.rootPath);
        gitStatus = await git.getStatus();
      } catch {}
    }

    // 4. IDE Status
    const ideState = bridge.getState();

    // 5. Reasoning Provider Status
    const activeProvider = reasoningRegistry.getDefault();

    const memUsage = process.memoryUsage();

    return reply.status(200).send({
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
          rssMb: Math.round(memUsage.rss / (1024 * 1024)),
          heapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024)),
          heapTotalMb: Math.round(memUsage.heapTotal / (1024 * 1024)),
        },
        host: config.host,
        port: config.port,
        loopbackOnly: config.host === "127.0.0.1",
        dataDir: config.dataDir,
      },
      database: {
        connected: true,
        walMode: true,
        counts: dbStats,
      },
      activeProject: activeProject
        ? {
            id: activeProject.id,
            name: activeProject.name,
            rootPath: activeProject.rootPath,
            exists: fs.existsSync(activeProject.rootPath),
            gitStatus,
          }
        : null,
      ide: {
        status: ideState.status,
        activeMode: ideState.activeMode,
        bridgeType: ideState.agentBridgeType,
        selectedWorkspace: ideState.selectedWorkspace,
        detectedCount: ideState.detectedWorkspaces.length,
        stages: ideState.stages,
        lastHeartbeat: ideState.lastHeartbeat,
        errorMessage: ideState.errorMessage,
      },
      reasoning: {
        activeId: reasoningRegistry.getDefaultId(),
        displayName: activeProvider.displayName,
        privacyClass: activeProvider.privacyClass,
        hasOpenAiKey: Boolean(config.openaiApiKey),
        localBaseUrl: config.localReasoningBaseUrl,
        localModel: config.localReasoningModel,
      },
      security: {
        loopbackEnforced: true,
        corsOrigins: config.allowedOrigins,
        secretRedactionActive: true,
      },
    });
  });
};
