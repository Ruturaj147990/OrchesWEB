import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveModelPath, validateWorkspaceRoot, isInsideOrEqual } from "../src/workspace/path-safety.js";
import { tempDir, removeDir } from "./helpers.js";

describe("resolveModelPath (untrusted paths from model output)", () => {
  let root: string;
  beforeAll(() => {
    root = path.join(tempDir("paths"), "myproject");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
  });
  afterAll(() => removeDir(path.dirname(root)));

  it("accepts plain relative paths and normalizes separators", () => {
    const r = resolveModelPath(root, "src\\utils\\math.js");
    expect(r).toMatchObject({ ok: true, relPath: "src/utils/math.js" });
    if (r.ok) expect(r.absPath).toBe(path.join(root, "src", "utils", "math.js"));
  });

  it.runIf(process.platform === "win32")("relativizes an absolute Windows path inside the workspace instead of nesting a drive replica (regression: Issue B)", () => {
    const abs = path.join(root, "README.md");
    const r = resolveModelPath(root, abs);
    expect(r).toMatchObject({ ok: true, relPath: "README.md" });
    // The historical bug stripped ':' and produced <root>\c\Users\...\README.md
    if (r.ok) expect(r.absPath).toBe(abs);
    const lower = resolveModelPath(root, abs.charAt(0).toLowerCase() + abs.slice(1).replace(/\\/g, "/"));
    expect(lower).toMatchObject({ ok: true, relPath: "README.md" });
  });

  it("rejects absolute paths outside the workspace", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/hosts";
    const r = resolveModelPath(root, outside);
    if (process.platform === "win32") expect(r.ok).toBe(false);
    else expect(r).toMatchObject({ ok: true, relPath: "etc/hosts" }); // POSIX: project-rooted interpretation
  });

  it("treats leading-slash paths as project-rooted", () => {
    expect(resolveModelPath(root, "/src/index.js")).toMatchObject({ ok: true, relPath: "src/index.js" });
  });

  it("rejects parent traversal instead of silently stripping it", () => {
    for (const p of ["../outside.txt", "src/../../outside.txt", "..\\..\\x"]) {
      const r = resolveModelPath(root, p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/traversal/);
    }
  });

  it("blocks reserved and secret locations", () => {
    for (const p of [".git/config", "sub/.git/hooks/pre-commit", ".orchestrator/x.json", ".env", "config/.env.local", "server.pem", "keys/id.key"]) {
      expect(resolveModelPath(root, p).ok, p).toBe(false);
    }
    expect(resolveModelPath(root, ".env.example")).toMatchObject({ ok: true });
  });

  it("rejects Windows-invalid names", () => {
    for (const p of ["con.txt", "aux", "src/nul.js", "bad:name.js", "what?.js", "trailing.", "dir /file.js"]) {
      expect(resolveModelPath(root, p).ok, p).toBe(false);
    }
  });

  it("strips a repeated workspace folder name only when no such sub-folder exists", () => {
    expect(resolveModelPath(root, "myproject/src/a.js")).toMatchObject({ ok: true, relPath: "src/a.js" });
    fs.mkdirSync(path.join(root, "myproject"));
    expect(resolveModelPath(root, "myproject/src/a.js")).toMatchObject({ ok: true, relPath: "myproject/src/a.js" });
    fs.rmdirSync(path.join(root, "myproject"));
  });

  it("strips quotes/backticks the model wraps around paths and rejects empty paths", () => {
    expect(resolveModelPath(root, "`src/b.js`")).toMatchObject({ ok: true, relPath: "src/b.js" });
    expect(resolveModelPath(root, "  ").ok).toBe(false);
    expect(resolveModelPath(root, "./").ok).toBe(false);
    expect(resolveModelPath(root, 42).ok).toBe(false);
  });

  it("rejects writes that escape through a directory link", () => {
    const outside = tempDir("outside");
    try {
      fs.symlinkSync(outside, path.join(root, "linked"), "junction");
    } catch {
      removeDir(outside);
      return; // creating links not permitted on this machine
    }
    const r = resolveModelPath(root, "linked/evil.txt");
    expect(r.ok).toBe(false);
    fs.rmSync(path.join(root, "linked"), { recursive: false, force: true });
    removeDir(outside);
  });
});

describe("validateWorkspaceRoot", () => {
  it("refuses relative paths, drive roots, missing folders and the orchestrator's own folders", () => {
    const tmp = tempDir("ws");
    try {
      expect(validateWorkspaceRoot("relative/dir", []).ok).toBe(false);
      expect(validateWorkspaceRoot(path.parse(tmp).root, []).ok).toBe(false);
      expect(validateWorkspaceRoot(path.join(tmp, "missing"), []).ok).toBe(false);
      expect(validateWorkspaceRoot(path.join(tmp, "missing"), [], { allowCreate: true }).ok).toBe(true);
      expect(validateWorkspaceRoot(tmp, [tmp]).ok).toBe(false);
      expect(validateWorkspaceRoot(path.dirname(tmp), [tmp]).ok).toBe(false); // would contain the orchestrator
      expect(validateWorkspaceRoot(tmp, []).ok).toBe(true);
      if (process.env.USERPROFILE || process.env.HOME) {
        expect(validateWorkspaceRoot((process.env.USERPROFILE || process.env.HOME)!, []).ok).toBe(false);
      }
    } finally {
      removeDir(tmp);
    }
  });

  it("isInsideOrEqual is segment-aware", () => {
    expect(isInsideOrEqual(path.resolve("/a/b"), path.resolve("/a/b/c"))).toBe(true);
    expect(isInsideOrEqual(path.resolve("/a/b"), path.resolve("/a/bc"))).toBe(false);
  });

  it("identifies IDE and agent operational scratchpads as internal artifacts", async () => {
    const { isInternalAgentArtifact } = await import("../src/workspace/path-safety.js");
    expect(isInternalAgentArtifact("C:\\Users\\user\\.gemini\\antigravity-ide\\brain\\8ff040ea\\browser\\scratchpad_44fhg8ft.md")).toBe(true);
    expect(isInternalAgentArtifact("/Users/user/.gemini/antigravity-ide/scratch/notes.txt")).toBe(true);
    expect(isInternalAgentArtifact("C:\\Users\\user\\AppData\\Local\\Temp\\orches-scratch.tmp")).toBe(true);
    expect(isInternalAgentArtifact("C:\\Users\\user\\projects\\my-app\\src\\index.js")).toBe(false);
    expect(isInternalAgentArtifact("C:\\Windows\\System32\\cmd.exe")).toBe(false);
  });
});

