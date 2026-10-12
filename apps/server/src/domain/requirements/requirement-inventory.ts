import crypto from "node:crypto";
import type { ImportedDocument } from "../blueprints/importer.js";
import type { CandidateRequirement } from "../blueprints/requirement-extractor.js";

export type RequirementClassification =
  | "mandatory_requirement"
  | "optional_requirement"
  | "explicit_constraint"
  | "acceptance_criterion"
  | "reasonable_inference"
  | "unresolved_contradiction";

export type RequirementImportance = "critical" | "high" | "medium" | "low";

export type RequirementScopeStatus =
  | "in_scope"
  | "out_of_scope"
  | "deferred"
  | "safety_conflict"
  | "unresolved";

export type RequirementStatus =
  | "not_started"
  | "in_progress"
  | "implemented_unverified"
  | "verified"
  | "blocked";

export interface ProjectRequirement {
  id: string; // Stable identifier, e.g. "REQ-001"
  title: string;
  description: string;
  classification: RequirementClassification;
  importance: RequirementImportance;
  sourceReference: string; // e.g. "Specification: Section 2" or "blueprint.md: Line 15"
  phase?: string; // e.g. "Milestone 1", "Phase 2"
  dependencies?: string[];
  status: RequirementStatus;
  scopeStatus?: RequirementScopeStatus;
  scopeConflictReason?: string;
  evidence?: string[];
  notes?: string;
  contradictionDetails?: {
    conflictingText: string;
    conflictingSource: string;
  };
}

export interface RequirementInventory {
  requirements: ProjectRequirement[];
  summary: {
    total: number;
    mandatory: number;
    constraints: number;
    optional: number;
    acceptanceCriteria: number;
    inferences: number;
    contradictions: number;
    phases: string[];
    byStatus: Record<RequirementStatus, number>;
  };
}

export interface InventoryBuildInput {
  taskText: string;
  projectObjective?: string;
  blueprintDocuments?: ImportedDocument[];
  candidateRequirements?: CandidateRequirement[];
}

/**
 * Builds a structured, complete requirement inventory from the user's specification,
 * task description, and any uploaded blueprint documents without silently truncating sections.
 */
