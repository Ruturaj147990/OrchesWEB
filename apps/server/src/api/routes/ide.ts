import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { IdeBridge } from "../../platform/ide/ide-bridge.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { getDb } from "../../storage/db.js";

// Singleton IdeBridge for active server process
let sharedBridge: IdeBridge | null = null;

export function getSharedIdeBridge(): IdeBridge {
  if (!sharedBridge) {
    sharedBridge = new IdeBridge();
  }
  return sharedBridge;
}

export function resetSharedIdeBridge(customBridge?: IdeBridge): void {
  if (sharedBridge) {
    sharedBridge.disconnect();
  }
  sharedBridge = customBridge || new IdeBridge();
}

export const ideRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const bridge = getSharedIdeBridge();

  function getActiveProjectRoot(): string {
    try {
      const db = getDb();
      const projectRepo = new ProjectRepository(db);
      const projects = projectRepo.list();
      if (projects.length > 0 && projects[0].rootPath) {
        return projects[0].rootPath;
      }
    } catch {
      // Fallback
    }
    return process.cwd();
  }

  // GET /api/v1/ide/status
  fastify.get("/ide/status", async (request, reply) => {
    const rootPath = getActiveProjectRoot();
    // If disconnected and haven't detected yet, run initial detection
    const current = bridge.getState();
    if (current.status === "disconnected" && current.detectedWorkspaces.length === 0) {
      await bridge.detect(rootPath);
    }
    return reply.status(200).send(bridge.getState());
  });

  // POST /api/v1/ide/detect
  fastify.post("/ide/detect", async (request, reply) => {
    const body = (request.body as { projectRootPath?: string }) || {};
    const rootPath = body.projectRootPath || getActiveProjectRoot();
    const updated = await bridge.detect(rootPath);
    return reply.status(200).send(updated);
  });

  // POST /api/v1/ide/select-workspace
  const selectWorkspaceSchema = z.object({
    workspaceId: z.string(),
    projectRootPath: z.string().optional(),
  });

  fastify.post("/ide/select-workspace", async (request, reply) => {
    const parse = selectWorkspaceSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: "Invalid body. 'workspaceId' is required." });
    }

    const rootPath = parse.data.projectRootPath || getActiveProjectRoot();
    try {
      const updated = bridge.selectWorkspace(parse.data.workspaceId, rootPath);
      return reply.status(200).send(updated);
    } catch (err: unknown) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // POST /api/v1/ide/connect
  fastify.post("/ide/connect", async (request, reply) => {
    const body = (request.body as { projectRootPath?: string }) || {};
    const rootPath = body.projectRootPath || getActiveProjectRoot();
    const updated = await bridge.connect(rootPath);
    return reply.status(200).send(updated);
  });

  // POST /api/v1/ide/test-connection
  fastify.post("/ide/test-connection", async (request, reply) => {
    const body = (request.body as { projectRootPath?: string }) || {};
    const rootPath = body.projectRootPath || getActiveProjectRoot();
    const result = await bridge.testAgent(rootPath);
    const updated = bridge.getState();
    return reply.status(200).send({
      ...result,
      state: updated,
    });
  });

  // POST /api/v1/ide/disconnect
  fastify.post("/ide/disconnect", async (request, reply) => {
    const updated = bridge.disconnect();
    return reply.status(200).send(updated);
  });

  // POST /api/v1/ide/mode
  const modeSchema = z.object({
    mode: z.enum(["visible_ide", "headless_cli"]),
  });

  fastify.post("/ide/mode", async (request, reply) => {
    const parse = modeSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: "Mode must be 'visible_ide' or 'headless_cli'." });
    }
    const updated = bridge.setMode(parse.data.mode);
    return reply.status(200).send(updated);
  });
};
