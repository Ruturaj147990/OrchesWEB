import { buildRequirementInventory } from "../apps/server/dist/domain/requirements/requirement-inventory.js";
import { RequirementExtractor } from "../apps/server/dist/domain/blueprints/requirement-extractor.js";
import { BlueprintImporter } from "../apps/server/dist/domain/blueprints/importer.js";

// Independent reference checklist: 20 specific items of varying types
const REFERENCE_CHECKLIST = [
  // Distributed functional requirements
  { refId: "CHK-001", type: "mandatory", text: "Multi-Tenant Topic Partitioning for isolated streams", section: "Architecture" },
  { refId: "CHK-002", type: "mandatory", text: "POST /api/v1/events accepting eventId and payload", section: "Ingestion" },
  { refId: "CHK-003", type: "mandatory", text: "Message Deduplication within 10-minute sliding window", section: "Ingestion" },
  { refId: "CHK-004", type: "mandatory", text: "GET /api/v1/events/poll with cursor pagination", section: "Consumption" },
  { refId: "CHK-005", type: "mandatory", text: "Long-polling timeout support for empty queue", section: "Consumption" },
  { refId: "CHK-006", type: "mandatory", text: "Cryptographic Audit Trail with rolling SHA-256 hash", section: "Audit" },
  { refId: "CHK-007", type: "mandatory", text: "GET /api/v1/health returning broker status and queue depth", section: "Operations" },
  
  // Negative constraints
  { refId: "CHK-008", type: "constraint", text: "Strictly SQLite only; do not introduce external database servers", section: "Constraints" },
  { refId: "CHK-009", type: "constraint", text: "Zero external dependencies: use Node.js standard library only", section: "Constraints" },
  { refId: "CHK-010", type: "constraint", text: "No ORMs (no Prisma, TypeORM, or Sequelize)", section: "Constraints" },
  { refId: "CHK-011", type: "constraint", text: "Never log raw event payloads or secret credentials", section: "Constraints" },
  { refId: "CHK-012", type: "constraint", text: "Port: Broker must bind exclusively to port 4000", section: "Constraints" },

  // Dependencies between requirements
  { refId: "CHK-013", type: "dependency", text: "Consumer Polling depends on Topic Partitioning", section: "Dependencies" },
  { refId: "CHK-014", type: "dependency", text: "Rolling SHA-256 hash requires Ingestion Sequence", section: "Dependencies" },

  // Optional features
  { refId: "CHK-015", type: "optional", text: "Optional: Webhook notification on dead-letter queue spill", section: "Optional" },
  { refId: "CHK-016", type: "optional", text: "Nice to have: Prometheus metrics export format", section: "Optional" },

  // Contradictory instructions
  { refId: "CHK-017", type: "contradiction", text: "Must use PostgreSQL for high-volume partition storage", section: "Contradictions" },
  
  // Acceptance criteria
  { refId: "CHK-018", type: "criterion", text: "Assert that duplicate eventIds within 10 minutes return HTTP 409", section: "Acceptance" },
  { refId: "CHK-019", type: "criterion", text: "Verify that invalid tenant signatures return HTTP 401 Unauthorized", section: "Acceptance" },
  { refId: "CHK-020", type: "criterion", text: "Verify that poll returns events in strictly chronological order", section: "Acceptance" },
];

const testSpec = `
# Event Broker Specification

## Architecture
- Must support Multi-Tenant Topic Partitioning for isolated streams.
- Storage engine: SQLite only in WAL mode.

## Ingestion
- Must implement POST /api/v1/events accepting eventId and payload.
- Must enforce Message Deduplication within 10-minute sliding window.

## Consumption
- Must implement GET /api/v1/events/poll with cursor pagination.
- Must provide Long-polling timeout support for empty queue.

## Audit
- Must compute Cryptographic Audit Trail with rolling SHA-256 hash.

## Operations
- Endpoint: GET /api/v1/health returning broker status and queue depth.

## Constraints
- Strictly SQLite only; do not introduce external database servers.
- Zero external dependencies: use Node.js standard library only.
- No ORMs (no Prisma, TypeORM, or Sequelize).
- Never log raw event payloads or secret credentials.
- Rules: Port 4000 must be used exclusively.

## Dependencies
- Consumer Polling depends on Topic Partitioning.
- Rolling SHA-256 hash requires Ingestion Sequence.

## Optional Enhancements
- Optional: Webhook notification on dead-letter queue spill.
- Nice to have: Prometheus metrics export format.

## Contradictions
- Must use PostgreSQL for high-volume partition storage.

## Acceptance Criteria
- Assert that duplicate eventIds within 10 minutes return HTTP 409.
- Verify that invalid tenant signatures return HTTP 401 Unauthorized.
- Verify that poll returns events in strictly chronological order.
`;

