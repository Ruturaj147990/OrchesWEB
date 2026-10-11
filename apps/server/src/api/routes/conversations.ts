import { FastifyPluginAsync } from "fastify";
import { getDb } from "../../storage/db.js";
import { ConversationMemoryService } from "../../domain/memory/conversation-memory-service.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { RunRepository } from "../../storage/repositories/run-repository.js";
import { ConversationStatus } from "@orchestrator/shared-types";

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const memoryService = new ConversationMemoryService(db);
  const projectRepo = new ProjectRepository(db);
  const runRepo = new RunRepository(db);

  // 1. List conversations for a project
  fastify.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/conversations",
    async (request, reply) => {
      const { projectId } = request.params;
      const project = projectRepo.findById(projectId);
      if (!project) return reply.status(404).send({ error: "Project not found" });

      const list = memoryService.listConversations(projectId);
      return { conversations: list };
    }
  );

  // 2. Create a new conversation for a project
  fastify.post<{
    Params: { projectId: string };
    Body: { title?: string; initialInstruction?: string };
  }>("/projects/:projectId/conversations", async (request, reply) => {
    const { projectId } = request.params;
    const project = projectRepo.findById(projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const body = request.body || {};
    const conversation = memoryService.getOrCreateConversation({
      projectId,
      initialInstruction: body.initialInstruction || body.title || "New Engineering Session",
    });

    if (body.title && body.title.trim()) {
      memoryService.updateTitle(conversation.id, body.title.trim());
      conversation.title = body.title.trim();
    }

    if (body.initialInstruction && body.initialInstruction.trim()) {
      memoryService.recordUserMessage(conversation.id, body.initialInstruction.trim());
      conversation.messageCount = 1;
    }

    return reply.status(201).send({ conversation });
  });

  // 3. Get conversation detail (messages & latest snapshot)
  fastify.get<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const { id } = request.params;
    const detail = memoryService.getConversationDetail(id);
    if (!detail) return reply.status(404).send({ error: "Conversation not found" });

    return detail;
  });

  // 4. Update conversation title or status
  fastify.patch<{
    Params: { id: string };
    Body: { title?: string; status?: ConversationStatus };
  }>("/conversations/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = memoryService.getRepository().findById(id);
    if (!existing) return reply.status(404).send({ error: "Conversation not found" });

    const body = request.body || {};
    if (typeof body.title === "string" && body.title.trim()) {
      memoryService.updateTitle(id, body.title.trim());
      existing.title = body.title.trim();
    }

    if (body.status && ["active", "archived", "completed"].includes(body.status)) {
      memoryService.getRepository().updateStatus(id, body.status);
      existing.status = body.status;
    }

    return { conversation: memoryService.getRepository().findById(id) };
  });

  // 5. Append a message to conversation
  fastify.post<{
    Params: { id: string };
    Body: { content: string; meta?: Record<string, unknown> };
  }>("/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params;
    const existing = memoryService.getRepository().findById(id);
    if (!existing) return reply.status(404).send({ error: "Conversation not found" });

    const body = request.body || {};
    if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
      return reply.status(400).send({ error: "Message content is required" });
    }

    const message = memoryService.recordUserMessage(id, body.content.trim(), body.meta);
    return reply.status(201).send({ message });
  });

  // 6. Resume a conversation with a new run
  fastify.post<{
    Params: { id: string };
    Body: { taskText: string; maxAttempts?: number };
  }>("/conversations/:id/resume", async (request, reply) => {
    const { id } = request.params;
    const existing = memoryService.getRepository().findById(id);
    if (!existing) return reply.status(404).send({ error: "Conversation not found" });

    const body = request.body || {};
    const taskText = (body.taskText || "").trim();
    if (taskText.length < 3) {
      return reply.status(400).send({ error: "Describe the task or follow-up instruction to resume." });
    }

    const project = projectRepo.findById(existing.projectId);
    if (!project) {
      return reply.status(404).send({ error: "The associated project has been deleted or cannot be found." });
    }

    if (existing.status === "archived") {
      return reply.status(400).send({ error: "Cannot resume an archived conversation. Unarchive it before resuming." });
    }

    const activeRuns = runRepo.listActive();
    const isRunning = activeRuns.some((r) => r.conversationId === id);
    if (isRunning) {
      return reply.status(409).send({ error: "A run is already actively executing for this conversation." });
    }

    try {
      // Start run linked to this conversation ID
      const run = await fastify.runManager.start(existing.projectId, taskText, {
        maxAttempts: body.maxAttempts,
        conversationId: id,
      });

      memoryService.getRepository().setResumedRunId(id, run.id);
      const updatedConvo = memoryService.getRepository().findById(id);

      return reply.status(201).send({ run, conversation: updatedConvo });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // 7. Delete conversation (real backend deletion)
  fastify.delete<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = memoryService.getRepository().findById(id);
    if (!existing) return reply.status(404).send({ error: "Conversation not found" });

    // Check if an active run is currently executing for this conversation
    const activeRuns = runRepo.listActive();
    const isRunning = activeRuns.some((r) => r.conversationId === id);
    if (isRunning) {
      return reply.status(409).send({ error: "Cannot delete a conversation while a run is actively in progress for it. Stop the run first." });
    }

    const deleted = memoryService.deleteConversation(id);
    if (!deleted) {
      return reply.status(500).send({ error: "Failed to delete conversation" });
    }

    return { ok: true, deletedId: id };
  });
};
