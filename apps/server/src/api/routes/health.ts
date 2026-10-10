import { FastifyPluginAsync } from "fastify";
import { config } from "../../config/env.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_request, _reply) => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      loopbackOnly: config.host === "127.0.0.1",
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      dataDir: config.dataDir,
    };
  });
};
