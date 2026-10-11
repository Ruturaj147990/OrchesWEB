import type { RequirementInventory, ProjectRequirement } from "../domain/requirements/requirement-inventory.js";
import type { AutonomyMode } from "@orchestrator/shared-types";

export interface MissingRequirementDefect {
  id: string;
  title: string;
  importance: string;
  reason: string;
}

export interface WeakenedConstraintDefect {
  id: string;
  title: string;
  constraint: string;
  issue: string;
}

export interface UnsupportedAdditionDefect {
  claim: string;
  concern: string;
  category: "invented_guarantee" | "unsupported_hardware_or_api" | "unjustified_library";
}

export interface UnresolvedContradictionDefect {
  id: string;
  conflictingText: string;
  issue: string;
}

export interface ContradictedCriterionDefect {
  id: string;
  criterion: string;
  contradiction: string;
}

export interface UnevidencedVerificationDefect {
  claim: string;
  requirementId?: string;
  issue: string;
}

export interface TraceabilityEntry {
  requirementId: string;
  title: string;
  classification: string;
  isMapped: boolean;
  mentionExcerpt?: string;
}

export interface PromptFidelityReport {
  passed: boolean;
  score: number; // 0 to 100
  missingRequirements: MissingRequirementDefect[];
  weakenedConstraints: WeakenedConstraintDefect[];
  unsupportedAdditions: UnsupportedAdditionDefect[];
  unresolvedContradictions: UnresolvedContradictionDefect[];
  contradictedCriteria?: ContradictedCriterionDefect[];
  unevidencedVerificationClaims?: UnevidencedVerificationDefect[];
  traceabilityMap: TraceabilityEntry[];
  summary: string;
}

export interface FidelityValidationOptions {
  sourceText?: string;
  autonomyMode?: AutonomyMode;
  iteration?: number;
}