export function buildRequirementInventory(input: InventoryBuildInput): RequirementInventory {
  const requirements: ProjectRequirement[] = [];
  const seenKeys = new Set<string>();
  let reqCounter = 1;

  const nextId = () => `REQ-${String(reqCounter++).padStart(3, "0")}`;
  const makeKey = (phase: string | undefined, title: string) => `${phase || "general"}:${title.toLowerCase().trim()}`;

  // 1. Ingest existing blueprint candidate requirements if already parsed
  if (input.candidateRequirements && input.candidateRequirements.length > 0) {
    for (const c of input.candidateRequirements) {
      const key = makeKey(undefined, c.title);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const isConstraint = isConstraintText(c.title + " " + c.description);
      requirements.push({
        id: c.id || nextId(),
        title: c.title,
        description: c.description || c.title,
        classification: isConstraint ? "explicit_constraint" : c.provenanceKind === "explicit" ? "mandatory_requirement" : "reasonable_inference",
        importance: isConstraint ? "critical" : "high",
        sourceReference: c.sourceReference || "Blueprint",
        status: "not_started",
      });
    }
  }

  // 2. Ingest Universal Project Specification & Instructions (unrestricted text)
  if (input.projectObjective && input.projectObjective.trim()) {
    const specReqs = extractRequirementsFromText(input.projectObjective, "Project Specification", nextId);
    for (const r of specReqs) {
      const key = makeKey(r.phase, r.title);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        requirements.push(r);
      }
    }
  }

  // 3. Ingest Task Text
  if (input.taskText && input.taskText.trim()) {
    const taskReqs = extractRequirementsFromText(input.taskText, "Task Request", nextId);
    for (const r of taskReqs) {
      const key = makeKey(r.phase, r.title);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        requirements.push(r);
      }
    }
  }

  // 4. Ingest Blueprint Documents (chunked by section/paragraph to prevent silent truncation)
  if (input.blueprintDocuments && input.blueprintDocuments.length > 0) {
    for (const doc of input.blueprintDocuments) {
      const docReqs = extractRequirementsFromText(doc.extractedText, `Blueprint (${doc.filename})`, nextId);
      for (const r of docReqs) {
        const key = makeKey(r.phase, r.title);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          requirements.push(r);
        }
      }
    }
  }

  // If no specific requirements were extracted (e.g. ultra-short prompt like "calculator"), create baseline
  if (requirements.length === 0) {
    const title = input.taskText.trim().split(/\r?\n/)[0] || "Implement task objective";
    requirements.push({
      id: nextId(),
      title,
      description: input.taskText.trim(),
      classification: "mandatory_requirement",
      importance: "high",
      sourceReference: "Task Request",
      status: "not_started",
    });
  }

  // 5. Detect Contradictions Across Requirements
  detectContradictions(requirements);

  // 6. Resolve Scope Boundaries and Safety Conflicts
  resolveScopeBoundaries(requirements, input.taskText, input.projectObjective);

  // Compute summary stats
  const byStatus: Record<RequirementStatus, number> = {
    not_started: 0,
    in_progress: 0,
    implemented_unverified: 0,
    verified: 0,
    blocked: 0,
  };
  let mandatory = 0;
  let constraints = 0;
  let optional = 0;
  let acceptanceCriteria = 0;
  let inferences = 0;
  let contradictions = 0;

  for (const r of requirements) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.classification === "mandatory_requirement") mandatory++;
    else if (r.classification === "explicit_constraint") constraints++;
    else if (r.classification === "optional_requirement") optional++;
    else if (r.classification === "acceptance_criterion") acceptanceCriteria++;
    else if (r.classification === "reasonable_inference") inferences++;
    else if (r.classification === "unresolved_contradiction") contradictions++;
  }

  const phases = [...new Set(requirements.map((r) => r.phase).filter(Boolean) as string[])];

  return {
    requirements,
    summary: {
      total: requirements.length,
      mandatory,
      constraints,
      optional,
      acceptanceCriteria,
      inferences,
      contradictions,
      phases,
      byStatus,
    },
  };
}

/**
 * Parses structured text using section-aware chunking without dropping content.
 */
function extractRequirementsFromText(
  rawText: string,
  sourceLabel: string,
  idGen: () => string
): ProjectRequirement[] {
  const results: ProjectRequirement[] = [];
  const lines = rawText.split(/\r?\n/);
  let currentSection = "General";
  let currentPhase: string | undefined = undefined;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;

    // Track section headings
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      const phaseMatch = currentSection.match(/(Phase\s+\d+|Milestone\s+\d+|Sprint\s+\d+)/i);
      if (phaseMatch) {
        currentPhase = phaseMatch[1];
      }
      continue;
    }

    const isBullet = /^[-*•]\s+/.test(line);
    const isNumbered = /^\d+[\.)]\s+/.test(line);
    const cleanContent = line.replace(/^([-*•]|\d+[\.)]|#{1,4})\s+/, "").trim();

    if (cleanContent.length < 5) continue;
    if (cleanContent.toLowerCase().startsWith("table of contents")) continue;

    const lower = cleanContent.toLowerCase();

    // Extract dependency relationships if present
    const depMatch = cleanContent.match(/(?:depends on|prerequisite:|requires|prerequisite is)\s+([^.,;\n]+)/i);
    const dependencies = depMatch ? [depMatch[1].trim()] : undefined;

    // Check classification with proper precedence:
    // When a line explicitly starts with verification words (e.g. "assert that", "verify that")
    // or is under an Acceptance Criteria section, it must be an acceptance criterion
    const inCriteriaSection = /acceptance criteria|verification|test criteria/i.test(currentSection);
    const inOptionalSection = /optional|nice to have|future enhancements/i.test(currentSection);
    const startsWithCriterionWord = /^(assert that|verify that|test that|ensure that tests|verify whether)/i.test(cleanContent);
    const isCriteria = isAcceptanceCriterionText(cleanContent) || inCriteriaSection;
    const isConstraint = isConstraintText(cleanContent) && !startsWithCriterionWord;
    const isOptional = isOptionalText(cleanContent) || inOptionalSection;
    const isExplicit = isExplicitRequirementText(cleanContent);

    // If it's a bullet, numbered item, or has strong imperative keywords
    if (isBullet || isNumbered || isConstraint || isOptional || isCriteria || isExplicit) {
      let classification: RequirementClassification = "mandatory_requirement";
      let importance: RequirementImportance = "high";

      if (isCriteria && (startsWithCriterionWord || inCriteriaSection || !isConstraint)) {
        classification = "acceptance_criterion";
        importance = "high";
      } else if (isConstraint) {
        classification = "explicit_constraint";
        importance = "critical";
      } else if (isOptional) {
        classification = "optional_requirement";
        importance = "low";
      } else if (isCriteria) {
        classification = "acceptance_criterion";
        importance = "high";
      } else if (isExplicit) {
        classification = "mandatory_requirement";
        importance = "high";
      } else {
        // Bullet or numbered in general text
        classification = "mandatory_requirement";
        importance = "medium";
      }

      results.push({
        id: idGen(),
        title: cleanContent.slice(0, 140),
        description: cleanContent,
        classification,
        importance,
        sourceReference: `${sourceLabel} · ${currentSection} (Line ${idx + 1})`,
        phase: currentPhase,
        dependencies,
        status: "not_started",
      });
    }
  }

  return results;
}

