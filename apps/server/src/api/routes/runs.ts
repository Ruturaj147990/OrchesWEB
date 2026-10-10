import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { Run, RunSchema } from "@orchestrator/shared-types";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { RunStateMachine } from "../../orchestrator/state-machine.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

export const runRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const runRepo = new RunRepository(db);
  const eventStore = new EventStore(db);
  const stateMachine = new RunStateMachine(runRepo, eventStore);

  // Start or return existing active run for project (idempotent)
  fastify.post<{ Params: { projectId: string } }>("/projects/:projectId/runs", async (request, reply) => {
    const { projectId } = request.params;

    // Check for existing active run to guarantee idempotency
    const existingActive = runRepo.findActiveByProjectId(projectId);
    if (existingActive) {
      if (existingActive.status === "ready" || existingActive.status === "paused") {
        const resumed = stateMachine.transition(existingActive.id, "running");
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

    return reply.status(201).send(validated);
  });

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
  fastify.post<{ Params: { runId: string } }>("/runs/:runId/resume", async (request, reply) => {
    try {
      const updated = stateMachine.transition(request.params.runId, "running", "User resumed run");
      return reply.status(200).send(updated);
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
};
