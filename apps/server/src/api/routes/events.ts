import { FastifyPluginAsync } from "fastify";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";
import { RunEvent } from "@orchestrator/shared-types";

export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  const eventStore = new EventStore(getDb());

  // Server-sent events. A fresh connection replays the latest `tail` events; a reconnect
  // (Last-Event-ID) or an explicit cursor replays everything after that sequence number.
  fastify.get<{ Params: { projectId: string }; Querystring: { cursor?: string; tail?: string } }>(
    "/projects/:projectId/events",
    async (request, reply) => {
      const { projectId } = request.params;
      const lastId = (request.headers["last-event-id"] as string) || request.query.cursor;
      const tail = Math.min(Math.max(parseInt(request.query.tail || "200", 10) || 200, 1), 2000);

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      if (request.headers.origin) reply.raw.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      reply.raw.flushHeaders();
      reply.hijack();

      const send = (ev: RunEvent) => reply.raw.write(`id: ${ev.eventSeq}\ndata: ${JSON.stringify(ev)}\n\n`);
      const replay = lastId !== undefined ? eventStore.getEventsSince(projectId, parseInt(lastId, 10) || 0) : eventStore.getRecentEvents(projectId, tail);
      replay.forEach(send);
      reply.raw.write(`event: replay-complete\ndata: {}\n\n`);

      const unsubscribe = eventStore.subscribe(projectId, send);
      const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );
};
