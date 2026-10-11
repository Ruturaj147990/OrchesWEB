import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { OpenAICompatibleLocalProvider, normalizeOllamaEndpoint } from "../src/providers/reasoning/openai-compatible/local-provider.js";
import { OpenAIProvider } from "../src/providers/reasoning/openai/openai-provider.js";
import { buildProvider } from "../src/providers/reasoning/registry.js";
import { SettingsManager } from "../src/platform/settings-manager.js";
import { runCommand, runShellCommand } from "../src/platform/process-runner.js";
import { tempDir, removeDir } from "./helpers.js";

type Handler = (req: http.IncomingMessage, body: any) => { status?: number; json?: unknown; text?: string; delayMs?: number };

function fakeServer(routes: Record<string, Handler>) {
  const seen: Array<{ url: string; body: any }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: req.url!, body });
      const handler = routes[`${req.method} ${req.url}`];
      if (!handler) {
        res.writeHead(404).end();
        return;
      }
      const out = handler(req, body);
      setTimeout(() => {
        res.writeHead(out.status ?? 200, { "content-type": out.text !== undefined ? "text/plain" : "application/json" });
        res.end(out.text ?? JSON.stringify(out.json));
      }, out.delayMs ?? 0);
    });
  });
  return {
    seen,
    start: () => new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("local provider", () => {
  const ollama = fakeServer({
    "GET /api/version": () => ({ json: { version: "0.32.9" } }),
    "GET /api/tags": () => ({ json: { models: [{ name: "llama3.1:8b" }] } }),
    "POST /api/chat": (_req, body) => ({ json: { message: { content: body.format === "json" ? '{"ok":true}' : "hello" }, prompt_eval_count: 12, eval_count: 3 } }),
  });
  let base: string;
  beforeAll(async () => {
    base = await ollama.start();
  });
  afterAll(() => ollama.stop());

  it("normalizes endpoint variants", () => {
    for (const u of ["127.0.0.1:11434", "http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/api/", "http://127.0.0.1:11434"]) {
      expect(normalizeOllamaEndpoint(u).nativeChatUrl).toBe("http://127.0.0.1:11434/api/chat");
    }
  });

  it("uses Ollama's native chat API with the configured context window and JSON mode", async () => {
    const p = new OpenAICompatibleLocalProvider({ baseUrl: `${base}/v1`, model: "llama3.1:8b", contextTokens: 8192 });
    const res = await p.generate({ operation: "task_planning", systemInstruction: "s", messages: [{ role: "user", content: "u" }], json: true, projectId: "p" });
    expect(res).toMatchObject({ text: '{"ok":true}', parsed: { ok: true }, modelId: "llama3.1:8b", usage: { inputTokens: 12, outputTokens: 3 } });
    const call = ollama.seen.find((s) => s.url === "/api/chat")!;
    expect(call.body).toMatchObject({ model: "llama3.1:8b", stream: false, format: "json", options: { num_ctx: 8192 } });
    expect(call.body.messages[0]).toEqual({ role: "system", content: "s" });
  });

  it("reports a missing model and an unreachable server honestly", async () => {
    const wrongModel = await new OpenAICompatibleLocalProvider({ baseUrl: base, model: "qwen:72b" }).healthCheck();
    expect(wrongModel).toMatchObject({ ok: false, status: "model_unavailable", installCommand: "ollama pull qwen:72b" });
    const down = await new OpenAICompatibleLocalProvider({ baseUrl: "http://127.0.0.1:9", model: "x" }).healthCheck();
    expect(down).toMatchObject({ ok: false, status: "server_unreachable" });
    await expect(new OpenAICompatibleLocalProvider({ baseUrl: "http://127.0.0.1:9", model: "x" }).generate({ operation: "task_planning", systemInstruction: "", messages: [], projectId: "p" })).rejects.toThrow(/failed/);
  });

  it("supports generic OpenAI-compatible servers and surfaces HTTP errors", async () => {
    const compat = fakeServer({
      "GET /v1/models": () => ({ json: { data: [{ id: "local-model" }] } }),
      "POST /v1/chat/completions": (_req, body) =>
        body.model === "boom" ? { status: 500, text: "model crashed" } : { json: { choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } },
    });
    const url = await compat.start();
    try {
      const ok = new OpenAICompatibleLocalProvider({ baseUrl: url, model: "local-model" });
      expect((await ok.generate({ operation: "task_planning", systemInstruction: "", messages: [], projectId: "p" })).text).toBe("hi");
      expect((await ok.healthCheck()).ok).toBe(true);
      const bad = new OpenAICompatibleLocalProvider({ baseUrl: url, model: "boom" });
      await expect(bad.generate({ operation: "task_planning", systemInstruction: "", messages: [], projectId: "p" })).rejects.toThrow(/HTTP 500: model crashed/);
    } finally {
      await compat.stop();
    }
  });

  it("times out instead of hanging", async () => {
    const slow = fakeServer({ "GET /api/version": () => ({ json: { version: "1" } }), "POST /api/chat": () => ({ json: {}, delayMs: 3000 }) });
    const url = await slow.start();
    try {
      const p = new OpenAICompatibleLocalProvider({ baseUrl: url, model: "m" });
      await expect(p.generate({ operation: "task_planning", systemInstruction: "", messages: [], projectId: "p", timeoutMs: 300 })).rejects.toThrow(/did not answer within/);
    } finally {
      await slow.stop();
    }
  });
});

describe("OpenAI provider", () => {
  it("sends requests through the official SDK and reports usage (against a local stand-in endpoint)", async () => {
    const api = fakeServer({
      "POST /v1/chat/completions": (req, body) => ({
        json: {
          id: "x",
          object: "chat.completion",
          created: 1,
          model: body.model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: req.headers.authorization === "Bearer sk-test-1234567890abcdef" ? "authorized" : "no-auth" } }],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        },
      }),
      "GET /v1/models": () => ({ json: { object: "list", data: [{ id: "gpt-4o-mini", object: "model" }] } }),
    });
    const url = await api.start();
    try {
      const p = new OpenAIProvider({ apiKey: "sk-test-1234567890abcdef", model: "gpt-4o-mini", baseURL: `${url}/v1` });
      const res = await p.generate({ operation: "result_review", systemInstruction: "s", messages: [{ role: "user", content: "u" }], json: true, projectId: "p" });
      expect(res).toMatchObject({ text: "authorized", providerId: "openai", modelId: "gpt-4o-mini", usage: { inputTokens: 7, outputTokens: 2 } });
      expect(api.seen.find((s) => s.url === "/v1/chat/completions")!.body).toMatchObject({ model: "gpt-4o-mini", response_format: { type: "json_object" } });
      expect(await p.healthCheck()).toMatchObject({ ok: true, status: "ready" });
    } finally {
      await api.stop();
    }
  });

  it("is unavailable without a key", async () => {
    const p = new OpenAIProvider({});
    expect((await p.healthCheck()).ok).toBe(false);
    await expect(p.generate({ operation: "task_planning", systemInstruction: "", messages: [], projectId: "p" })).rejects.toThrow(/not configured/);
  });

  it("provider selection in settings decides which provider runs", () => {
    const dir = tempDir("settings");
    SettingsManager.setDataDir(dir);
    try {
      expect(buildProvider(SettingsManager.loadSettings().activeProviderId).id).toBe("openai-compatible-local");
      SettingsManager.saveSettings({ activeProviderId: "openai", openaiApiKey: "sk-test-abcdefghijklmnopqrstuvwxyz", openaiModel: "gpt-4.1-mini" });
      const s = SettingsManager.loadSettings();
      const p = buildProvider(s.activeProviderId, s);
      expect(p.id).toBe("openai");
      expect(p.getModel()).toBe("gpt-4.1-mini");
      expect(SettingsManager.maskApiKey(s.openaiApiKey)).not.toContain("abcdefghijklmnop");
    } finally {
      SettingsManager.reset();
      removeDir(dir);
    }
  });
});

