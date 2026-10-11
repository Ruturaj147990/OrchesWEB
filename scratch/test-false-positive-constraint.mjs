import { validatePromptFidelity } from "../apps/server/dist/orchestrator/prompt-fidelity-gate.js";

const inventory = {
  requirements: [
    {
      id: "REQ-001",
      title: "No ORMs (no Prisma, TypeORM, or Sequelize)",
      description: "No ORMs (no Prisma, TypeORM, or Sequelize)",
      classification: "explicit_constraint",
      importance: "critical",
      sourceReference: "Spec",
      status: "not_started"
    }
  ],
  summary: { total: 1, mandatory: 0, constraints: 1, optional: 0, acceptanceCriteria: 0, inferences: 0, contradictions: 0, phases: [], byStatus: {} }
};

// Prompt faithfully enforcing the constraint:
const promptFaithful = `
# Engineering Brief
## Constraints
- STRICT CONSTRAINT: No ORMs (no Prisma, TypeORM, or Sequelize). Use raw SQLite queries.
`;

const report = validatePromptFidelity(promptFaithful, inventory);
console.log("Passed:", report.passed);
console.log("Score:", report.score);
console.log("Weakened constraints flagged:", report.weakenedConstraints);
