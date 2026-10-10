import { FastifyPluginAsync } from "fastify";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const eventStore = new EventStore(db);

  fastify.get<{
    Params: { projectId: string };
    Querystring: { cursor?: string };
  }>("/projects/:projectId/events", async (request, reply) => {
    const { projectId } = request.params;
    const rawCursor = (request.headers["last-event-id"] as string) || request.query.cursor || "0";
    const cursor = parseInt(rawCursor, 10) || 0;

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*");
    reply.raw.flushHeaders();

    // 1. Replay missed events from cursor
    const missed = eventStore.getEventsSince(projectId, cursor);
    for (const ev of missed) {
      reply.raw.write(`id: ${ev.eventSeq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }

    // 2. Subscribe to new real-time events
    const unsubscribe = eventStore.subscribe(projectId, (ev) => {
      reply.raw.write(`id: ${ev.eventSeq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    });

    // 3. Heartbeat ping
    const interval = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(interval);
      unsubscribe();
    });

    // Keep connection open indefinitely for SSE
    await new Promise<void>((resolve) => {
      request.raw.on("close", resolve);
    });
  });
};
