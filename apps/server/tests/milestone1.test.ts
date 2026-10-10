import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { closeDb, initDb } from "../src/storage/db.js";

describe("Milestone 1 — Persistence and Control Integration Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Use an in-memory database instance for isolated test execution
    closeDb();
    app = await buildApp(":memory:");
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it("creates and retrieves a project with persistence", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "Test Autonomous App",
        objective: "Demonstrate persistence and state machine",
        autonomyMode: "creative_within_constraints",
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload);
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Test Autonomous App");
    expect(created.status).toBe("ready");

    // Fetch by ID
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${created.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = JSON.parse(getRes.payload);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(created.name);

    // List projects
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list.some((p: { id: string }) => p.id === created.id)).toBe(true);
  });

  it("handles run lifecycle with idempotency and state machine validation", async () => {
    // 1. Create project
    const pRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "Lifecycle Project" },
    });
    const project = JSON.parse(pRes.payload);

    // 2. Start run
    const startRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
    });
    expect(startRes.statusCode).toBe(201);
    const run = JSON.parse(startRes.payload);
    expect(run.status).toBe("running");

    // 3. Idempotent start: starting again returns the same active run
    const startAgainRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
    });
    expect(startAgainRes.statusCode).toBe(200);
    const duplicateRun = JSON.parse(startAgainRes.payload);
    expect(duplicateRun.id).toBe(run.id);

    // 4. Pause run
    const pauseRes = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/pause`,
    });
    expect(pauseRes.statusCode).toBe(200);
    const pausedRun = JSON.parse(pauseRes.payload);
    expect(pausedRun.status).toBe("paused");

    // 5. Resume run
    const resumeRes = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/resume`,
    });
    expect(resumeRes.statusCode).toBe(200);
    const resumedRun = JSON.parse(resumeRes.payload);
    expect(resumedRun.status).toBe("running");

    // 6. Stop run
    const stopRes = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/stop`,
    });
    expect(stopRes.statusCode).toBe(200);
    const stoppedRun = JSON.parse(stopRes.payload);
    expect(stoppedRun.status).toBe("stopped");

    // 7. Invalid transition: attempting to pause a stopped run must be rejected
    const invalidPauseRes = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/pause`,
    });
    expect(invalidPauseRes.statusCode).toBe(400);
    const errorBody = JSON.parse(invalidPauseRes.payload);
    expect(errorBody.error).toContain("Invalid run state transition");
  });

  it("verifies event logging and cursor-based replay", async () => {
    // 1. Create project
    const pRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "Event Stream Project" },
    });
    const project = JSON.parse(pRes.payload);

    // 2. Start and Stop run to generate sequenced events
    const startRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
    });
    const run = JSON.parse(startRes.payload);

    await app.inject({
      method: "POST",
      url: `/api/v1/runs/${run.id}/stop`,
    });

    // 3. Query the EventStore via DB directly to check replay
    const { EventStore } = await import("../src/events/event-store.js");
    const { getDb } = await import("../src/storage/db.js");
    const eventStore = new EventStore(getDb());

    const allEvents = eventStore.getEventsSince(project.id, 0);
    expect(allEvents.length).toBeGreaterThanOrEqual(3); // project.created, run.started, run.stopped
    expect(allEvents[0].type).toBe("project.created");
    expect(allEvents[0].eventSeq).toBe(1);

    // Test cursor replay: querying with cursor = 1 should skip event #1
    const replayed = eventStore.getEventsSince(project.id, 1);
    expect(replayed.length).toBe(allEvents.length - 1);
    expect(replayed[0].eventSeq).toBe(2);
  });
});
