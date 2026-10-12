import { describe, it, expect } from "vitest";
import {
  buildAuthoritativeTaskContext,
  updateAuthoritativeTaskContext,
  AuthoritativeTaskContext,
} from "../src/orchestrator/task-context.js";
import { buildInstructionPrompt } from "../src/orchestrator/instructor.js";
import { buildReviewPrompt } from "../src/orchestrator/critic.js";
import { formatDiffEvidence, formatChecksEvidence } from "../src/orchestrator/evidence-formatter.js";
import { parseReviewProtocol } from "../src/prompts/review-validator.js";
import { ResponseReader } from "../src/providers/reasoning/chatgpt-web/response-reader.js";
import { ChatGPTWebProvider } from "../src/providers/reasoning/chatgpt-web/chatgpt-web-provider.js";
import { buildRequirementInventory, RequirementInventory } from "../src/domain/requirements/requirement-inventory.js";

describe("Prompt Pipeline Production Hardening & Regression Suite (17 Mandatory Quality Gates)", () => {
  const dummyProfile = {
    fileCount: 3,
    isEmpty: false,
    languages: ["TypeScript"],
    checks: [],
    testFrameworks: [],
    packageManagers: ["npm"],
    manifests: ["package.json"],
    notes: [],
  };

  function createTestInventory(): RequirementInventory {
    const inv = buildRequirementInventory({
      taskText: "Implement secure user authentication and rate limiting",
      candidateRequirements: [
        {
          id: "REQ-01",
          title: "Implement secure authentication middleware",
          description: "Verify JWT signatures with RS256 algorithm and check token expiry",
          provenanceKind: "explicit",
          sourceReference: "Blueprint",
        },
        {
          id: "REQ-02",
          title: "Add rate limiting on login endpoint",
          description: "Max 5 requests per minute per IP address",
          provenanceKind: "explicit",
          sourceReference: "Blueprint",
        },
      ],
    });

    // Mark explicit scope exclusions
    inv.requirements.push({
      id: "REQ-03",
      title: "Direct RF emitter manipulation",
      description: "Hardware transmitter signal tuning",
      classification: "mandatory_requirement",
      importance: "high",
      sourceReference: "Blueprint",
      status: "not_started",
      scopeStatus: "safety_conflict",
      scopeConflictReason: "Safety boundary violation: no physical RF transmitter control",
    });

    inv.requirements.push({
      id: "REQ-04",
      title: "Legacy XML export format",
      description: "Support legacy SOAP format",
      classification: "mandatory_requirement",
      importance: "low",
      sourceReference: "Blueprint",
      status: "not_started",
      scopeStatus: "deferred",
      scopeConflictReason: "Deferred to subsequent phase",
    });

    return inv;
  }

  // 1. The initial prompt uses the implementation-brief protocol
  it("Gate 1: Initial prompt (Iteration 1) instructs model using implementation-brief protocol", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement secure user authentication and rate limiting",
      inventory,
    });

    const prompt = buildInstructionPrompt(
      {
        projectId: "proj-alpha",
        runId: "run-001",
        iteration: 1,
        taskText: "Implement secure user authentication and rate limiting",
        workspacePath: "/mock/workspace",
        profile: dummyProfile,
        files: ["src/auth.ts", "package.json"],
        history: [],
        taskContext,
      },
      inventory,
      { filesRepresentation: "src/auth.ts, package.json", historyRepresentation: [] }
    );

    // Initial brief instructions must enforce the INSTRUCT protocol
    expect(prompt).toContain("ORCHES_STATUS: INSTRUCT");
    expect(prompt).toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(prompt).toContain("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(prompt).toContain("ORCHES_STATUS: STOP");
  });

  // 2. Iteration 2 uses the natural-language review protocol
  it("Gate 2: Iteration 2 prompt uses natural-language review protocol (ORCHES_REVIEW_STATUS)", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement secure user authentication and rate limiting",
      inventory,
    });

    const diffEvidence = formatDiffEvidence(
      [{ path: "src/auth.ts", kind: "modified" }],
      "diff --git a/src/auth.ts b/src/auth.ts\n+export function verifyToken() {}"
    ).formattedText;
    const checksEvidence = formatChecksEvidence([]);

    const reviewPrompt = buildReviewPrompt({
      taskContext,
      iteration: 2,
      diffEvidence,
      checksEvidence,
      agentReply: "Implemented verifyToken with RSA checks.",
    });

    expect(reviewPrompt).toContain("ORCHES_REVIEW_STATUS: REPAIR");
    expect(reviewPrompt).toContain("ORCHES_REVIEW_STATUS: ACCEPT");
    expect(reviewPrompt).toContain("ORCHES_REVIEW_STATUS: BLOCKED");
    expect(reviewPrompt).toContain("[ORCHES_REVIEW]");
    expect(reviewPrompt).toContain("[/ORCHES_REVIEW]");
    expect(reviewPrompt).toContain("## Verdict");
    expect(reviewPrompt).toContain("## Acceptance Criteria");
    expect(reviewPrompt).toContain("## Findings");
    expect(reviewPrompt).toContain("## Repair Instructions");
    expect(reviewPrompt).toContain("## Summary");
  });

  // 3. Iteration 3 retains the correct task, approved scope, and active acceptance criteria
  it("Gate 3: Iteration 3 retains the correct task, approved scope, and active acceptance criteria", () => {
    const inventory = createTestInventory();
    let taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement secure user authentication and rate limiting",
      inventory,
    });

    // Update with Iteration 2 findings
    taskContext = updateAuthoritativeTaskContext(taskContext, {
      iteration: 2,
      changes: [{ path: "src/auth.ts", kind: "modified", additions: 10, deletions: 0 }],
      diffText: "diff --git a/src/auth.ts b/src/auth.ts\n+export function verifyToken() {}",
      diffTruncated: false,
      checks: [],
      findings: [
        {
          severity: "high",
          message: "Missing expiry check in JWT validation",
        },
      ],
    });

    expect(taskContext.iteration).toBe(2);
    expect(taskContext.activeAcceptanceCriteria.length).toBeGreaterThanOrEqual(1);
    expect(taskContext.unresolvedFindings).toHaveLength(1);

    // Iteration 3 review prompt assembly
    const diffEvidence = formatDiffEvidence(
      [{ path: "src/auth.ts", kind: "modified" }],
      "diff --git a/src/auth.ts b/src/auth.ts\n+if (token.exp < now) throw new Error();"
    ).formattedText;
    const checksEvidence = formatChecksEvidence([
      { label: "npm test", status: "passed", exitCode: 0, output: "ok" },
    ]);

    const iter3Prompt = buildReviewPrompt({
      taskContext,
      iteration: 3,
      diffEvidence,
      checksEvidence,
      agentReply: "Added expiry validation.",
    });

    expect(iter3Prompt).toContain("ITERATION 3");
    expect(iter3Prompt).toContain("Missing expiry check in JWT validation");
    expect(iter3Prompt).toContain("npm test");
  });

  // 4. No ChatGPT Web prompt contains an instruction to return JSON-only output
  it("Gate 4: No ChatGPT Web prompt contains an instruction to return JSON-only output", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement secure user authentication",
      inventory,
    });

    const initPrompt = buildInstructionPrompt(
      {
        projectId: "proj-alpha",
        runId: "run-001",
        iteration: 1,
        taskText: "Implement secure user authentication",
        workspacePath: "/mock/workspace",
        profile: dummyProfile,
        files: ["src/auth.ts"],
        history: [],
        taskContext,
      },
      inventory,
      { filesRepresentation: "src/auth.ts", historyRepresentation: [] }
    );

    const reviewPrompt = buildReviewPrompt({
      taskContext,
      iteration: 2,
      diffEvidence: formatDiffEvidence([], "").formattedText,
      checksEvidence: formatChecksEvidence([]),
    });

    const forbiddenPhrases = [
      "reply with one json object",
      "output json only",
      "respond using a json schema",
      "wrap your answer in a json",
      "respond with json:",
      "single json object and nothing else",
    ];

    for (const phrase of forbiddenPhrases) {
      expect(initPrompt.toLowerCase()).not.toContain(phrase);
      expect(reviewPrompt.toLowerCase()).not.toContain(phrase);
    }
  });

  // 5. No retry or fallback path reintroduces that instruction
  it("Gate 5: ChatGPTWebProvider assemblePrompt never injects JSON-only instructions across operations", () => {
    const provider = new ChatGPTWebProvider({ headless: true });

    const instructionReq = {
      operation: "code_generation" as const,
      systemInstruction: "You are an expert orchestrator.",
      messages: [{ role: "user" as const, content: "Initial prompt text" }],
    };
    const reviewReq = {
      operation: "result_review" as const,
      systemInstruction: "You are an expert reviewer.",
      messages: [{ role: "user" as const, content: "Review prompt text" }],
    };

    const assembledInstruction = (provider as any).assemblePrompt(instructionReq);
    const assembledReview = (provider as any).assemblePrompt(reviewReq);

    const forbiddenPhrases = [
      "output json only",
      "respond with json",
      "single json object and nothing else",
      "reply with one json object",
    ];

    for (const phrase of forbiddenPhrases) {
      expect(assembledInstruction.toLowerCase()).not.toContain(phrase);
      expect(assembledReview.toLowerCase()).not.toContain(phrase);
    }
  });

  // 6. The two prompt modes cannot accidentally inherit contradictory response contracts
  it("Gate 6: Two prompt modes maintain strict separation of response contracts", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement authentication",
      inventory,
    });

    const initPrompt = buildInstructionPrompt(
      {
        projectId: "proj-alpha",
        runId: "run-001",
        iteration: 1,
        taskText: "Implement authentication",
        workspacePath: "/mock/workspace",
        profile: dummyProfile,
        files: [],
        history: [],
        taskContext,
      },
      inventory,
      { filesRepresentation: "", historyRepresentation: [] }
    );

    const reviewPrompt = buildReviewPrompt({
      taskContext,
      iteration: 2,
      diffEvidence: formatDiffEvidence([], "").formattedText,
      checksEvidence: formatChecksEvidence([]),
    });

    // Initial prompt must NOT contain Review protocol markers
    expect(initPrompt).not.toContain("ORCHES_REVIEW_STATUS");
    expect(initPrompt).not.toContain("[ORCHES_REVIEW]");

    // Review prompt must NOT contain Antigravity implementation brief instructions
    expect(reviewPrompt).not.toContain("ORCHES_STATUS: INSTRUCT");
    expect(reviewPrompt).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
  });

  // 7. All active acceptance criteria have complete text and stable IDs
  it("Gate 7: All active criteria have complete, unabbreviated text and stable IDs (AC-1, AC-2...)", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement authentication",
      inventory,
    });

    expect(taskContext.activeAcceptanceCriteria.length).toBeGreaterThanOrEqual(1);
    expect(taskContext.activeAcceptanceCriteria[0].id).toBe("AC-1");
    expect(taskContext.activeAcceptanceCriteria[0].title.length).toBeGreaterThan(5);
    expect(taskContext.activeAcceptanceCriteria[0].expectedResult.length).toBeGreaterThan(5);
  });

  // 8. Incomplete or unresolved criteria cannot silently become active pass/fail criteria
  it("Gate 8: Incomplete, non-actionable fragments are excluded from active criteria", () => {
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Implement robust API rate limiting",
    });

    expect(taskContext.activeAcceptanceCriteria.every((c) => c.title.trim().length > 3)).toBe(true);
  });

  // 9. Excluded requirements cannot re-enter the active scoring rubric through a secondary code path
  it("Gate 9: Excluded requirements (safety_conflict, deferred) never enter active criteria", () => {
    const inventory = createTestInventory();
    const taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Task with restricted and deferred requirements",
      inventory,
    });

    const activeTitles = taskContext.activeAcceptanceCriteria.map((c) => c.title);

    // REQ-03 (RF emitter manipulation) must be in excludedRequirements, not activeAcceptanceCriteria
    expect(activeTitles.some((t) => t.includes("RF emitter manipulation"))).toBe(false);
    expect(taskContext.excludedRequirements.some((e) => e.id === "REQ-03")).toBe(true);

    // REQ-04 (Legacy SOAP format) must be in excludedRequirements
    expect(activeTitles.some((t) => t.includes("Legacy XML export format"))).toBe(false);
    expect(taskContext.excludedRequirements.some((e) => e.id === "REQ-04")).toBe(true);
  });

  // 10. The current diff replaces stale diff content after a new implementation iteration
  it("Gate 10: Task context updates with new diff and replaces stale diff content", () => {
    let taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Task",
    });

    taskContext = updateAuthoritativeTaskContext(taskContext, {
      iteration: 2,
      changes: [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0 }],
      diffText: "DIFF_ITERATION_2_OLD_DATA",
      diffTruncated: false,
      checks: [],
    });
    expect(taskContext.latestDiffText).toBe("DIFF_ITERATION_2_OLD_DATA");

    taskContext = updateAuthoritativeTaskContext(taskContext, {
      iteration: 3,
      changes: [{ path: "b.ts", kind: "modified", additions: 2, deletions: 0 }],
      diffText: "DIFF_ITERATION_3_FRESH_DATA",
      diffTruncated: false,
      checks: [],
    });
    expect(taskContext.latestDiffText).toBe("DIFF_ITERATION_3_FRESH_DATA");
    expect(taskContext.latestDiffText).not.toContain("DIFF_ITERATION_2_OLD_DATA");
  });

  // 11. Truncated evidence is explicitly represented as incomplete
  it("Gate 11: Large diffs are explicitly labeled as partial rather than silently truncated", () => {
    const largeDiff = "diff --git a/large.ts b/large.ts\n" + "+ line of code\n".repeat(2000);
    const diffEvidence = formatDiffEvidence(
      [{ path: "large.ts", kind: "modified" }],
      largeDiff,
      500
    );

    expect(diffEvidence.status).toBe("partial");
    expect(diffEvidence.formattedText).toContain("DIFF STATUS: PARTIAL");
    expect(diffEvidence.formattedText).toContain("omitted");
  });

  // 12. Empty check results are described honestly
  it("Gate 12: Empty check results are truthfully identified as unexecuted rather than passed", () => {
    const emptyChecksEvidence = formatChecksEvidence([]);
    expect(emptyChecksEvidence).toContain("AUTOMATED CHECKS STATUS: NOT RUN");
    expect(emptyChecksEvidence).toContain("Absence of check execution means system behavior has NOT been empirically verified");
    expect(emptyChecksEvidence).not.toContain("ALL PASSED");
  });

  // 13. Prior unresolved review findings persist until resolved
  it("Gate 13: Prior unresolved findings persist across iterations until marked resolved", () => {
    let taskContext = buildAuthoritativeTaskContext({
      projectId: "proj-alpha",
      runId: "run-001",
      taskText: "Task",
    });

    taskContext = updateAuthoritativeTaskContext(taskContext, {
      iteration: 2,
      changes: [],
      diffText: "",
      diffTruncated: false,
      checks: [],
      findings: [
        { severity: "high", message: "SQL injection vulnerability in user lookup" },
        { severity: "medium", message: "Missing rate limiter header" },
      ],
    });

    expect(taskContext.unresolvedFindings).toHaveLength(2);

    // Iteration 3 carries forward unresolved findings
    taskContext = updateAuthoritativeTaskContext(taskContext, {
      iteration: 3,
      changes: [],
      diffText: "",
      diffTruncated: false,
      checks: [],
      findings: [],
      criteriaReviews: [{ id: "SQL injection vulnerability in user lookup", status: "passed", reason: "fixed" }],
    });

    expect(taskContext.unresolvedFindings).toHaveLength(1);
    expect(taskContext.unresolvedFindings[0].message).toBe("Missing rate limiter header");
  });

  // 14. Malformed, partial, or missing protocol responses never imply acceptance
  it("Gate 14: Malformed or missing protocol responses fail safely and never imply acceptance", () => {
    const malformed1 = "Everything looks good! I accept this change.";
    const malformed2 = "ORCHES_REVIEW_STATUS: ACCEPT\n(missing [ORCHES_REVIEW] block)";
    const malformed3 = `ORCHES_REVIEW_STATUS: ACCEPT
[ORCHES_REVIEW]
## Verdict
ACCEPT
## Acceptance Criteria
- AC-1 — failed — code is broken!
## Summary
All good.
[/ORCHES_REVIEW]`;

    expect(parseReviewProtocol(malformed1).status).toBe("INVALID");
    expect(parseReviewProtocol(malformed2).status).toBe("INVALID");

    // Contradictory review: Verdict is ACCEPT but AC-1 failed -> rejected as invalid!
    expect(parseReviewProtocol(malformed3).status).toBe("INVALID");

    const readerResult1 = ResponseReader.extractReview(malformed1);
    expect(readerResult1.status).toBe("INVALID");

    const readerResult3 = ResponseReader.extractReview(malformed3);
    expect(readerResult3.status).toBe("INVALID");
  });

  // 15. A legitimate STOP or BLOCKED response terminates or pauses execution appropriately
  it("Gate 15: Valid STOP and BLOCKED responses are parsed cleanly into distinct execution states", () => {
    const stopResponse = `ORCHES_STATUS: STOP
Reason: Task requires physical RF hardware control outside permissible scope.`;

    const extractedStop = ResponseReader.extractInstruction(stopResponse);
    expect(extractedStop.status).toBe("STOP");
    expect(extractedStop.action).toBe("stop");
    expect(extractedStop.stopReason).toContain("outside permissible scope");

    const blockedReview = `ORCHES_REVIEW_STATUS: BLOCKED
[ORCHES_REVIEW]
## Verdict
BLOCKED
## Acceptance Criteria
- AC-1 — unverified — diff is completely missing.
## Findings
- High: Missing workspace diff makes verification impossible in src/auth.ts
## Repair Instructions
- Re-run git diff and supply the implementation patch.
## Summary
Review blocked due to missing diff evidence.
[/ORCHES_REVIEW]`;

    const extractedBlocked = ResponseReader.extractReview(blockedReview);
    expect(extractedBlocked.status).toBe("BLOCKED");
    expect(extractedBlocked.verdict).toBe("blocked");
    expect(extractedBlocked.summary).toContain("Review blocked due to missing diff evidence");
  });

  // 16. Identical task state produces deterministic prompt construction
  it("Gate 16: Identical task state produces byte-for-byte deterministic prompt output", () => {
    const inventory = createTestInventory();
    const makePrompt = () => {
      const taskContext = buildAuthoritativeTaskContext({
        projectId: "proj-det",
        runId: "run-det",
        taskText: "Deterministic task definition",
        inventory,
      });

      return buildReviewPrompt({
        taskContext,
        iteration: 2,
        diffEvidence: formatDiffEvidence(
          [{ path: "src/index.ts", kind: "modified" }],
          "+const x = 1;"
        ).formattedText,
        checksEvidence: formatChecksEvidence([
          { label: "unit-test", status: "passed", exitCode: 0, output: "ok" },
        ]),
        agentReply: "Finished work.",
      });
    };

    const run1 = makePrompt();
    const run2 = makePrompt();
    expect(run1).toBe(run2);
  });

  // 17. Different projects cannot leak acceptance criteria, diffs, or review history into each other
  it("Gate 17: Different projects remain completely isolated with no cross-project leakage", () => {
    const invA = buildRequirementInventory({ taskText: "Project A Authentication" });
    const invB = buildRequirementInventory({ taskText: "Project B Rate Limiting" });

    const projectA = buildAuthoritativeTaskContext({
      projectId: "proj-A",
      runId: "run-A",
      taskText: "Project A Authentication",
      inventory: invA,
    });

    const projectB = buildAuthoritativeTaskContext({
      projectId: "proj-B",
      runId: "run-B",
      taskText: "Project B Rate Limiting",
      inventory: invB,
    });

    const promptA = buildReviewPrompt({
      taskContext: projectA,
      iteration: 2,
      diffEvidence: formatDiffEvidence([{ path: "a.ts", kind: "modified" }], "+authA").formattedText,
      checksEvidence: formatChecksEvidence([]),
    });

    const promptB = buildReviewPrompt({
      taskContext: projectB,
      iteration: 2,
      diffEvidence: formatDiffEvidence([{ path: "b.ts", kind: "modified" }], "+rateB").formattedText,
      checksEvidence: formatChecksEvidence([]),
    });

    expect(promptA).toContain("Project A Authentication");
    expect(promptA).not.toContain("Project B Rate Limiting");
    expect(promptA).not.toContain("+rateB");

    expect(promptB).toContain("Project B Rate Limiting");
    expect(promptB).not.toContain("Project A Authentication");
    expect(promptB).not.toContain("+authA");
  });

  // Golden / Snapshot Validation for Iterations 1, 2, and 3
  describe("Golden Prompt Assembled Snapshots (Iterations 1, 2, 3)", () => {
    it("captures and verifies deterministic structure of Iteration 1 (Implementation Brief)", () => {
      const inventory = createTestInventory();
      const taskContext = buildAuthoritativeTaskContext({
        projectId: "proj-golden",
        runId: "run-golden",
        taskText: "Golden Pass Authentication Implementation",
        inventory,
      });

      const prompt1 = buildInstructionPrompt(
        {
          projectId: "proj-golden",
          runId: "run-golden",
          iteration: 1,
          taskText: "Golden Pass Authentication Implementation",
          workspacePath: "/golden/workspace",
          profile: dummyProfile,
          files: ["src/auth.ts"],
          history: [],
          taskContext,
        },
        inventory,
        { filesRepresentation: "src/auth.ts", historyRepresentation: [] }
      );

      expect(prompt1).toContain("OBJECTIVE / TASK FROM THE USER:");
      expect(prompt1).toContain("Golden Pass Authentication Implementation");
      expect(prompt1).toContain("STRUCTURED REQUIREMENT INVENTORY");
      expect(prompt1).toContain("ROUTING & OUTPUT CONTRACT:");
      expect(prompt1).toContain("ORCHES_STATUS: INSTRUCT");
      expect(prompt1).toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
      expect(prompt1).toContain("# Implementation Mission");
      expect(prompt1).toContain("[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
      expect(prompt1).toContain("ORCHES_STATUS: STOP");
    });

    it("captures and verifies deterministic structure of Iteration 2 (Natural Language Review)", () => {
      const inventory = createTestInventory();
      const taskContext = buildAuthoritativeTaskContext({
        projectId: "proj-golden",
        runId: "run-golden",
        taskText: "Golden Pass Authentication Implementation",
        inventory,
      });

      const prompt2 = buildReviewPrompt({
        taskContext,
        iteration: 2,
        diffEvidence: formatDiffEvidence(
          [{ path: "src/auth.ts", kind: "modified" }],
          "diff --git a/src/auth.ts\n+export const verify = () => true;"
        ).formattedText,
        checksEvidence: formatChecksEvidence([
          { label: "npm test", status: "passed", exitCode: 0, output: "ok" },
        ]),
        agentReply: "Exported verify function.",
      });

      expect(prompt2).toContain("INDEPENDENT IMPLEMENTATION REVIEW (ITERATION 2)");
      expect(prompt2).toContain("ORCHES_REVIEW_STATUS: REPAIR");
      expect(prompt2).toContain("ORCHES_REVIEW_STATUS: ACCEPT");
      expect(prompt2).toContain("ORCHES_REVIEW_STATUS: BLOCKED");
      expect(prompt2).toContain("[ORCHES_REVIEW]");
      expect(prompt2).toContain("## Verdict");
      expect(prompt2).toContain("DIFF STATUS: COMPLETE");
    });

    it("captures and verifies deterministic structure of Iteration 3 (Cumulative Review with Findings)", () => {
      const inventory = createTestInventory();
      let taskContext = buildAuthoritativeTaskContext({
        projectId: "proj-golden",
        runId: "run-golden",
        taskText: "Golden Pass Authentication Implementation",
        inventory,
      });

      taskContext = updateAuthoritativeTaskContext(taskContext, {
        iteration: 2,
        changes: [{ path: "src/auth.ts", kind: "modified", additions: 1, deletions: 0 }],
        diffText: "+export const verify = () => true;",
        diffTruncated: false,
        checks: [],
        findings: [
          {
            severity: "high",
            message: "Token verification always returns true without signature check",
          },
        ],
      });

      const prompt3 = buildReviewPrompt({
        taskContext,
        iteration: 3,
        diffEvidence: formatDiffEvidence(
          [{ path: "src/auth.ts", kind: "modified" }],
          "diff --git a/src/auth.ts\n+export const verify = (tok: string) => crypto.verify(tok);"
        ).formattedText,
        checksEvidence: formatChecksEvidence([
          { label: "npm test", status: "passed", exitCode: 0, output: "ok" },
        ]),
        agentReply: "Added crypto.verify check.",
      });

      expect(prompt3).toContain("INDEPENDENT IMPLEMENTATION REVIEW (ITERATION 3)");
      expect(prompt3).toContain("PREVIOUS UNRESOLVED REVIEW FINDINGS");
      expect(prompt3).toContain("Token verification always returns true without signature check");
      expect(prompt3).toContain("DIFF STATUS: COMPLETE");
      expect(prompt3).toContain("ORCHES_REVIEW_STATUS");
    });
  });
});
