import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProjectSchema } from "@orchestrator/shared-types";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";
import { validateWorkspaceRoot } from "../../workspace/path-safety.js";
import { inspectProject } from "../../workspace/project-inspector.js";
import { GitManager } from "../../git/git-manager.js";
import { SettingsManager } from "../../platform/settings-manager.js";
import { ORCHESTRATOR_ROOT } from "../../config/env.js";

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  rootPath: z.string().trim().min(1),
  createFolder: z.boolean().optional().default(false),
  verificationCommands: z.array(z.string().trim().min(1).max(500)).max(10).optional().default([]),
  autoCommit: z.boolean().optional().default(true),
});

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rootPath: z.string().trim().min(1).optional(),
  verificationCommands: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  autoCommit: z.boolean().optional(),
});

export function forbiddenWorkspaceRoots(): string[] {
  return [ORCHESTRATOR_ROOT, SettingsManager.getDataDir()];
}

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const projects = new ProjectRepository(db);
  const runs = new RunRepository(db);
  const events = new EventStore(db);

  fastify.get("/projects", async () => projects.list());

  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    return project ?? reply.status(404).send({ error: "Project not found" });
  });

  fastify.post<{ Body: unknown }>("/projects", async (request, reply) => {
    const parsed = CreateProjectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const body = parsed.data;
    const check = validateWorkspaceRoot(body.rootPath, forbiddenWorkspaceRoots(), { allowCreate: body.createFolder });
    if (!check.ok) return reply.status(400).send({ error: check.reason });
    if (!fs.existsSync(check.canonicalPath)) fs.mkdirSync(check.canonicalPath);

    const duplicate = projects.list().find((p) => path.resolve(p.rootPath).toLowerCase() === check.canonicalPath.toLowerCase());
    if (duplicate) return reply.status(409).send({ error: `A project for this folder already exists ("${duplicate.name}").`, project: duplicate });

    const now = new Date().toISOString();
    const project = ProjectSchema.parse({
      id: `proj-${crypto.randomUUID()}`,
      name: body.name,
      objective: "",
      rootPath: check.canonicalPath,
      status: "ready",
      verificationCommands: body.verificationCommands,
      autoCommit: body.autoCommit,
      createdAt: now,
      updatedAt: now,
    });
    projects.create(project);
    events.record(project.id, "project.created", { name: project.name, rootPath: project.rootPath });
    return reply.status(201).send(project);
  });

  fastify.patch<{ Params: { projectId: string }; Body: unknown }>("/projects/:projectId", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    const parsed = UpdateProjectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    const fields = { ...parsed.data };
    if (fields.rootPath !== undefined) {
      if (runs.findActiveByProjectId(project.id)) return reply.status(409).send({ error: "Stop the active run before changing the workspace folder." });
      const check = validateWorkspaceRoot(fields.rootPath, forbiddenWorkspaceRoots());
      if (!check.ok) return reply.status(400).send({ error: check.reason });
      fields.rootPath = check.canonicalPath;
    }
    const updated = projects.update(project.id, fields);
    events.record(project.id, "project.updated", { fields: Object.keys(fields) });
    return updated;
  });

  // Removes the project from the dashboard. Never touches files in the workspace.
  fastify.delete<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (runs.findActiveByProjectId(project.id)) return reply.status(409).send({ error: "Stop the active run first." });
    projects.update(project.id, { status: "archived" });
    return { success: true };
  });

  // What the orchestrator knows about the workspace: type, checks it would run, Git state.
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/workspace", async (request, reply) => {
    const project = projects.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    const exists = fs.existsSync(project.rootPath);
    if (!exists) return { exists: false, rootPath: project.rootPath };
    const [profile, git] = await Promise.all([inspectProject(project.rootPath, project.verificationCommands), new GitManager(project.rootPath).getStatus()]);
    return {
      exists: true,
      rootPath: project.rootPath,
      profile: { ...profile, checks: profile.checks.map((c) => ({ id: c.id, label: c.label, source: c.source, kind: c.kind })) },
      git: { ...git, dirtyFiles: git.dirtyFiles.slice(0, 50) },
    };
  });
};
