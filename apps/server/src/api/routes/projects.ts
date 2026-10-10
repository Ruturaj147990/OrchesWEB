import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { Project, ProjectSchema } from "@orchestrator/shared-types";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const projectRepo = new ProjectRepository(db);
  const eventStore = new EventStore(db);

  // List projects
  fastify.get("/projects", async () => {
    return projectRepo.list();
  });

  // Get project by ID
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
    const project = projectRepo.findById(request.params.projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }
    return project;
  });

  // Create project draft
  fastify.post<{ Body: Partial<Project> }>("/projects", async (request, reply) => {
    const body = request.body || {};
    const now = new Date().toISOString();

    const projectData = {
      id: body.id || `proj-${crypto.randomUUID()}`,
      name: body.name || "Untitled Project",
      objective: body.objective || "",
      rootPath: body.rootPath || process.cwd(),
      profileId: body.profileId || "general",
      autonomyMode: body.autonomyMode || "creative_within_constraints",
      status: "ready" as const,
      createdAt: now,
      updatedAt: now,
    };

    const validated = ProjectSchema.parse(projectData);
    const created = projectRepo.create(validated);

    eventStore.record(created.id, "project.created", {
      projectId: created.id,
      name: created.name,
      autonomyMode: created.autonomyMode,
    });

    return reply.status(201).send(created);
  });
};
