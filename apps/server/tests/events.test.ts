import { describe, it, expect, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { EventStore } from "../src/events/event-store.js";
import { getDb } from "../src/storage/db.js";
import { BuiltinCoderAdapter } from "../src/providers/coding-agents/builtin/builtin-coder.js";
import { ScriptedProvider, makeApp, createProject, tempDir, removeDir, fileBlocks } from "./helpers.js";

describe("live events", () => {
  const cleanup: string[] = [];
  afterAll(() => cleanup.forEach(removeDir));

  it("delivers events recorded by any EventStore instance to subscribers of another (regression)", async () => {
    const { app, dataDir } = await makeApp({ provider: new ScriptedProvider() });
    cleanup.push(dataDir);
    const ws = tempDir("events");
    cleanup.push(ws);
    const project = await createProject(app, ws);
    const received: string[] = [];
    const unsubscribe = new EventStore(getDb()).subscribe(project.id, (ev) => received.push(ev.type));
    new EventStore(getDb()).record(project.id, "run.log", { message: "hello" });
    unsubscribe();
    expect(received).toEqual(["run.log"]);
    await app.close();
  });

  it("streams a run's events over SSE and redacts secrets from them", async () => {
    const provider = new ScriptedProvider().enqueue("code_generation", () => fileBlocks({ "a.txt": "a\n" }));
    const { app, dataDir } = await makeApp({ provider, agent: (p) => new BuiltinCoderAdapter(p) });
    cleanup.push(dataDir);
    const ws = tempDir("sse");
    cleanup.push(ws);
    const project = await createProject(app, ws);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/projects/${project.id}/events?tail=5`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const types: string[] = [];
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (const m of buffer.matchAll(/^data: (\{.*\})$/gm)) {
          try {
            const ev = JSON.parse(m[1]);
            if (ev.type) types.push(`${ev.type}${ev.type === "run.log" && String(ev.payload.message).includes("[REDACTED") ? ":redacted" : ""}`);
          } catch {}
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
        if (types.includes("run.finished")) return;
      }
    })().catch(() => {});

    const run = (await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/runs`, payload: { task: "write a.txt" } })).json();
    new EventStore(getDb()).record(project.id, "run.log", { message: "token OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456" }, run.id);
    await app.runManager.waitFor(run.id);
    await Promise.race([pump, new Promise((r) => setTimeout(r, 5000))]);
    controller.abort();
    expect(types).toContain("run.started");
    expect(types).toContain("attempt.evaluated");
    expect(types).toContain("run.finished");
    expect(types).toContain("run.log:redacted");
    await app.close();
  });
});
