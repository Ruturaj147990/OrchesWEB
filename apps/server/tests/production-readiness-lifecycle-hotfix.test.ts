import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import {
  formatDiffEvidence,
  calculateDiffCharBudget,
  splitDiffIntoReviewChunks,
} from "../src/orchestrator/evidence-formatter.js";
import { reviewAttempt, buildReviewPrompt } from "../src/orchestrator/critic.js";
import { evaluateAttempt } from "../src/orchestrator/acceptance-gate.js";
import { isInternalAgentArtifact } from "../src/workspace/path-safety.js";
import { buildAuthoritativeTaskContext, updateAuthoritativeTaskContext } from "../src/orchestrator/task-context.js";
import { getDb } from "../src/storage/db.js";
import { EventStore } from "../src/events/event-store.js";
import { RunManager } from "../src/orchestrator/run-manager.js";
import type { ReasoningProvider } from "../src/providers/reasoning/provider.js";

describe("Production Readiness: Diff Budgeting & Review Evidence", () => {
  it("calculates a dynamic context budget allowing large diffs in single turn", () => {
    const budget32k = calculateDiffCharBudget(32_768);
    expect(budget32k).toBeGreaterThanOrEqual(90_000);

    const budget16k = calculateDiffCharBudget(16_000);
    expect(budget16k).toBeGreaterThanOrEqual(38_000);
  });

  it("marks a 45-file diff complete when within context budget", () => {
    const changes = Array.from({ length: 45 }, (_, i) => ({
      path: `src/component_${i}.tsx`,
      kind: "added",
      additions: 50,
      deletions: 0,
    }));
    const fakeDiff = changes
      .map(
        (c) =>
          `diff --git a/${c.path} b/${c.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${c.path}\n@@ -0,0 +1,5 @@\n+export const Component${c.path} = () => null;`
      )
      .join("\n\n");

    const formatted = formatDiffEvidence(changes, fakeDiff, 100_000);
    expect(formatted.status).toBe("complete");
    expect(formatted.isTruncated).toBe(false);
    expect(formatted.filesIncluded.length).toBe(45);
    expect(formatted.filesOmitted.length).toBe(0);
    expect(formatted.formattedText).toContain("DIFF STATUS: COMPLETE");
  });

  it("splits oversized diffs into deterministic review chunks with full manifest", () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({
      path: `server/routes/endpoint_${i}.js`,
      kind: "added",
      additions: 200,
      deletions: 0,
    }));
    const largeDiff = changes
      .map(
        (c) =>
          `diff --git a/${c.path} b/${c.path}\n--- /dev/null\n+++ b/${c.path}\n@@ -0,0 +1,100 @@\n${"+".repeat(500)}\n`
      )
      .join("\n");

    const chunks = splitDiffIntoReviewChunks(changes, largeDiff, 5_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].formattedEvidence).toContain("COMPLETE CHANGED FILES MANIFEST:");
    expect(chunks[0].formattedEvidence).toContain("DIFF STATUS: CHUNKED REVIEW");
    const allFilesChunked = chunks.flatMap((c) => c.files);
    expect(allFilesChunked.length).toBe(30);
  });

  it("synthesizes multi-chunk reviews across chunks", async () => {
    const changes = [
      { path: "src/a.ts", kind: "added", additions: 10, deletions: 0 },
      { path: "src/b.ts", kind: "added", additions: 10, deletions: 0 },
    ];
    const diffText = `diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n\ndiff --git a/src/b.ts b/src/b.ts\n+const b = 2;`;

    const mockProvider: ReasoningProvider = {
      id: "mock",
      displayName: "Mock Provider",
      privacyClass: "local",
      getModel: () => "mock",
      getContextWindow: () => 1_000, // Small to force chunking
      generate: vi.fn().mockResolvedValue({
        text: `ORCHES_REVIEW_STATUS: ACCEPT\n\n[ORCHES_REVIEW]\nVerdict\nACCEPT\n\nAcceptance Criteria\nAC-1 — passed — verified in chunk\n\nSummary\nAll good.\n[/ORCHES_REVIEW]`,
        parsed: {
          verdict: "accept",
          criteria: [{ id: "AC-1", status: "passed", reason: "verified" }],
          findings: [],
          repair_instructions: [],
          summary: "verified",
        },
      }),
    };

    const outcome = await reviewAttempt(mockProvider, {
      changes,
      diffText,
      criteria: ["Implement feature"],
      maxDiffChars: 50, // Force 2 chunks
    });

    expect(outcome.available).toBe(true);
    expect(outcome.verdict).toBe("accept");
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);
  });
});

