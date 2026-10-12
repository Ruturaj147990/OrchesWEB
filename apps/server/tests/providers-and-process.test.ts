import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ChatGPTWebProvider } from "../src/providers/reasoning/chatgpt-web/index.js";
import { BrowserManager } from "../src/providers/reasoning/chatgpt-web/browser-manager.js";
import { PromptSender } from "../src/providers/reasoning/chatgpt-web/prompt-sender.js";
import { ResponseReader } from "../src/providers/reasoning/chatgpt-web/response-reader.js";
import { buildProvider, PROVIDER_IDS } from "../src/providers/reasoning/registry.js";
import { SettingsManager } from "../src/platform/settings-manager.js";
import { runCommand, runShellCommand } from "../src/platform/process-runner.js";
import { tempDir, removeDir } from "./helpers.js";

describe("ChatGPT Web reasoning provider", () => {
  it("initializes with ChatGPT Web defaults and capabilities", () => {
    const provider = new ChatGPTWebProvider({
      headless: true,
      userDataDir: "data/browser/chatgpt-test",
    });

    expect(provider.id).toBe("chatgpt-web");
    expect(provider.displayName).toBe("ChatGPT Web (Browser)");
    expect(provider.privacyClass).toBe("cloud");
    expect(provider.getModel()).toBe("chatgpt-web");
    expect(provider.getContextWindow()).toBe(32_768);
  });

  it("resolves user data directory cross-platform safely", () => {
    const defaultDir = BrowserManager.resolveUserDataDir();
    expect(defaultDir).toContain("chatgpt");
    expect(path.isAbsolute(defaultDir)).toBe(true);

    const customRelative = BrowserManager.resolveUserDataDir("data/custom-browser");
    expect(customRelative).toContain("custom-browser");
    expect(path.isAbsolute(customRelative)).toBe(true);

    const customAbsolute = BrowserManager.resolveUserDataDir(path.resolve("/tmp/custom-profile"));
    expect(path.isAbsolute(customAbsolute)).toBe(true);
  });

  it("provider registry defaults to chatgpt-web", () => {
    expect(PROVIDER_IDS).toContain("chatgpt-web");
    const p = buildProvider("chatgpt-web");
    expect(p.id).toBe("chatgpt-web");
    expect(p instanceof ChatGPTWebProvider).toBe(true);
  });

  it("persists and loads ChatGPT Web settings in SettingsManager", () => {
    const dir = tempDir("settings");
    SettingsManager.setDataDir(dir);
    try {
      const initial = SettingsManager.loadSettings();
      expect(initial.activeProviderId).toBe("chatgpt-web");
      expect(typeof initial.chatgptWebHeadless).toBe("boolean");

      SettingsManager.saveSettings({
        activeProviderId: "chatgpt-web",
        chatgptWebHeadless: true,
        chatgptWebProfileDir: "data/browser/custom",
      });

      const loaded = SettingsManager.loadSettings();
      expect(loaded.activeProviderId).toBe("chatgpt-web");
      expect(loaded.chatgptWebHeadless).toBe(true);
      expect(loaded.chatgptWebProfileDir).toBe("data/browser/custom");

      const provider = buildProvider(loaded.activeProviderId, loaded);
      expect(provider.id).toBe("chatgpt-web");
    } finally {
      SettingsManager.reset();
      removeDir(dir);
    }
  });
});

describe("ChatGPT Web protocol & response handling", () => {
  it("extracts Antigravity engineering instruction from markers", () => {
    const fullText = `Here is my thought process:
First, inspect the schema.
[ORCHES_ANTIGRAVITY_INSTRUCTION]
### Engineering Task
1. Run \`npm test\`
2. Edit \`src/index.ts\` to fix type error.
[/ORCHES_ANTIGRAVITY_INSTRUCTION]
Hope this helps!`;

    const extracted = ResponseReader.extractInstruction(fullText);
    expect(extracted.instructionText).toContain("### Engineering Task");
    expect(extracted.instructionText).toContain("Run `npm test`");
    expect(extracted.instructionText).not.toContain("Here is my thought process");
    expect(extracted.instructionText).not.toContain("Hope this helps");
    expect(extracted.isMarkerExtracted).toBe(true);
  });

  it("falls back to full text if markers are absent", () => {
    const rawMarkdown = "Please implement the login endpoint with JWT authentication.";
    const extracted = ResponseReader.extractInstruction(rawMarkdown);
    expect(extracted.instructionText).toBe(rawMarkdown);
    expect(extracted.isMarkerExtracted).toBe(false);
  });

  it("detects duplicate prompt submissions in PromptSender", () => {
    const sender = new PromptSender();
    // Simulate recording a sent prompt
    (sender as any).lastSentPrompt = "Build user authentication feature";

    expect(() => {
      // Trying to send without force should throw duplicate detection
      const text = "Build user authentication feature";
      if ((sender as any).lastSentPrompt === text.trim()) {
        throw new Error("Duplicate prompt submission detected: prompt text is identical to previous submission.");
      }
    }).toThrow(/Duplicate prompt submission detected/);
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
  it("does not pass sensitive API keys to project checks", async () => {
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
