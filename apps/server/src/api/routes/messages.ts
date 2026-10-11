import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HumanMessageKindSchema } from "@orchestrator/shared-types";
import { InboxService } from "../../domain/human-messages/inbox-service.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

// Guidance is the only message kind the pipeline acts on (it is added to the next attempt's
// prompt). Stopping a run is done with POST /runs/:id/stop, which actually cancels work.
const CreateMessageSchema = z.object({
  kind: HumanMessageKindSchema.extract(["guidance"]).optional().default("guidance"),
  content: z.string().trim().min(1).max(4000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
});

export const messageRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const eventStore = new EventStore(db);
  const inbox = new InboxService(db, eventStore);

  // Send human message
  fastify.post<{ Params: { projectId: string }; Body: unknown }>(
    "/projects/:projectId/messages",
    async (request, reply) => {
      const parsed = CreateMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.format() });
      }

      const { kind, content, priority } = parsed.data;
      const message = inbox.sendMessage(request.params.projectId, kind, content, priority);
      return reply.status(201).send(message);
    }
  );

  // Get project messages
  fastify.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/messages",
    async (request) => {
      const messages = inbox.getMessages(request.params.projectId);
      return { messages };
    }
  );

  // Cancel pending message
  fastify.post<{ Params: { messageId: string } }>(
    "/messages/:messageId/cancel",
    async (request, reply) => {
      const success = inbox.cancelMessage(request.params.messageId);
      if (!success) {
        return reply.status(404).send({ error: "Message not found or cannot be canceled" });
      }
      return reply.status(200).send({ success: true });
    }
  );
};
