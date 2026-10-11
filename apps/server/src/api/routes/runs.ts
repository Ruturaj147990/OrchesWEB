import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { getDb } from "../../storage/db.js";
import { RunStartError } from "../../orchestrator/run-manager.js";

const StartRunSchema = z.object({ task: z.string() });

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const runRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const runs = new RunRepository(db);
  const manager = fastify.runManager;

  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/runs", async (request) => ({
    runs: runs.listByProject(request.params.projectId),
  }));

  fastify.post<{ Params: { projectId: string }; Body: unknown }>("/projects/:projectId/runs", async (request, reply) => {
    const parsed = StartRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Body must include a 'task' description." });
    try {
      const run = await manager.start(request.params.projectId, parsed.data.task);
      return reply.status(201).send(run);
    } catch (err) {
      const status = err instanceof RunStartError ? err.statusCode : 500;
      return reply.status(status).send({ error: (err as Error).message });
    }
  });

  fastify.post<{ Params: { runId: string } }>("/runs/:runId/stop", async (request, reply) => {
    try {
      return manager.stop(request.params.runId);
    } catch (err) {
      const status = err instanceof RunStartError ? err.statusCode : 500;
      return reply.status(status).send({ error: (err as Error).message });
    }
  });

  // Everything the dashboard needs to explain a run: plan, attempts, files, checks, review, gate.
  fastify.get<{ Params: { runId: string } }>("/runs/:runId", async (request, reply) => {
    const run = runs.findById(request.params.runId);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    const details = runs.getDetails(run.id);
    const task = db.prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at DESC LIMIT 1").get(run.id) as Record<string, unknown> | undefined;
    const attempts = task
      ? (db.prepare("SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt_number ASC").all(task.id as string) as Record<string, unknown>[])
      : [];
    const checks = task
      ? (db.prepare("SELECT * FROM verification_runs WHERE task_id = ? ORDER BY timestamp ASC").all(task.id as string) as Record<string, unknown>[])
      : [];
    return {
      run: { ...run, active: manager.isActive(run.id) },
      details,
      task: task
        ? {
            id: task.id,
            title: task.title,
            status: task.status,
            acceptanceCriteria: parseJson<string[]>(task.acceptance_criteria_json, []),
          }
        : null,
      attempts: attempts.map((a) => ({
        id: a.id,
        number: a.attempt_number,
        status: a.status,
        agentId: a.adapter_id,
        providerId: a.provider_id,
        modelId: a.model_id,
        startedAt: a.started_at,
        endedAt: a.ended_at,
        agentSummary: a.agent_summary,
        agentError: a.agent_error,
        instruction: typeof a.instruction_text === "string" ? a.instruction_text : null,
        transcript: parseJson<Record<string, unknown> | null>(a.agent_transcript_json, null),
        files: parseJson<unknown[]>(a.files_changed_json, []),
        diff: typeof a.diff_text === "string" ? a.diff_text : "",
        gate: parseJson<Record<string, unknown> | null>(a.gate_json, null),
        rollback: parseJson<Record<string, unknown> | null>(a.rollback_json, null),
        checks: checks
          .filter((c) => c.attempt_id === a.id)
          .map((c) => ({
            phase: c.phase,
            kind: c.check_type,
            label: c.command,
            source: c.source,
            status: c.status,
            exitCode: c.exit_code,
            durationMs: c.duration_ms,
            output: c.stdout_snippet,
          })),
      })),
    };
  });
};