describe("process runner", () => {
  it("runs commands in folders with spaces and captures exit codes", async () => {
    const dir = path.join(tempDir("proc"), "folder with spaces");
    fs.mkdirSync(dir);
    try {
      const res = await runCommand([process.execPath, "-e", "console.log(process.cwd()); process.exit(3)"], { cwd: dir, timeoutMs: 20_000 });
      expect(res.exitCode).toBe(3);
      expect(res.stdout.trim()).toBe(dir);
      const npm = await runCommand(["npm", "--version"], { cwd: dir, timeoutMs: 60_000 });
      expect(npm.exitCode).toBe(0);
    } finally {
      removeDir(path.dirname(dir));
    }
  }, 60_000);

  it("kills the whole process tree on timeout and on abort", async () => {
    const childScript = "setInterval(() => {}, 1000)";
    const parentScript = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
    const timed = await runCommand([process.execPath, "-e", parentScript], { cwd: process.cwd(), timeoutMs: 800 });
    expect(timed.timedOut).toBe(true);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const aborted = await runCommand([process.execPath, "-e", parentScript], { cwd: process.cwd(), timeoutMs: 20_000, signal: controller.signal });
    expect(aborted.cancelled).toBe(true);
    expect(aborted.durationMs).toBeLessThan(10_000);
  }, 30_000);

  it("reports spawn failures instead of throwing", async () => {
    const res = await runCommand(["definitely-not-a-real-binary-xyz"], { cwd: process.cwd(), timeoutMs: 5000 });
    expect(res.exitCode).not.toBe(0);
  });

  it("runs user-configured shell command lines", async () => {
    const res = await runShellCommand(`"${process.execPath}" -e "console.log(41+1)"`, { cwd: process.cwd(), timeoutMs: 20_000 });
    expect(res.stdout.trim()).toBe("42");
  });
});

describe("verification environment", () => {
  it("does not pass the orchestrator's API keys to project checks", async () => {
    const { runCheck } = await import("../src/verification/runner.js");
    process.env.OPENAI_API_KEY = "sk-should-not-leak-0123456789";
    try {
      const res = await runCheck(process.cwd(), {
        id: "env",
        kind: "test",
        label: "print env",
        argv: [process.execPath, "-e", "console.log(process.env.OPENAI_API_KEY ? 'LEAKED' : 'clean')"],
        source: "test",
        timeoutMs: 20_000,
      });
      expect(res.output.trim()).toBe("clean");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