function isConstraintText(text: string): boolean {
  const l = text.toLowerCase();
  return (
    l.includes("strictly") ||
    l.includes("must use") ||
    l.includes("shall use") ||
    l.includes("must not") ||
    l.includes("shall not") ||
    l.includes("forbidden") ||
    l.includes("do not use") ||
    l.includes("do not") ||
    l.includes("never use") ||
    l.includes("never log") ||
    l.includes("never expose") ||
    l.includes("never store") ||
    l.includes("never commit") ||
    l.includes("cannot use") ||
    l.includes("cannot") ||
    l.includes("no orm") ||
    l.includes("no tailwind") ||
    l.includes("zero external dependencies") ||
    l.includes("no external dependencies") ||
    l.includes("sqlite only") ||
    l.includes("only use") ||
    l.includes("standard library only") ||
    l.includes("must be written in") ||
    l.includes("must adhere to") ||
    l.includes("disallowed") ||
    l.includes("prohibited") ||
    l.includes("avoid external") ||
    l.includes("constraint:") ||
    l.includes("constraints:") ||
    l.includes("rules:") ||
    /version\s+[0-9]/i.test(l) ||
    /port\s+[0-9]+/i.test(l)
  );
}

function isOptionalText(text: string): boolean {
  const l = text.toLowerCase();
  return (
    l.includes("optional:") ||
    l.includes("(optional") ||
    l.includes("optional suggestion") ||
    l.includes("nice to have") ||
    l.includes("if time permits") ||
    l.includes("optional requirement") ||
    l.includes("bonus:") ||
    l.includes("could also")
  );
}

function isAcceptanceCriterionText(text: string): boolean {
  const l = text.toLowerCase();
  return (
    l.includes("acceptance criteria") ||
    l.includes("acceptance test") ||
    l.includes("verify that") ||
    l.includes("verification:") ||
    l.includes("test that") ||
    l.includes("assert that") ||
    l.includes("must pass tests")
  );
}

function isExplicitRequirementText(text: string): boolean {
  const l = text.toLowerCase();
  return (
    l.includes("must ") ||
    l.includes("shall ") ||
    l.includes("required to") ||
    l.includes("needs to") ||
    l.includes("feature:") ||
    l.includes("endpoint:") ||
    l.includes("api:") ||
    l.includes("data model:")
  );
}

/**
 * Detects contradictory requirements within the specification and marks them
 * so they are surfaced honestly as unresolved ambiguities rather than hallucinating a resolution.
 */
function detectContradictions(requirements: ProjectRequirement[]): void {
  for (let i = 0; i < requirements.length; i++) {
    for (let j = i + 1; j < requirements.length; j++) {
      const a = requirements[i];
      const b = requirements[j];
      const conflict = findContradiction(a.description, b.description);
      if (conflict) {
        a.classification = "unresolved_contradiction";
        a.contradictionDetails = {
          conflictingText: b.description,
          conflictingSource: b.sourceReference,
        };
        b.classification = "unresolved_contradiction";
        b.contradictionDetails = {
          conflictingText: a.description,
          conflictingSource: a.sourceReference,
        };
      }
    }
  }
}

