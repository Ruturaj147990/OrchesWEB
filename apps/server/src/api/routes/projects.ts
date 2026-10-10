import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Project, ProjectSchema } from "@orchestrator/shared-types";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";
import { SecretRedactor } from "../../platform/secret-redactor.js";

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

  // Export complete project memory, tasks, verification evidence, and audit events
  fastify.get<{
    Params: { projectId: string };
    Querystring: { format?: string };
  }>("/projects/:projectId/export", async (request, reply) => {
    const { projectId } = request.params;
    const project = projectRepo.findById(projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }

    const readFileSafe = (relPath: string): string | null => {
      try {
        const full = path.join(project.rootPath, relPath);
        if (fs.existsSync(full)) {
          return fs.readFileSync(full, "utf8");
        }
      } catch {}
      return null;
    };

    const memory = {
      spec: readFileSafe("SPEC.md"),
      decisions: readFileSafe("DECISIONS.md"),
      currentState: readFileSafe("CURRENT_STATE.md"),
      roadmap: readFileSafe(".orchestrator/ROADMAP.md"),
      repoMap: readFileSafe(".orchestrator/REPO_MAP.md"),
      taskHistory: readFileSafe(".orchestrator/TASK_HISTORY.json"),
    };

    const tasks = db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC
    `).all(projectId);

    const attempts = db.prepare(`
      SELECT a.* FROM task_attempts a 
      JOIN tasks t ON t.id = a.task_id 
      WHERE t.project_id = ? 
      ORDER BY a.started_at ASC
    `).all(projectId);

    const verifications = db.prepare(`
      SELECT v.* FROM verification_runs v 
      JOIN tasks t ON t.id = v.task_id 
      WHERE t.project_id = ? 
      ORDER BY v.timestamp ASC
    `).all(projectId);

    const criticReviews = db.prepare(`
      SELECT c.* FROM critic_reviews c 
      JOIN tasks t ON t.id = c.task_id 
      WHERE t.project_id = ? 
      ORDER BY c.created_at ASC
    `).all(projectId);

    const rawEvents = eventStore.getEvents(projectId);
    const budgetCounters = db.prepare(`
      SELECT * FROM budget_counters WHERE project_id = ?
    `).all(projectId);

    const exportBundle = {
      exportedAt: new Date().toISOString(),
      project,
      memory,
      tasks,
      attempts,
      verifications,
      criticReviews,
      budgetCounters,
      events: rawEvents,
    };

    const sanitizedBundle = SecretRedactor.redactObject(exportBundle);

    if (request.query.format === "markdown") {
      const mdReport = `
# Autonomous Orchestration Run Report: ${sanitizedBundle.project.name}

- **Project ID:** \`${sanitizedBundle.project.id}\`
- **Autonomy Mode:** \`${sanitizedBundle.project.autonomyMode}\`
- **Profile:** \`${sanitizedBundle.project.profileId}\`
- **Status:** \`${sanitizedBundle.project.status}\`
- **Exported At:** ${sanitizedBundle.exportedAt}

---

## 1. Project Objective & Memory Summary
${sanitizedBundle.project.objective || "No objective statement recorded."}

### Specification
${sanitizedBundle.memory.spec || "*(No SPEC.md)*"}

### Approved Roadmap
${sanitizedBundle.memory.roadmap || "*(No ROADMAP.md)*"}

---

## 2. Tasks & Independent Verification Evidence
Total Tasks Dispatched: ${sanitizedBundle.tasks.length}
Total Independent Verifications: ${sanitizedBundle.verifications.length}

${sanitizedBundle.tasks.map((t: any) => `
### Task: ${t.title} (\`${t.id}\`)
- **Status:** \`${t.status}\` | **Priority:** \`${t.priority}\` | **Risk:** \`${t.risk}\`
- **Objective:** ${t.objective}
- **Roadmap Item:** \`${t.roadmap_item_id}\`
`).join("\n")}

---

## 3. Independent Critic Reviews
${sanitizedBundle.criticReviews.map((c: any) => `
- **Attempt \`${c.attempt_id}\` Verdict:** \`${c.verdict.toUpperCase()}\`
  - Rationale: ${c.rationale}
`).join("\n\n")}

---

## 4. Audit Event Stream Summary
Total Events Logged: ${sanitizedBundle.events.length}
      `.trim();

      reply.header("Content-Type", "text/markdown; charset=utf-8");
      return reply.send(mdReport);
    }

    reply.header("Content-Type", "application/json; charset=utf-8");
    return reply.send(sanitizedBundle);
  });
};