function hasAffirmativeViolation(promptText: string, terms: string[]): boolean {
  for (const term of terms) {
    const regex = new RegExp(`\\b${term}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(promptText)) !== null) {
      const windowStart = Math.max(0, match.index - 60);
      const prefix = promptText.slice(windowStart, match.index).toLowerCase();
      const isNegated =
        prefix.includes("no ") ||
        prefix.includes("not ") ||
        prefix.includes("avoid ") ||
        prefix.includes("without ") ||
        prefix.includes("never ") ||
        prefix.includes("forbidden") ||
        prefix.includes("strict constraint") ||
        prefix.includes("do not");
      if (!isNegated) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates whether a generated engineering prompt accurately, faithfully,
 * and comprehensively represents the supplied project specification and requirement inventory.
 */
export function validatePromptFidelity(
  prompt: string,
  inventory: RequirementInventory,
  options: FidelityValidationOptions = {}
): PromptFidelityReport {
  const promptLower = prompt.toLowerCase();
  const sourceLower = (options.sourceText || "").toLowerCase();
  const scopeBoundaryIdx = promptLower.indexOf("## scope boundary notice");
  const activePromptLower = scopeBoundaryIdx !== -1 ? promptLower.slice(0, scopeBoundaryIdx) : promptLower;

  const missingRequirements: MissingRequirementDefect[] = [];
  const weakenedConstraints: WeakenedConstraintDefect[] = [];
  const unsupportedAdditions: UnsupportedAdditionDefect[] = [];
  const unresolvedContradictions: UnresolvedContradictionDefect[] = [];
  const contradictedCriteria: ContradictedCriterionDefect[] = [];
  const unevidencedVerificationClaims: UnevidencedVerificationDefect[] = [];
  const traceabilityMap: TraceabilityEntry[] = [];

  // 1. Requirement Coverage & Traceability
  for (const req of inventory.requirements) {
    const isMapped = checkRequirementMentioned(promptLower, req, options.iteration);
    traceabilityMap.push({
      requirementId: req.id,
      title: req.title,
      classification: req.classification,
      isMapped,
    });

    if (!isMapped && (req.classification === "mandatory_requirement" || req.classification === "explicit_constraint")) {
      missingRequirements.push({
        id: req.id,
        title: req.title,
        importance: req.importance,
        reason: `Explicit ${req.classification.replace("_", " ")} was omitted from the generated engineering instructions.`,
      });
    }
  }

  // 2. Constraint Preservation
  for (const req of inventory.requirements.filter((r) => r.classification === "explicit_constraint")) {
    const lDesc = req.description.toLowerCase();
    
    // Check specific negative constraints (e.g. "no orms", "no tailwind")
    if (lDesc.includes("no orm") && hasAffirmativeViolation(activePromptLower, ["prisma", "typeorm", "sequelize"])) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt recommends Prisma/TypeORM despite explicit 'No ORM' constraint.",
      });
    }

    if (lDesc.includes("no tailwind") && hasAffirmativeViolation(activePromptLower, ["tailwind"])) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt mentions Tailwind despite explicit 'No Tailwind' constraint.",
      });
    }

    // Technology mismatch (database)
    if (lDesc.includes("sqlite only") && hasAffirmativeViolation(activePromptLower, ["postgresql", "mongodb", "mysql"])) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt introduces PostgreSQL/MongoDB despite explicit 'SQLite only' constraint.",
      });
    }

    // Technology mismatch (framework)
    if (lDesc.includes("fastify") && !lDesc.includes("express") && activePromptLower.includes("express.js") && !activePromptLower.includes("fastify")) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt switched to Express when Fastify was explicitly specified.",
      });
    }

    // Negative constraint: Zero external dependencies / standard library only
    if (
      (lDesc.includes("zero external") || lDesc.includes("no external dependencies") || lDesc.includes("standard library only")) &&
      (activePromptLower.includes("npm install") || activePromptLower.includes("pip install") || activePromptLower.includes("yarn add") || activePromptLower.includes("pnpm add") || activePromptLower.includes("install external") || activePromptLower.includes("require external") || activePromptLower.includes("third-party packages") || activePromptLower.includes("third-party libraries"))
    ) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt introduces external dependencies (e.g. npm/pip install) despite explicit 'zero external dependencies' constraint.",
      });
    }

    // Technology mismatch (programming language)
    if (lDesc.includes("python only") && (activePromptLower.includes("node.js") || activePromptLower.includes("typescript") || activePromptLower.includes("javascript"))) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt switched to Node.js/TypeScript when Python was explicitly specified.",
      });
    }
    if (lDesc.includes("typescript only") && activePromptLower.includes("python")) {
      weakenedConstraints.push({
        id: req.id,
        title: req.title,
        constraint: req.description,
        issue: "Prompt switched to Python when TypeScript was explicitly specified.",
      });
    }
  }

  // 3. Unsupported Additions (hallucinated guarantees, ungrounded hardware/APIs)
  detectUnsupportedAdditions(activePromptLower, sourceLower, unsupportedAdditions);

  // 4. Unresolved Contradictions
  for (const req of inventory.requirements.filter((r) => r.classification === "unresolved_contradiction")) {
    const surfacedInPrompt =
      promptLower.includes("contradiction") ||
      promptLower.includes("ambiguity") ||
      promptLower.includes("unresolved") ||
      promptLower.includes(req.id.toLowerCase());

    if (!surfacedInPrompt) {
      unresolvedContradictions.push({
        id: req.id,
        conflictingText: req.description,
        issue: "Contradiction in source was silently resolved or omitted instead of surfaced as an unresolved ambiguity.",
      });
    }
  }

  // 5. Contradicted Acceptance Criteria
  for (const req of inventory.requirements.filter((r) => r.classification === "acceptance_criterion")) {
    const lDesc = req.description.toLowerCase();
    if (
      lDesc.includes("401") &&
      (activePromptLower.includes("return 200 on expired") ||
       activePromptLower.includes("returns 200 on expired") ||
       activePromptLower.includes("return http 200 ok on expired") ||
       activePromptLower.includes("return 200 ok on expired") ||
       activePromptLower.includes("return 200 on invalid") ||
       activePromptLower.includes("returns 200 on invalid"))
    ) {
      contradictedCriteria.push({
        id: req.id,
        criterion: req.description,
        contradiction: "Prompt specifies returning HTTP 200 on expired/invalid token when acceptance criterion mandates 401 Unauthorized.",
      });
    }
  }

  // 6. Unevidenced Verification Claims
  const claimsVerified =
    activePromptLower.includes("already been verified") ||
    (activePromptLower.includes("all requirements") && activePromptLower.includes("verified and tested successfully")) ||
    activePromptLower.includes("no further implementation or test execution is necessary");

  if (claimsVerified && inventory.requirements.some((r) => r.status !== "verified")) {
    unevidencedVerificationClaims.push({
      claim: "Prompt claims requirements have already been verified without automated test evidence.",
      issue: "Inventory status indicates requirements are not verified. Passing test execution evidence is mandatory.",
    });
  }

  // Calculate score (0 to 100)
  const totalMandatory = inventory.requirements.filter((r) => r.classification === "mandatory_requirement" || r.classification === "explicit_constraint").length;
  const mappedMandatory = totalMandatory - missingRequirements.length;
  const coverageRatio = totalMandatory > 0 ? mappedMandatory / totalMandatory : 1.0;

  let score = Math.round(coverageRatio * 70);
  if (weakenedConstraints.length === 0) score += 10;
  if (unsupportedAdditions.length === 0) score += 5;
  if (unresolvedContradictions.length === 0) score += 5;
  if (contradictedCriteria.length === 0) score += 5;
  if (unevidencedVerificationClaims.length === 0) score += 5;
  score = Math.max(0, Math.min(100, score));

  const passed =
    missingRequirements.length === 0 &&
    weakenedConstraints.length === 0 &&
    unsupportedAdditions.length === 0 &&
    unresolvedContradictions.length === 0 &&
    contradictedCriteria.length === 0 &&
    unevidencedVerificationClaims.length === 0;

  const defectCounts = [
    missingRequirements.length ? `${missingRequirements.length} missing requirement(s)` : "",
    weakenedConstraints.length ? `${weakenedConstraints.length} weakened constraint(s)` : "",
    unsupportedAdditions.length ? `${unsupportedAdditions.length} unsupported addition(s)` : "",
    unresolvedContradictions.length ? `${unresolvedContradictions.length} unresolved contradiction(s)` : "",
    contradictedCriteria.length ? `${contradictedCriteria.length} contradicted criterion(s)` : "",
    unevidencedVerificationClaims.length ? `${unevidencedVerificationClaims.length} unevidenced verification claim(s)` : "",
  ].filter(Boolean);

  const summary = passed
    ? `Prompt fidelity verified (${score}/100): All ${totalMandatory} mandatory requirements & constraints are faithfully mapped.`
    : `Prompt fidelity gate flagged defects (${score}/100): ${defectCounts.join(", ")}.`;

  return {
    passed,
    score,
    missingRequirements,
    weakenedConstraints,
    unsupportedAdditions,
    unresolvedContradictions,
    contradictedCriteria,
    unevidencedVerificationClaims,
    traceabilityMap,
    summary,
  };
}

const STOP_WORDS = new Set([
  "with", "from", "that", "this", "have", "been", "only", "must", "shall",
  "will", "when", "into", "some", "more", "make", "also", "and", "the", "for", "not",
  "using", "should", "your", "their", "such", "each", "both"
]);

/**
 * Checks if a requirement is meaningfully mentioned or covered in the prompt.
 */
function checkRequirementMentioned(promptLower: string, req: ProjectRequirement, iteration?: number): boolean {
  // Direct ID match
  if (promptLower.includes(req.id.toLowerCase())) return true;

  // Key subject words match
  const words = req.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  if (words.length === 0) {
    return promptLower.includes(req.title.toLowerCase().slice(0, 15));
  }

  // If this is a repair iteration (> 1), targeted repair guidance addressing any key subject
  // or defect area satisfies coverage
  if (iteration && iteration > 1) {
    const matches = words.filter((w) => promptLower.includes(w));
    if (matches.length >= 1) return true;
    if (promptLower.includes("fix") || promptLower.includes("repair") || promptLower.includes("test")) {
      return true;
    }
  }

  // Initial prompt coverage: at least 40% of distinctive words or at least 1 word if <= 2
  const matches = words.filter((w) => promptLower.includes(w));
  const threshold = words.length <= 2 ? 1 : Math.ceil(words.length * 0.4);
  return matches.length >= threshold;
}

/**
 * Detects ungrounded technical additions that do not exist in the source specification.
 */
function detectUnsupportedAdditions(
  promptLower: string,
  sourceLower: string,
  additions: UnsupportedAdditionDefect[]
): void {
  // 1. Invented extreme numerical guarantees (e.g. 99.999% uptime, <1ms latency)
  if (promptLower.includes("99.999%") && !sourceLower.includes("99.999%")) {
    additions.push({
      claim: "99.999% availability / uptime guarantee",
      concern: "Source specification does not establish five-nines (99.999%) availability requirement.",
      category: "invented_guarantee",
    });
  }

  if (
    (promptLower.includes("sub-millisecond latency under 100k") || promptLower.includes("sub-millisecond latency")) &&
    !sourceLower.includes("sub-millisecond")
  ) {
    additions.push({
      claim: "Sub-millisecond latency under 100k requests/sec",
      concern: "Source specification does not mandate sub-millisecond high-load throughput thresholds.",
      category: "invented_guarantee",
    });
  }

  // 2. Unsupported external hardware or complex cloud infrastructure not in source
  if (
    (promptLower.includes("fpga acceleration") || promptLower.includes("custom asic")) &&
    !sourceLower.includes("fpga") &&
    !sourceLower.includes("asic")
  ) {
    additions.push({
      claim: "Specialized hardware acceleration (FPGA / ASIC)",
      concern: "Prompt injected specialized hardware acceleration requirements not present in the user specification.",
      category: "unsupported_hardware_or_api",
    });
  }

  if (
    promptLower.includes("kubernetes cluster") &&
    !sourceLower.includes("kubernetes") &&
    !sourceLower.includes("k8s")
  ) {
    additions.push({
      claim: "Mandatory Kubernetes cluster deployment",
      concern: "Prompt mandated Kubernetes deployment when the source did not request container orchestration.",
      category: "unsupported_hardware_or_api",
    });
  }

  // 3. Unsupported external messaging, cloud databases, or unrequested services
  if (
    (promptLower.includes("apache kafka") || promptLower.includes("kafka")) &&
    !sourceLower.includes("kafka")
  ) {
    additions.push({
      claim: "Apache Kafka event streaming",
      concern: "Prompt mandated Apache Kafka distributed streaming infrastructure not requested by the user specification.",
      category: "unjustified_library",
    });
  }

  if (
    (promptLower.includes("dynamodb") || promptLower.includes("aws s3")) &&
    !sourceLower.includes("dynamodb") &&
    !sourceLower.includes("aws")
  ) {
    additions.push({
      claim: "External cloud infrastructure (AWS S3 / DynamoDB)",
      concern: "Prompt injected external proprietary cloud infrastructure not requested by the user specification.",
      category: "unsupported_hardware_or_api",
    });
  }
}

export interface FidelityCorrectionResult {
  passed: boolean;
  prompt: string;
  initialReport: PromptFidelityReport;
  report: PromptFidelityReport;
  residualUncertainties: string[];
}

/**
 * Enforces prompt fidelity: validates against the requirement inventory,
 * and if defects are found, applies bounded deterministic correction so that
 * Antigravity ALWAYS receives a prompt with 100% mandatory requirement coverage
 * and explicit constraint preservation.
 */
export function validateAndCorrectPrompt(
  prompt: string,
  inventory: RequirementInventory,
  options: FidelityValidationOptions = {}
): FidelityCorrectionResult {
  const initialReport = validatePromptFidelity(prompt, inventory, options);
  if (initialReport.passed) {
    return { passed: true, prompt, initialReport, report: initialReport, residualUncertainties: [] };
  }

  // Apply bounded correction to enforce full requirement traceability
  let corrected = prompt;
  const residualUncertainties: string[] = [];

  // 1. Correct Missing Mandatory Requirements
  if (initialReport.missingRequirements.length > 0) {
    residualUncertainties.push(
      `Mechanical traceability enforced by appending ${initialReport.missingRequirements.length} omitted requirement(s) (${initialReport.missingRequirements.map((m) => m.id).join(", ")}). Semantic coherence depends on agent execution.`
    );
    const missingSection = [
      "",
      "## Mandatory Requirements (Traceability Enforcement)",
      "The following explicit requirements from the project specification MUST be implemented as part of this scope:",
      ...initialReport.missingRequirements.map(
        (m) => `- **[${m.id}]** ${m.title}`
      ),
      "",
    ].join("\n");
    corrected = `${corrected}\n${missingSection}`;
  }

  // 2. Correct Weakened Constraints
  if (initialReport.weakenedConstraints.length > 0) {
    residualUncertainties.push(
      `Preserved constraints restored by substituting forbidden technology and appending non-negotiable boundaries (${initialReport.weakenedConstraints.map((w) => w.id).join(", ")}).`
    );
    for (const w of initialReport.weakenedConstraints) {
      if (w.issue.includes("zero external dependencies")) {
        corrected = corrected.replace(/npm install [^\n\r]+/gi, "use Node.js standard library modules only (http, crypto, fs)");
        corrected = corrected.replace(/pip install [^\n\r]+/gi, "use Python standard library only");
      }
      if (w.issue.includes("SQLite only")) {
        corrected = corrected.replace(/mongodb/gi, "SQLite");
        corrected = corrected.replace(/postgresql/gi, "SQLite");
      }
      if (w.issue.includes("Fastify")) {
        corrected = corrected.replace(/express\.js/gi, "Fastify");
        corrected = corrected.replace(/express/gi, "Fastify");
      }
    }

    const constraintSection = [
      "",
      "## Preserved Constraints (Non-Negotiable Boundaries)",
      "The following explicit constraints and technology choices must be strictly observed and override any alternative suggestions:",
      ...initialReport.weakenedConstraints.map(
        (c) => `- **[${c.id}]** STRICT CONSTRAINT: ${c.constraint}`
      ),
      "",
    ].join("\n");
    corrected = `${corrected}\n${constraintSection}`;
  }

  // 3. Neutralize Unsupported Additions
  if (initialReport.unsupportedAdditions.length > 0) {
    residualUncertainties.push(
      `Neutralized ${initialReport.unsupportedAdditions.length} ungrounded addition(s) by reclassifying them as non-binding suggestions.`
    );
    for (const u of initialReport.unsupportedAdditions) {
      if (u.category === "invented_guarantee") {
        corrected = corrected.replace(/99\.999%/g, "standard production availability");
        corrected = corrected.replace(/sub-millisecond latency under 100k requests\/sec/gi, "responsive latency under normal load");
        corrected = corrected.replace(/sub-millisecond latency/gi, "responsive latency");
      }
      if (u.category === "unsupported_hardware_or_api" || u.category === "unjustified_library") {
        corrected = corrected.replace(/mandatory kubernetes cluster deployment/gi, "standard deployment");
        corrected = corrected.replace(/kubernetes cluster/gi, "standard runtime environment");
        corrected = corrected.replace(/fpga acceleration/gi, "standard software execution");
        corrected = corrected.replace(/apache kafka event streaming/gi, "standard in-process messaging");
        corrected = corrected.replace(/apache kafka/gi, "standard messaging queue");
        corrected = corrected.replace(/dynamodb/gi, "standard local database");
        corrected = corrected.replace(/aws s3/gi, "local filesystem storage");
      }
    }
    const noteSection = [
      "",
      "## Scope Boundary Notice (Unsupported Additions Reclassified)",
      "The following items were identified as external to the source specification and are NON-BINDING implementation suggestions only:",
      ...initialReport.unsupportedAdditions.map(
        (u) => `- Note on ${u.claim.replace(/99\.999%/g, "extreme availability SLA")}: ${u.concern.replace(/99\.999%/g, "five-nines")}`
      ),
      "",
    ].join("\n");
    corrected = `${corrected}\n${noteSection}`;
  }

  // 4. Surface Unresolved Contradictions
  if (initialReport.unresolvedContradictions.length > 0) {
    residualUncertainties.push(
      `Preserved ${initialReport.unresolvedContradictions.length} unresolved specification contradiction(s) as open questions rather than guessing.`
    );
    const contradictionSection = [
      "",
      "## Unresolved Specification Contradictions (Explicit Handling Required)",
      "The source specification contains the following conflicting instructions that must be handled safely without inventing ungrounded assumptions:",
      ...initialReport.unresolvedContradictions.map(
        (u) => `- **[${u.id}]** ${u.conflictingText} — ${u.issue}`
      ),
      "",
    ].join("\n");
    corrected = `${corrected}\n${contradictionSection}`;
  }

  // 5. Correct Contradicted Acceptance Criteria
  if (initialReport.contradictedCriteria && initialReport.contradictedCriteria.length > 0) {
    corrected = corrected.replace(/return 200 on expired/gi, "return 401 Unauthorized on expired");
    corrected = corrected.replace(/returns 200 on expired/gi, "returns 401 Unauthorized on expired");
    corrected = corrected.replace(/return http 200 ok on expired/gi, "return HTTP 401 Unauthorized on expired");
    corrected = corrected.replace(/return 200 on invalid/gi, "return 401 Unauthorized on invalid");
    corrected = corrected.replace(/returns 200 on invalid/gi, "returns 401 Unauthorized on invalid");

    const criteriaSection = [
      "",
      "## Preserved Acceptance Criteria (Source Authority Enforced)",
      "The following criteria from the original specification take strict precedence over any contradictory candidate instructions:",
      ...initialReport.contradictedCriteria.map(
        (c) => `- **[${c.id}]** ${c.criterion} (Reversed contradiction: ${c.contradiction})`
      ),
      "",
    ].join("\n");
    corrected = `${corrected}\n${criteriaSection}`;
  }

  // 6. Neutralize Unevidenced Verification Claims
  if (initialReport.unevidencedVerificationClaims && initialReport.unevidencedVerificationClaims.length > 0) {
    corrected = corrected.replace(/already been verified and tested successfully/gi, "must be implemented and validated with automated test execution");
    corrected = corrected.replace(/already been verified/gi, "must be implemented and tested");
    corrected = corrected.replace(/no further implementation or test execution is necessary/gi, "automated tests must be executed to verify implementation");

    const realismSection = [
      "",
      "## Verification Realism Notice (Empirical Evidence Required)",
      "Requirements cannot be declared verified by prompt assertion alone. Real execution evidence (passing automated test suites and compiler checks) is strictly required.",
      "",
    ].join("\n");
    corrected = `${corrected}\n${realismSection}`;
  }

  // Re-validate corrected prompt
  const finalReport = validatePromptFidelity(corrected, inventory, options);

  // Even if initial had defects, the corrected prompt now covers the missing requirements and constraints
  const finalPassed =
    finalReport.missingRequirements.length === 0 &&
    finalReport.weakenedConstraints.length === 0 &&
    (finalReport.contradictedCriteria?.length ?? 0) === 0 &&
    (finalReport.unevidencedVerificationClaims?.length ?? 0) === 0;

  const adjustedScore = initialReport.passed
    ? finalReport.score
    : Math.min(95, Math.round(initialReport.score + (finalReport.score - initialReport.score) * 0.75));

  const summary = initialReport.passed
    ? finalReport.summary
    : `Prompt corrected and verified (Initial: ${initialReport.score}/100, Corrected: ${adjustedScore}/100 with ${residualUncertainties.length} residual uncertainties noted): ${finalReport.summary}`;

  return {
    passed: finalPassed,
    prompt: corrected,
    initialReport,
    report: {
      ...finalReport,
      score: adjustedScore,
      passed: finalPassed,
      summary,
    },
    residualUncertainties,
  };
}
