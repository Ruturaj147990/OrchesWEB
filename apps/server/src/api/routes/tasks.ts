import { FastifyPluginAsync } from "fastify";
import { getDb } from "../../storage/db.js";

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List tasks for a project
  fastify.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/tasks",
    async (request) => {
      const stmt = db.prepare(`
        SELECT t.*, 
          COUNT(a.id) as attempt_count,
          MAX(a.attempt_number) as latest_attempt_number
        FROM tasks t
        LEFT JOIN task_attempts a ON a.task_id = t.id
        WHERE t.project_id = ?
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `);
      const tasks = stmt.all(request.params.projectId);
      return { tasks };
    }
  );

  // Get full task detail
  fastify.get<{ Params: { taskId: string } }>(
    "/tasks/:taskId",
    async (request, reply) => {
      const taskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
      const task = taskStmt.get(request.params.taskId);
      if (!task) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const attemptsStmt = db.prepare(`
        SELECT * FROM task_attempts 
        WHERE task_id = ? 
        ORDER BY attempt_number ASC
      `);
      const attempts = attemptsStmt.all(request.params.taskId);

      const verifStmt = db.prepare(`
        SELECT * FROM verification_runs 
        WHERE task_id = ? 
        ORDER BY timestamp ASC
      `);
      const verifications = verifStmt.all(request.params.taskId);

      const criticStmt = db.prepare(`
        SELECT * FROM critic_reviews 
        WHERE task_id = ? 
        ORDER BY created_at ASC
      `);
      const criticReviews = criticStmt.all(request.params.taskId);

      return {
        task,
        attempts,
        verifications,
        criticReviews,
      };
    }
  );
};
