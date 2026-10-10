import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { Run, RunSchema } from "@orchestrator/shared-types";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { RunStateMachine } from "../../orchestrator/state-machine.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";
import { RunExecutionService } from "../../orchestrator/run-execution-service.js";

export const runRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const runRepo = new RunRepository(db);
  const projectRepo = new ProjectRepository(db);
  const eventStore = new EventStore(db);
  const stateMachine = new RunStateMachine(runRepo, eventStore);
  const executionService = new RunExecutionService(db, runRepo, projectRepo, eventStore, stateMachine);

  // List all runs across projects
  fastify.get("/runs", async () => {
    const stmt = db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 50");
    const rows = stmt.all() as Record<string, unknown>[];
    return {
      runs: rows.map((r) => ({
        id: r.id as string,
        projectId: r.project_id as string,
        status: r.status as Run["status"],
        currentTaskId: (r.current_task_id as string) || null,
        iterationCount: Number(r.iteration_count || 0),
        stopReason: (r.stop_reason as string) || null,
        startedAt: r.started_at as string,
        endedAt: (r.ended_at as string) || null,
      })),
    };
  });

  // List runs for a specific project
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/runs", async (request) => {
    const stmt = db.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC");
    const rows = stmt.all(request.params.projectId) as Record<string, unknown>[];
    return {
      runs: rows.map((r) => ({
        id: r.id as string,
        projectId: r.project_id as string,
        status: r.status as Run["status"],
        currentTaskId: (r.current_task_id as string) || null,
        iterationCount: Number(r.iteration_count || 0),
        stopReason: (r.stop_reason as string) || null,
        startedAt: r.started_at as string,
        endedAt: (r.ended_at as string) || null,
      })),
    };
  });

  // Start or return existing active run for project (idempotent)
  fastify.post<{ Params: { projectId: string }; Body: { allowDirty?: boolean } }>(
    "/projects/:projectId/runs",
    async (request, reply) => {
      const { projectId } = request.params;
      const { allowDirty } = request.body || {};

      // Check for existing active run to guarantee idempotency
      const existingActive = runRepo.findActiveByProjectId(projectId);
      if (existingActive) {
        if (existingActive.status === "ready" || existingActive.status === "paused") {
          const resumed = stateMachine.transition(existingActive.id, "running");
          // Trigger execution step in background
          executionService.triggerRunExecution(projectId, existingActive.id, { allowDirty });
          return reply.status(200).send(resumed);
        }
        return reply.status(200).send(existingActive);
      }

      const now = new Date().toISOString();
      const newRun: Run = {
        id: `run-${crypto.randomUUID()}`,
        projectId,
        status: "running",
        currentTaskId: null,
        iterationCount: 0,
        stopReason: null,
        startedAt: now,
        endedAt: null,
      };

      const validated = RunSchema.parse(newRun);
      runRepo.create(validated);

      eventStore.record(projectId, "run.started", {
        runId: validated.id,
        status: validated.status,
      }, validated.id);

      // Trigger background autonomous loop execution
      executionService.triggerRunExecution(projectId, validated.id, { allowDirty });

      return reply.status(201).send(validated);
    }
  );

  // Get run detail
  fastify.get<{ Params: { runId: string } }>("/runs/:runId", async (request, reply) => {
    const run = runRepo.findById(request.params.runId);
    if (!run) {
      return reply.status(404).send({ error: "Run not found" });
    }
    return run;
  });

  // Pause run
  fastify.post<{ Params: { runId: string } }>("/runs/:runId/pause", async (request, reply) => {
    try {
      const updated = stateMachine.transition(request.params.runId, "paused", "User requested pause");
      return reply.status(200).send(updated);
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Stop run
  fastify.post<{ Params: { runId: string } }>("/runs/:runId/stop", async (request, reply) => {
    try {
      const updated = stateMachine.transition(request.params.runId, "stopped", "User requested stop");
      return reply.status(200).send(updated);
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Resume run
  fastify.post<{ Params: { runId: string }; Body: { allowDirty?: boolean } }>(
    "/runs/:runId/resume",
    async (request, reply) => {
      try {
        const run = runRepo.findById(request.params.runId);
        if (!run) {
          return reply.status(404).send({ error: "Run not found" });
        }
        const updated = stateMachine.transition(request.params.runId, "running", "User resumed run");
        executionService.triggerRunExecution(run.projectId, run.id, { allowDirty: request.body?.allowDirty });
        return reply.status(200).send(updated);
      } catch (err: unknown) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    }
  );

  // Trigger manual step execution on run
  fastify.post<{ Params: { runId: string }; Body: { allowDirty?: boolean } }>(
    "/runs/:runId/step",
    async (request, reply) => {
      const run = runRepo.findById(request.params.runId);
      if (!run) {
        return reply.status(404).send({ error: "Run not found" });
      }
      executionService.triggerRunExecution(run.projectId, run.id, { allowDirty: request.body?.allowDirty });
      return reply.status(200).send({ message: "Task step dispatched" });
    }
  );
};
