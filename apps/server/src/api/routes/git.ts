import { FastifyPluginAsync } from "fastify";
import { getDb } from "../../storage/db.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { GitManager } from "../../git/git-manager.js";
import { EventStore } from "../../events/event-store.js";

export const gitRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const projectRepo = new ProjectRepository(db);
  const eventStore = new EventStore(db);

  function getProject(projectId: string) {
    const project = projectRepo.findById(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    return project;
  }

  // GET /api/v1/projects/:projectId/git/status
  fastify.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/git/status",
    async (request, reply) => {
      try {
        const project = getProject(request.params.projectId);
        const git = new GitManager(project.rootPath);
        const status = await git.getStatus();
        return reply.status(200).send({
          projectId: project.id,
          rootPath: project.rootPath,
          ...status,
        });
      } catch (err: unknown) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    }
  );

  // GET /api/v1/projects/:projectId/git/diff
  fastify.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/git/diff",
    async (request, reply) => {
      try {
        const project = getProject(request.params.projectId);
        const git = new GitManager(project.rootPath);
        const diffSummary = await git.getDiffSummary();
        return reply.status(200).send(diffSummary);
      } catch (err: unknown) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    }
  );

  // POST /api/v1/projects/:projectId/git/checkpoint
  fastify.post<{
    Params: { projectId: string };
    Body: { message?: string; taskId?: string };
  }>("/projects/:projectId/git/checkpoint", async (request, reply) => {
    try {
      const project = getProject(request.params.projectId);
      const git = new GitManager(project.rootPath);
      const message = request.body?.message || "Manual operator checkpoint";
      const taskId = request.body?.taskId || "manual";
      const commitSha = await git.commitCheckpoint(taskId, message);

      eventStore.record(project.id, "git.checkpoint_created", {
        commitSha,
        message,
        taskId,
      });

      return reply.status(200).send({
        success: true,
        commitSha,
        message,
      });
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // POST /api/v1/projects/:projectId/git/rollback
  fastify.post<{
    Params: { projectId: string };
    Body: { commitSha: string };
  }>("/projects/:projectId/git/rollback", async (request, reply) => {
    try {
      const project = getProject(request.params.projectId);
      const git = new GitManager(project.rootPath);
      const { commitSha } = request.body || {};
      if (!commitSha) {
        return reply.status(400).send({ error: "commitSha is required for rollback" });
      }

      await git.rollbackAttempt(commitSha);

      eventStore.record(project.id, "git.rollback_completed", {
        targetCommit: commitSha,
      });

      return reply.status(200).send({
        success: true,
        targetCommit: commitSha,
      });
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
};