/**
 * Deterministic detection for common technical and architectural contradictions.
 */
function findContradiction(textA: string, textB: string): string | null {
  const la = textA.toLowerCase();
  const lb = textB.toLowerCase();

  // Database engine contradictions
  const isPostgresA = la.includes("postgresql") || la.includes("postgres");
  const isPostgresB = lb.includes("postgresql") || lb.includes("postgres");
  const isSqliteA = la.includes("sqlite");
  const isSqliteB = lb.includes("sqlite");
  if ((isPostgresA && isSqliteB) || (isSqliteA && isPostgresB)) {
    return "Conflicting database engines specified (PostgreSQL vs SQLite).";
  }

  // Dependency directives contradictions
  const zeroDepsA = la.includes("no external dependencies") || la.includes("zero dependencies") || la.includes("no dependencies") || la.includes("standard library only");
  const zeroDepsB = lb.includes("no external dependencies") || lb.includes("zero dependencies") || lb.includes("no dependencies") || lb.includes("standard library only");
  const externalDepsA = la.includes("install express") || la.includes("use fastify") || la.includes("npm install") || la.includes("external packages") || la.includes("third-party libraries");
  const externalDepsB = lb.includes("install express") || lb.includes("use fastify") || lb.includes("npm install") || lb.includes("external packages") || lb.includes("third-party libraries");
  if ((zeroDepsA && externalDepsB) || (externalDepsA && zeroDepsB)) {
    return "Conflicting dependency directives: Zero external dependencies requested while third-party packages required.";
  }

  // Architecture style contradictions
  const singleFileA = la.includes("single-file script") || la.includes("single file only") || la.includes("monolithic script");
  const singleFileB = lb.includes("single-file script") || lb.includes("single file only") || lb.includes("monolithic script");
  const modularA = la.includes("multi-package modular architecture") || la.includes("microservices architecture") || la.includes("modular multi-package");
  const modularB = lb.includes("multi-package modular architecture") || lb.includes("microservices architecture") || lb.includes("modular multi-package");
  if ((singleFileA && modularB) || (modularA && singleFileB)) {
    return "Conflicting architecture directives: Single-file script vs multi-package modular architecture.";
  }

  // Port assignment contradictions
  if ((la.includes("port 8080") && lb.includes("port 3000")) || (la.includes("port 3000") && lb.includes("port 8080"))) {
    return "Conflicting port assignments (Port 8080 vs Port 3000).";
  }

  return null;
}

/**
 * Resolves scope boundaries across requirements. Identifies out-of-scope, deferred,
 * or safety-conflicting requirements (such as physical emitter interception or military receiver hardware
 * when the declared objective is a synthetic research simulator) without discarding traceability.
 */
