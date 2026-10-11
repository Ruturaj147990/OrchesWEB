import { FastifyPluginAsync } from "fastify";
import { getDb } from "../../storage/db.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { GitManager } from "../../git/git-manager.js";
import { EventStore } from "../../events/event-store.js";

export const gitRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const projects = new ProjectRepository(db);
  const runs = new RunRepository(db);
  const events = new EventStore(db);

  // Initialize a local repository (explicit user action). Never adds remotes, pushes, or commits.
  fastify.post<{ Params: { projectId: string } }>("/projects/:projectId/git/init", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (runs.findActiveByProjectId(project.id)) return reply.status(409).send({ error: "Stop the active run first." });
    const git = new GitManager(project.rootPath);
    if ((await git.getStatus()).isGitRepo) return reply.status(409).send({ error: "This folder is already inside a Git repository." });
    try {
      const res = await git.initRepo();
      events.record(project.id, "git.initialized", { rootPath: project.rootPath });
      return { ...res, status: await git.getStatus() };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
};