console.log("=== Independent Requirement Extraction Audit ===");
const inventory = buildRequirementInventory({
  taskText: "Implement Event Broker",
  projectObjective: testSpec,
});

console.log(`Total Extracted Requirements: ${inventory.requirements.length}`);
console.log(`Summary:`, inventory.summary);
console.log("\nExtracted Requirements List:");
inventory.requirements.forEach(r => console.log(`${r.id} | ${r.classification.padEnd(25)} | ${r.title}`));

// Compare against reference checklist
let matchedCount = 0;
const results = [];

for (const chk of REFERENCE_CHECKLIST) {
  // Check if any requirement in inventory matches this checklist item
  const words = chk.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
  const match = inventory.requirements.find(r => {
    const rText = (r.title + " " + r.description).toLowerCase();
    const hitWords = words.filter(w => rText.includes(w));
    return hitWords.length >= Math.min(2, words.length);
  });

  const matched = !!match;
  if (matched) matchedCount++;

  results.push({
    refId: chk.refId,
    type: chk.type,
    text: chk.text,
    matched,
    extractedId: match?.id,
    extractedClassification: match?.classification,
    classificationCorrect: match ? (
      (chk.type === "mandatory" && match.classification === "mandatory_requirement") ||
      (chk.type === "constraint" && match.classification === "explicit_constraint") ||
      (chk.type === "optional" && match.classification === "optional_requirement") ||
      (chk.type === "criterion" && match.classification === "acceptance_criterion") ||
      (chk.type === "contradiction" && match.classification === "unresolved_contradiction") ||
      (chk.type === "dependency" && (match.classification === "mandatory_requirement" || match.classification === "explicit_constraint"))
    ) : false,
    sourceReference: match?.sourceReference,
  });
}

console.log("\nChecklist Coverage Matrix:");
for (const r of results) {
  const statusMark = r.matched ? (r.classificationCorrect ? "✓ PASS" : "⚠ WRONG CLASS") : "✗ MISSED";
  console.log(`[${r.refId}] ${statusMark} | Exp: ${r.type.padEnd(14)} | Got: ${(r.extractedClassification || "NONE").padEnd(25)} | ${r.text.slice(0, 50)}`);
}

console.log(`\nOverall Extraction Coverage: ${matchedCount}/${REFERENCE_CHECKLIST.length} (${(matchedCount/REFERENCE_CHECKLIST.length*100).toFixed(1)}%)`);
console.log(`Correct Classification Coverage: ${results.filter(r => r.classificationCorrect).length}/${REFERENCE_CHECKLIST.length} (${(results.filter(r => r.classificationCorrect).length/REFERENCE_CHECKLIST.length*100).toFixed(1)}%)`);

// Test Bounded Extraction in RequirementExtractor (large document test)
console.log("\n=== Testing Large Specification Bounded Extraction (RequirementExtractor) ===");
const importer = new BlueprintImporter();
const lines = ["# Large Enterprise Specification", "## Phase 1 Requirements"];
for (let i = 1; i <= 80; i++) {
  lines.push(`- Must implement Feature #${i} providing distributed capability and verified tests.`);
}
const largeDoc = importer.importFile("EnterpriseSpec.md", Buffer.from(lines.join("\n"), "utf8"));
const extractor = new RequirementExtractor();
const extractedLarge = extractor.extractFromDocument("proj-large", largeDoc);
console.log(`Input requirements: 80`);
console.log(`Extracted requirements: ${extractedLarge.length}`);
console.log(`Did it truncate at 50? ${extractedLarge.length === 50 ? "YES (DEFECT: Silently truncated 30 requirements)" : "NO"}`);
console.log(`Is there any truncation warning? ${largeDoc.warnings.length > 0 ? "YES" : "NO (Silent drop!)"}`);
