import { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import { getDb } from "../../storage/db.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { getAntigravityStatus, openInAntigravity } from "../../platform/antigravity.js";

export const ideRoutes: FastifyPluginAsync = async (fastify) => {
  const projects = new ProjectRepository(getDb());

  fastify.get<{ Querystring: { projectId?: string } }>("/ide/status", async (request) => {
    const project = request.query.projectId ? projects.findById(request.query.projectId) : null;
    return getAntigravityStatus(project?.rootPath);
  });

  fastify.post<{ Params: { projectId: string } }>("/projects/:projectId/open-in-ide", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (!fs.existsSync(project.rootPath)) return reply.status(400).send({ error: "Workspace folder does not exist." });
    const res = await openInAntigravity(project.rootPath);
    return res.ok ? res : reply.status(502).send({ error: res.message });
  });
};