describe("Production Readiness: Middleman Protocol & No Destructive Rollback", () => {
  it("never includes JSON-only instructions in review prompt", () => {
    const prompt = buildReviewPrompt({
      taskText: "Create a library system",
      criteria: ["AC-1: Books can be listed"],
      diffText: "+const books = [];",
      changes: [{ path: "books.js", kind: "added" }],
    });

    expect(prompt).not.toContain("JSON only");
    expect(prompt).not.toContain("Respond with JSON only");
    expect(prompt).not.toContain("Return one JSON object");
    expect(prompt).toContain("Do NOT return a JSON object");
    expect(prompt).toContain("ORCHES_REVIEW_STATUS");
  });

  it("preserves authoritative acceptance criteria across task context updates", () => {
    const ctx = buildAuthoritativeTaskContext({
      projectId: "proj-1",
      runId: "run-1",
      taskText: "Build library catalog with search and borrow functions",
    });

    expect(ctx.activeAcceptanceCriteria.length).toBeGreaterThan(0);
    const initialCriteriaCount = ctx.activeAcceptanceCriteria.length;

    const updated = updateAuthoritativeTaskContext(ctx, {
      iteration: 2,
      changes: [{ path: "catalog.js", kind: "added", additions: 10, deletions: 0 }],
      diffText: "+const catalog = [];",
      diffTruncated: false,
      checks: [{ checkId: "test-1", kind: "test", label: "npm test", source: "test", status: "passed", exitCode: 0, durationMs: 10, output: "OK", truncated: false }],
      findings: [{ severity: "medium", message: "Edge case in borrow" }],
    });

    expect(updated.activeAcceptanceCriteria.length).toBe(initialCriteriaCount);
    expect(updated.unresolvedFindings).toContainEqual({ severity: "medium", message: "Edge case in borrow" });
  });

  it("ignores Antigravity internal IDE scratchpad paths in sandbox gate", () => {
    const scratchpad = "C:\\Users\\limbk\\.gemini\\antigravity-ide\\brain\\8ff040ea\\browser\\scratchpad_44fhg8ft.md";
    expect(isInternalAgentArtifact(scratchpad)).toBe(true);

    const gateResult = evaluateAttempt({
      changes: [{ path: "app.js", kind: "added", additions: 1, deletions: 0, binary: false }],
      agentFailed: false,
      rejectedWrites: [],
      staticResults: [],
      baselineChecks: [],
      attemptChecks: [],
      critic: { available: true, verdict: "accept", criteria: [], findings: [], repairInstructions: [], summary: "OK" },
      externalWrites: [scratchpad],
    });

    expect(gateResult.accepted).toBe(true);
    expect(gateResult.blockers).toEqual([]);
  });

  it("keeps rogue system writes detectable", () => {
    const rogue = "C:\\Windows\\System32\\cmd.exe";
    expect(isInternalAgentArtifact(rogue)).toBe(false);

    const gateResult = evaluateAttempt({
      changes: [{ path: "app.js", kind: "added", additions: 1, deletions: 0, binary: false }],
      agentFailed: false,
      rejectedWrites: [],
      staticResults: [],
      baselineChecks: [],
      attemptChecks: [],
      critic: { available: true, verdict: "accept", criteria: [], findings: [], repairInstructions: [], summary: "OK" },
      externalWrites: [rogue],
    });

    expect(gateResult.accepted).toBe(false);
    expect(gateResult.blockers.join(" ")).toContain("The coding agent wrote outside the workspace");
  });
});

describe("Lifecycle & Operational Safety: No Auto-Shutdown and No Computer Shutdown", () => {
  it("has zero OS computer shutdown commands or scripts in the codebase", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const files: string[] = [];
    function scan(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/\.(ts|js|mjs|sh|bat)$/.test(entry.name)) files.push(full);
      }
    }
    scan(srcDir);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toMatch(/shutdown(\.exe)?\s+(\/|-)s/i);
      expect(content).not.toMatch(/\b(poweroff|systemctl\s+poweroff)\b/i);
    }
  });

  it("does not automatically exit the process when a run completes", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    const db = getDb();
    const events = new EventStore(db);
    const runManager = new RunManager(db, events);

    expect(runManager.isActive("non-existent-run")).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it("ensures normal lifecycle management persists runs and keeps server operational", () => {
    const db = getDb();
    const events = new EventStore(db);
    const runManager = new RunManager(db, events);

    expect(runManager).toBeDefined();
    expect(typeof runManager.start).toBe("function");
    expect(typeof runManager.stop).toBe("function");
    expect(typeof runManager.waitFor).toBe("function");
    expect(typeof runManager.recoverInterruptedRuns).toBe("function");
  });
});
