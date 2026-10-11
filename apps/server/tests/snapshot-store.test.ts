import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SnapshotStore } from "../src/workspace/snapshot-store.js";
import { unifiedDiff } from "../src/workspace/text-diff.js";
import { tempDir, removeDir, initGitRepo, git } from "./helpers.js";

describe("SnapshotStore", () => {
  let ws: string;
  let storeDir: string;
  beforeEach(() => {
    ws = tempDir("snap-ws");
    storeDir = tempDir("snap-store");
  });
  afterEach(() => {
    removeDir(ws);
    removeDir(storeDir);
  });

  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), content);
  };

  it("keeps snapshots outside the workspace", () => {
    write("a.txt", "a\n");
    new SnapshotStore(ws, storeDir).take("t");
    expect(fs.readdirSync(ws)).toEqual(["a.txt"]);
  });

  it("detects added, modified and deleted files exactly", () => {
    write("keep.txt", "same\n");
    write("edit.txt", "one\ntwo\nthree\n");
    write("gone.txt", "bye\n");
    const store = new SnapshotStore(ws, storeDir);
    const snap = store.take("before");
    write("edit.txt", "one\nTWO\nthree\n");
    fs.rmSync(path.join(ws, "gone.txt"));
    write("new/dir/added.txt", "hi\n");
    const diff = store.diff(snap);
    const kinds = Object.fromEntries(diff.changes.map((c) => [c.path, c.kind]));
    expect(kinds).toEqual({ "edit.txt": "modified", "gone.txt": "deleted", "new/dir/added.txt": "added" });
    expect(diff.diffText).toContain("-two");
    expect(diff.diffText).toContain("+TWO");
    expect(diff.diffText).toContain(" one");
  });

  it("restores modified and deleted files, removes added files and their new folders, and keeps backups", () => {
    write("edit.txt", "original\n");
    write("gone.txt", "precious user data\n");
    write("existing/keep.txt", "k\n");
    const store = new SnapshotStore(ws, storeDir);
    const snap = store.take("before");
    write("edit.txt", "agent edit\n");
    fs.rmSync(path.join(ws, "gone.txt"));
    write("new/deep/file.js", "x\n");
    write("existing/added.txt", "y\n");

    const changed = store.diff(snap).changes.map((c) => c.path);
    const res = store.restore(snap, changed, "test");
    expect(res.failed).toEqual([]);
    expect(fs.readFileSync(path.join(ws, "edit.txt"), "utf8")).toBe("original\n");
    expect(fs.readFileSync(path.join(ws, "gone.txt"), "utf8")).toBe("precious user data\n");
    expect(fs.existsSync(path.join(ws, "new"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "existing", "keep.txt"))).toBe(true);
    expect(fs.existsSync(path.join(ws, "existing", "added.txt"))).toBe(false);
    expect(store.diff(snap).changes).toEqual([]);
    // The discarded agent edit is preserved in the backup folder, never silently destroyed.
    expect(res.backupDir).toBeTruthy();
    expect(fs.readFileSync(path.join(res.backupDir!, "edit.txt"), "utf8")).toBe("agent edit\n");
  });

  it("only touches the listed paths (unrelated concurrent edits survive)", () => {
    write("agent.txt", "a\n");
    write("user.txt", "u\n");
    const store = new SnapshotStore(ws, storeDir);
    const snap = store.take("before");
    write("agent.txt", "changed by agent\n");
    write("user.txt", "changed by user\n");
    store.restore(snap, ["agent.txt"], "scoped");
    expect(fs.readFileSync(path.join(ws, "agent.txt"), "utf8")).toBe("a\n");
    expect(fs.readFileSync(path.join(ws, "user.txt"), "utf8")).toBe("changed by user\n");
  });

  it("in Git repositories honours .gitignore and ignores build output", () => {
    initGitRepo(ws);
    write(".gitignore", "build-output/\n*.log\n");
    write("src/app.js", "1\n");
    git(ws, "add", "-A");
    git(ws, "commit", "-q", "-m", "init");
    const store = new SnapshotStore(ws, storeDir);
    const snap = store.take("before");
    expect(snap.mode).toBe("git");
    write("build-output/bundle.js", "big\n");
    write("debug.log", "noise\n");
    write("src/app.js", "2\n");
    write("src/untracked.js", "new\n");
    const changed = store.diff(snap).changes.map((c) => c.path).sort();
    expect(changed).toEqual(["src/app.js", "src/untracked.js"]);
  });

  it("treats binary files as binary in diffs", () => {
    fs.writeFileSync(path.join(ws, "img.bin"), Buffer.from([0, 1, 2, 3]));
    const store = new SnapshotStore(ws, storeDir);
    const snap = store.take("b");
    fs.writeFileSync(path.join(ws, "img.bin"), Buffer.from([0, 9, 9, 9]));
    const d = store.diff(snap);
    expect(d.changes[0]).toMatchObject({ path: "img.bin", kind: "modified", binary: true });
    store.restore(snap, ["img.bin"], "bin");
    expect([...fs.readFileSync(path.join(ws, "img.bin"))]).toEqual([0, 1, 2, 3]);
  });

  it("prune keeps referenced blobs", () => {
    write("a.txt", "v1\n");
    const store = new SnapshotStore(ws, storeDir);
    const s1 = store.take("1");
    write("a.txt", "v2\n");
    store.take("2");
    store.prune(1);
    expect(store.get(s1.id)).toBeNull();
    expect(store.list()).toHaveLength(1);
  });
});

describe("unifiedDiff", () => {
  it("produces minimal hunks for an insertion", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const after = before.replace("line 10\n", "line 10\ninserted\n");
    const d = unifiedDiff("f.txt", before, after);
    expect(d.stats).toEqual({ additions: 1, deletions: 0 });
    expect(d.text).toContain("+inserted");
    expect(d.text.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(0);
  });

  it("handles new and deleted files", () => {
    expect(unifiedDiff("n.txt", null, "a\nb\n").stats).toEqual({ additions: 2, deletions: 0 });
    expect(unifiedDiff("d.txt", "a\n", null).stats).toEqual({ additions: 0, deletions: 1 });
  });
});
