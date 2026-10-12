import { describe, it, expect } from "vitest";
import { buildRequirementInventory } from "../src/domain/requirements/requirement-inventory.js";
import {
  validatePromptFidelity,
  validateAndCorrectPrompt,
} from "../src/orchestrator/prompt-fidelity-gate.js";

const sourceSpec = `
# Secure Authentication Service
## Features
- Must implement password hashing using Argon2id algorithm.
- Must issue signed JWT tokens with 15-minute expiration upon valid login.
- Must implement rate limiting of 5 failed attempts per IP per minute.

## Constraints
- Strictly SQLite only; do not introduce external database servers.
- Zero external dependencies: use Node.js standard library only (crypto, http).
- No ORMs allowed; use direct SQL statements.

## Acceptance Criteria
- Verify that POST /api/auth/login returns 401 Unauthorized on invalid or expired token.
- Verify that POST /api/auth/login returns 200 OK and JWT token on valid credentials.
`.trim();

describe("Section 4 Verification: Controlled Faulty Candidate Prompts & Gate Enforcement", () => {
  const inventory = buildRequirementInventory({
    taskText: "Implement Secure Authentication Service",
    projectObjective: sourceSpec,
  });

  // Fault 1: Omit a mandatory requirement
  it("Fault 1: detects omitted mandatory requirement and enforces traceability in corrected prompt", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id and JWT tokens with 15-minute expiration.
Strictly SQLite only. Zero external dependencies. No ORMs.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect(initial.missingRequirements.some((m) => m.title.includes("rate limiting"))).toBe(true);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(false);
    expect(corrected.prompt).not.toContain("## Mandatory Requirements (Traceability Enforcement)");
    expect(corrected.report.missingRequirements.some((m) => m.title.includes("rate limiting"))).toBe(true);
    expect(corrected.residualUncertainties.some((u) => u.includes("rate limiting") || u.includes("omitted"))).toBe(true);
  });

  // Fault 2: Change a specified technology
  it("Fault 2: detects changed specified technology (SQLite -> MongoDB) and enforces specified tech", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Use MongoDB database for persistence.
Zero external dependencies. No ORMs.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect(initial.weakenedConstraints.some((w) => w.issue.includes("PostgreSQL/MongoDB"))).toBe(true);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("STRICT CONSTRAINT: Strictly SQLite only");
    expect(corrected.prompt.toLowerCase()).not.toContain("mongodb");
  });

  // Fault 3: Violate an explicit negative constraint
  it("Fault 3: detects violation of negative constraint (zero external dependencies -> npm install)", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Strictly SQLite only. No ORMs.
Run npm install express jsonwebtoken to build server.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect(initial.weakenedConstraints.some((w) => w.issue.includes("zero external dependencies"))).toBe(true);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("use Node.js standard library modules only");
    expect(corrected.prompt.toLowerCase()).not.toContain("npm install express");
  });

  // Fault 4: Invent a numerical performance guarantee
  it("Fault 4: detects invented numerical performance guarantees (99.999% SLA & sub-millisecond)", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Strictly SQLite only. Zero external dependencies. No ORMs.
Must guarantee 99.999% availability SLA and sub-millisecond latency under 100k requests/sec.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect(initial.unsupportedAdditions.some((u) => u.claim.includes("99.999%"))).toBe(true);
    expect(initial.unsupportedAdditions.some((u) => u.claim.includes("Sub-millisecond"))).toBe(true);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("Scope Boundary Notice (Unsupported Additions Reclassified)");
    expect(corrected.prompt).toContain("standard production availability");
  });

  // Fault 5: Introduce an unsupported dependency
  it("Fault 5: detects unsupported dependencies (Apache Kafka and Kubernetes cluster)", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Strictly SQLite only. Zero external dependencies. No ORMs.
Deploy to a Kubernetes cluster with Apache Kafka event streaming.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect(initial.unsupportedAdditions.some((u) => u.claim.includes("Kafka"))).toBe(true);
    expect(initial.unsupportedAdditions.some((u) => u.claim.includes("Kubernetes"))).toBe(true);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("Scope Boundary Notice (Unsupported Additions Reclassified)");
  });

  // Fault 6: Contradict a source acceptance criterion
  it("Fault 6: detects contradicted source acceptance criterion (return 200 on expired instead of 401)", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Strictly SQLite only. Zero external dependencies. No ORMs.
Return 200 on expired session token.
Returns 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect((initial.contradictedCriteria?.length ?? 0)).toBeGreaterThan(0);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("Preserved Acceptance Criteria (Source Authority Enforced)");
    expect(corrected.prompt).toContain("401 Unauthorized on expired");
  });

  // Fault 7: Claim a requirement has been verified without evidence
  it("Fault 7: detects unevidenced verification claims and neutralizes premature success assertions", () => {
    const prompt = `
# Engineering Brief
Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts.
Strictly SQLite only. Zero external dependencies. No ORMs.
All requirements have already been verified and tested successfully. No further implementation or test execution is necessary.
Returns 401 on invalid token and 200 on valid credentials.
    `.trim();

    const initial = validatePromptFidelity(prompt, inventory, { sourceText: sourceSpec });
    expect(initial.passed).toBe(false);
    expect((initial.unevidencedVerificationClaims?.length ?? 0)).toBeGreaterThan(0);

    const corrected = validateAndCorrectPrompt(prompt, inventory, { sourceText: sourceSpec });
    expect(corrected.passed).toBe(true);
    expect(corrected.prompt).toContain("Verification Realism Notice (Empirical Evidence Required)");
    expect(corrected.prompt).toContain("must be implemented and validated with automated test execution");
  });
});