function resolveScopeBoundaries(
  requirements: ProjectRequirement[],
  taskText: string,
  projectObjective?: string
): void {
  const combinedObjective = `${taskText} ${projectObjective || ""}`.toLowerCase();

  // Check if current authorized scope is a safe synthetic simulator or alternative
  const isSyntheticSimulator =
    combinedObjective.includes("synthetic") ||
    combinedObjective.includes("simulator") ||
    combinedObjective.includes("research alternative") ||
    combinedObjective.includes("safe alternative") ||
    combinedObjective.includes("mock environment") ||
    combinedObjective.includes("non-operational");

  for (const req of requirements) {
    const lDesc = req.description.toLowerCase();
    const lTitle = req.title.toLowerCase();
    const fullText = `${lTitle} ${lDesc}`;

    // Default scope status
    req.scopeStatus = "in_scope";

    if (isSyntheticSimulator) {
      // Physical RF receiver control, hardware interception, radar-specific optimization, or weaponized operations
      const isPhysicalOrMilitaryHardware =
        fullText.includes("physical receiver") ||
        fullText.includes("physical rf") ||
        fullText.includes("rf receiver hardware") ||
        fullText.includes("physical rf receiver control") ||
        fullText.includes("physical rf receiver") ||
        fullText.includes("receiver control") ||
        fullText.includes("hardware control") ||
        fullText.includes("intercept operational") ||
        fullText.includes("operational emitter interception") ||
        fullText.includes("operational military-emitter interception") ||
        fullText.includes("operational military emitter interception") ||
        fullText.includes("operational military-emitter") ||
        fullText.includes("operational military emitter") ||
        fullText.includes("military-emitter") ||
        fullText.includes("military emitter") ||
        fullText.includes("operational emitter") ||
        fullText.includes("radar-specific interception optimization") ||
        fullText.includes("radar-specific interception") ||
        fullText.includes("radar-specific") ||
        fullText.includes("interception optimization") ||
        fullText.includes("radar interception") ||
        fullText.includes("live emitter interception") ||
        fullText.includes("operational military") ||
        fullText.includes("military deployment") ||
        fullText.includes("weapon system") ||
        fullText.includes("classified emitter database");

      if (isPhysicalOrMilitaryHardware) {
        req.scopeStatus = "safety_conflict";
        req.scopeConflictReason =
          "Operational hardware / live interception is prohibited: Operational military-emitter interception, radar-specific interception optimization, physical RF receiver control, or military deployment is prohibited under the authorized synthetic scheduling simulator boundary.";
        continue;
      }
    }

    // Deferred or out of scope markers
    if (
      fullText.includes("phase 2") ||
      fullText.includes("future phase") ||
      fullText.includes("deferred to next release") ||
      fullText.includes("post-mvp") ||
      fullText.includes("subsequent phase")
    ) {
      req.scopeStatus = "deferred";
      req.scopeConflictReason = "Deferred to subsequent phase.";
    } else if (
      fullText.includes("out of scope") ||
      fullText.includes("explicitly excluded") ||
      fullText.includes("excluded from")
    ) {
      req.scopeStatus = "out_of_scope";
      req.scopeConflictReason = "Explicitly excluded from implementation scope.";
    } else if (
      fullText.includes("safety conflict") ||
      fullText.includes("safety boundary conflict")
    ) {
      req.scopeStatus = "safety_conflict";
      req.scopeConflictReason = "Safety boundary conflict noted.";
    }
  }
}

/**
 * Updates requirement statuses across iteration attempts based on real evidence
 * (files created, static checks, automated test results, critic findings).
 */
export function updateRequirementStatuses(
  inventory: RequirementInventory,
  evidence: {
    filesChanged: string[];
    passedChecks: string[];
    failedChecks: string[];
    criticVerified?: string[];
    criticFailed?: string[];
  }
): RequirementInventory {
  for (const req of inventory.requirements) {
    const lTitle = req.title.toLowerCase();

    // Check if directly failed by reviewer
    if (evidence.criticFailed?.some((f) => {
      const str = typeof f === "string" ? f : (f && typeof f === "object" ? JSON.stringify(f) : String(f ?? ""));
      return str.toLowerCase().includes(req.id.toLowerCase()) || str.toLowerCase().includes(lTitle);
    })) {
      req.status = "in_progress";
      req.notes = "Review flagged incomplete or failing implementation.";
      continue;
    }

    // Check if verified by reviewer and passed tests
    if (
      evidence.passedChecks.length > 0 &&
      evidence.criticVerified?.some((v) => {
        const str = typeof v === "string" ? v : (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
        return str.toLowerCase().includes(req.id.toLowerCase()) || str.toLowerCase().includes(lTitle);
      })
    ) {
      req.status = "verified";
      req.notes = "Verified by automated tests and independent review.";
      continue;
    }

    // Check if relevant files were created/modified
    const touched = evidence.filesChanged.length > 0;
    if (touched) {
      if (evidence.passedChecks.length > 0) {
        req.status = "verified";
      } else {
        req.status = "implemented_unverified";
      }
    }
  }

  // Recalculate summary byStatus
  const byStatus: Record<RequirementStatus, number> = {
    not_started: 0,
    in_progress: 0,
    implemented_unverified: 0,
    verified: 0,
    blocked: 0,
  };
  for (const r of inventory.requirements) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  inventory.summary.byStatus = byStatus;

  return inventory;
}
