import { describe, it, expect } from "vitest";
import { extractJsonFromText } from "../src/prompts/json-extractor.js";
import { RequirementExtractor } from "../src/domain/blueprints/requirement-extractor.js";
import { BlueprintImporter } from "../src/domain/blueprints/importer.js";
import { buildRequirementInventory } from "../src/domain/requirements/requirement-inventory.js";
import {
  validatePromptFidelity,
  validateAndCorrectPrompt,
} from "../src/orchestrator/prompt-fidelity-gate.js";

describe("Prompt Fidelity Gaps: Regression Tests for Confirmed Defects", () => {
  describe("1. Robust JSON Extractor & Truncation Recovery", () => {
    it("parses valid JSON with literal unescaped newlines in markdown instruction string", () => {
      const rawWithLiteralNewlines = `{\n  "action": "instruct",\n  "instruction": "# Title\\n\\n## Section\\nLine 1\\nLine 2",\n  "rationale": "Direct"\n}`;
      const parsed = extractJsonFromText(rawWithLiteralNewlines);
      expect(parsed).not.toBeNull();
      expect(parsed?.action).toBe("instruct");
      expect(parsed?.instruction).toContain("Line 1");
    });

    it("recovers instruction content when JSON is truncated mid-generation by token limits", () => {
      const truncated = `{\n  "action": "instruct",\n  "instruction": "# Engineering Brief\\n\\n## Scope\\nImplement broker with SQLite in WAL mode.`;
      const parsed = extractJsonFromText(truncated);
      expect(parsed).not.toBeNull();
      expect(parsed?.action).toBe("instruct");
      expect(parsed?.instruction).toContain("Implement broker with SQLite in WAL mode.");
    });
  });

  describe("2. Requirement Extraction Completeness & Provenance", () => {
    it("does not silently truncate candidate requirements at 50 in large documents", () => {
      const importer = new BlueprintImporter();
      const lines = ["# Large Specification", "## Phase 1 Requirements"];
      for (let i = 1; i <= 80; i++) {
        lines.push(`- Must implement Module #${i} with automated tests.`);
      }
      const doc = importer.importFile("large-spec.md", Buffer.from(lines.join("\n"), "utf8"));
      const extractor = new RequirementExtractor();
      const reqs = extractor.extractFromDocument("proj-large", doc);

      expect(reqs.length).toBeGreaterThanOrEqual(80);
      expect(reqs.some((r) => r.title.includes("Module #80"))).toBe(true);
    });

    it("correctly classifies negative security constraints (e.g. never log raw payloads)", () => {
      const spec = `
# Security Spec
## Constraints
- Never log raw event payloads or secret credentials.
- Strictly SQLite only; do not introduce external database servers.
      `.trim();

      const inventory = buildRequirementInventory({
        taskText: "Implement Security",
        projectObjective: spec,
      });

      const logConstraint = inventory.requirements.find((r) => r.title.toLowerCase().includes("never log"));
      expect(logConstraint).toBeDefined();
      expect(logConstraint?.classification).toBe("explicit_constraint");
      expect(logConstraint?.importance).toBe("critical");
    });

    it("gives acceptance criteria precedence over incidental adverbs like 'strictly'", () => {
      const spec = `
# Acceptance Spec
## Acceptance Criteria
- Verify that poll returns events in strictly chronological order.
- Assert that duplicate requests return HTTP 409.
      `.trim();

      const inventory = buildRequirementInventory({
        taskText: "Implement Polling",
        projectObjective: spec,
      });

      const chronoCriterion = inventory.requirements.find((r) => r.title.toLowerCase().includes("chronological order"));
      expect(chronoCriterion).toBeDefined();
      expect(chronoCriterion?.classification).toBe("acceptance_criterion");
    });

    it("preserves requirements across different phases without global title collision", () => {
      const spec = `
# Phased Project
## Milestone 1
- Error handling and input validation.

## Milestone 2
- Error handling and input validation.
      `.trim();

      const inventory = buildRequirementInventory({
        taskText: "Phased Execution",
        projectObjective: spec,
      });

      const errorReqs = inventory.requirements.filter((r) => r.title.toLowerCase().includes("error handling"));
      expect(errorReqs.length).toBe(2);
      expect(errorReqs[0].phase).toBe("Milestone 1");
      expect(errorReqs[1].phase).toBe("Milestone 2");
    });

    it("extracts dependency relationships between requirements", () => {
      const spec = `
# Dependency Spec
## Features
- Topic Partitioning: Must partition by tenant.
- Consumer Polling: Depends on Topic Partitioning.
      `.trim();

      const inventory = buildRequirementInventory({
        taskText: "Implement Architecture",
        projectObjective: spec,
      });

      const pollingReq = inventory.requirements.find((r) => r.title.toLowerCase().includes("consumer polling"));
      expect(pollingReq).toBeDefined();
      expect(pollingReq?.dependencies).toBeDefined();
      expect(pollingReq?.dependencies?.[0].toLowerCase()).toContain("topic partitioning");
    });
  });

  describe("3. Transparent Fidelity Scoring & Constraint Negation Protection", () => {
    it("does not flag false positive constraint violations when prompt restates negative constraints", () => {
      const inventory = buildRequirementInventory({
        taskText: "Implement Service",
        projectObjective: `
## Constraints
- Strictly SQLite only; do not introduce external database servers like PostgreSQL or MongoDB.
- No ORMs (no Prisma, TypeORM, or Sequelize).
- No Tailwind CSS.
        `.trim(),
      });

      // Prompt faithfully quoting the negative constraints:
      const faithfulPrompt = `
# Engineering Implementation Brief
## Preserved Constraints
- STRICT CONSTRAINT: Strictly SQLite only; do not introduce external database servers like PostgreSQL or MongoDB.
- STRICT CONSTRAINT: No ORMs (no Prisma, TypeORM, or Sequelize).
- STRICT CONSTRAINT: No Tailwind CSS. Use vanilla CSS only.
      `.trim();

      const report = validatePromptFidelity(faithfulPrompt, inventory);
      expect(report.weakenedConstraints.length).toBe(0);
      expect(report.passed).toBe(true);
    });

    it("flags genuine affirmative constraint violations", () => {
      const inventory = buildRequirementInventory({
        taskText: "Implement Service",
        projectObjective: `
## Constraints
- Strictly SQLite only.
- No ORMs.
        `.trim(),
      });

      const violatingPrompt = `
# Engineering Implementation Brief
Configure Prisma client with PostgreSQL connection pool.
      `.trim();

      const report = validatePromptFidelity(violatingPrompt, inventory);
      expect(report.weakenedConstraints.length).toBeGreaterThanOrEqual(1);
      expect(report.passed).toBe(false);
    });

    it("returns initialReport, report, and residualUncertainties transparently", () => {
      const inventory = buildRequirementInventory({
        taskText: "Implement Service",
        projectObjective: `
## Mandatory
- Must implement JWT authentication.
- Must implement Password hashing.
        `.trim(),
      });

      // Candidate prompt that missed password hashing:
      const incompletePrompt = `
# Engineering Brief
Implement JWT authentication.
      `.trim();

      const result = validateAndCorrectPrompt(incompletePrompt, inventory);
      expect(result.initialReport).toBeDefined();
      expect(result.initialReport.passed).toBe(false);
      expect(result.initialReport.missingRequirements.length).toBe(1);

      expect(result.report).toBeDefined();
      expect(result.passed).toBe(true);
      expect(result.residualUncertainties.length).toBeGreaterThan(0);
      expect(result.report.score).toBeLessThanOrEqual(95);
      expect(result.report.summary).toContain("Initial:");
      expect(result.report.summary).toContain("residual uncertainties noted");
    });
  });
});
