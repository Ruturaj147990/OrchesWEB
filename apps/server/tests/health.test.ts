import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("Server Health & Loopback API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health returns ok status and loopbackOnly flag", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("ok");
    expect(body.loopbackOnly).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.nodeVersion).toBe("string");
  });

  it("Rejects unauthorized cross-origin requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        origin: "http://malicious-external-site.com",
      },
    });

    // CORS preflight/origin check blocks untrusted foreign origin
    expect(res.statusCode).toBe(500); // Fastify CORS plugin throws error when origin callback returns error
  });
});
