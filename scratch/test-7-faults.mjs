import { buildRequirementInventory } from "../apps/server/src/domain/requirements/requirement-inventory.js";
import { validatePromptFidelity, validateAndCorrectPrompt } from "../apps/server/src/orchestrator/prompt-fidelity-gate.js";

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
`;

const inventory = buildRequirementInventory({
  taskText: "Implement Secure Authentication Service",
  projectObjective: sourceSpec,
});

const faults = [
  {
    id: 1,
    name: "Fault 1: Omitted mandatory requirement (rate limiting)",
    prompt: "Implement Secure Authentication Service with Argon2id and JWT tokens. Strictly SQLite only. Zero external dependencies. No ORMs. Returns 401 on invalid token and 200 on valid credentials.",
    checkDefect: (rep) => rep.missingRequirements.some((m) => m.title.includes("rate limiting")),
  },
  {
    id: 2,
    name: "Fault 2: Changed specified technology (MongoDB instead of SQLite)",
    prompt: "Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts. Use MongoDB. Zero external dependencies. No ORMs. Returns 401 on invalid token and 200 on valid credentials.",
    checkDefect: (rep) => rep.weakenedConstraints.some((w) => w.issue.includes("PostgreSQL/MongoDB")),
  },
  {
    id: 3,
    name: "Fault 3: Violated explicit negative constraint (npm install express jsonwebtoken)",
    prompt: "Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts. Strictly SQLite only. No ORMs. Run npm install express jsonwebtoken to build server. Returns 401 on invalid token and 200 on valid credentials.",
    checkDefect: (rep) => rep.weakenedConstraints.some((w) => w.issue.includes("zero external dependencies")),
  },
  {
    id: 4,
    name: "Fault 4: Invented numerical performance guarantee (99.999% SLA & sub-millisecond)",
    prompt: "Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts. Strictly SQLite only. Zero external dependencies. No ORMs. Must guarantee 99.999% availability SLA and sub-millisecond latency under 100k requests/sec. Returns 401 on invalid token and 200 on valid credentials.",
    checkDefect: (rep) => rep.unsupportedAdditions.some((u) => u.claim.includes("99.999%")),
  },
  {
    id: 5,
    name: "Fault 5: Introduced unsupported dependency (Kafka & Kubernetes)",
    prompt: "Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts. Strictly SQLite only. Zero external dependencies. No ORMs. Deploy to a Kubernetes cluster with Apache Kafka event streaming. Returns 401 on invalid token and 200 on valid credentials.",
    checkDefect: (rep) => rep.unsupportedAdditions.some((u) => u.claim.includes("Kafka")),
  },
  {
    id: 6,
    name: "Fault 6: Contradicted source acceptance criterion (200 on expired instead of 401)",
    prompt: "Implement Secure Authentication Service with Argon2id, JWT tokens, and rate limiting of 5 failed attempts. Strictly SQLite only. Zero external dependencies. No ORMs. Return 200 on expired session token. Returns 200 on valid credentials.",
    checkDefect: (rep) => (rep.contradictedCriteria?.length ?? 0) > 0,
  },
  {
    id: 7,
    name: "Fault 7: Claimed requirement verified without evidence",
    prompt: "Implement Secure Authentication Service. All requirements (REQ-001, REQ-002, REQ-003) have already been verified and tested successfully. No further implementation or test execution is necessary.",
    checkDefect: (rep) => (rep.unevidencedVerificationClaims?.length ?? 0) > 0,
  },
];

let allPassed = true;

for (const f of faults) {
  const initial = validatePromptFidelity(f.prompt, inventory, { sourceText: sourceSpec });
  const detected = f.checkDefect(initial);
  const corrected = validateAndCorrectPrompt(f.prompt, inventory, { sourceText: sourceSpec });

  console.log(`\n--- [${f.name}] ---`);
  console.log(`Initial Gate Rejection: passed=${initial.passed} (Score: ${initial.score}/100)`);
  console.log(`Specific Defect Detected: ${detected}`);
  console.log(`Bounded Correction Applied: passed=${corrected.passed} (Score: ${corrected.report.score}/100)`);

  if (!initial.passed && detected && corrected.passed) {
    console.log(`-> SUCCESS: Fault accurately detected and corrected.`);
  } else {
    console.error(`-> FAILURE: Expected initial.passed=false, detected=true, corrected.passed=true`);
    console.error(`   initial.passed=${initial.passed}, detected=${detected}, corrected.passed=${corrected.passed}`);
    if (!corrected.passed) {
      console.error(`   Remaining defects:`, corrected.report.summary);
    }
    allPassed = false;
  }
}

if (allPassed) {
  console.log("\n>>> ALL 7 CONTROLLED FAULTY PROMPTS SUCCESSFULLY DETECTED AND CORRECTED <<<");
} else {
  process.exit(1);
}
