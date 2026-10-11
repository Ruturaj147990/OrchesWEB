import fs from "node:fs";
import { buildRequirementInventory } from "../apps/server/src/domain/requirements/requirement-inventory.js";
import { synthesizeSubstantiveBrief } from "../apps/server/src/orchestrator/instructor.js";

const blueprintPath = "Autonomous_Development_Orchestrator_MVP_Blueprint_FINAL.md";
const blueprintText = fs.readFileSync(blueprintPath, "utf8");

const inventory = buildRequirementInventory({
  taskText: "Implement Milestone 1: Foundation & Workspace Snapshots",
  projectObjective: blueprintText,
});

console.log(`Total requirements extracted: ${inventory.summary.total}`);
console.log(`Mandatory: ${inventory.summary.mandatory}, Constraints: ${inventory.summary.constraints}`);
console.log(`Phases discovered:`, inventory.summary.phases);

const dummyProfile = {
  isEmpty: false,
  fileCount: 10,
  languages: ["typescript"],
  checks: [{ id: "c1", label: "npm test", command: "npm test", source: "package.json" }],
  notes: [],
};

const brief = synthesizeSubstantiveBrief({
  projectId: "p-test",
  runId: "r-test",
  taskText: "Implement Milestone 1: Foundation & Workspace Snapshots",
  criteria: ["Workspace snapshots take clean Git commit points"],
  profile: dummyProfile,
  files: ["package.json"],
  iteration: 1,
  maxIterations: 5,
  history: [],
}, inventory);

console.log(`Generated brief length: ${brief.length} characters`);
console.log(`Contains Specification Volume Notice: ${brief.includes("Specification Volume Notice")}`);
console.log(`Contains Phased Implementation Roadmap: ${brief.includes("Phased Implementation Roadmap")}`);
console.log(`Contains Active Scope Milestone 1: ${brief.includes("Milestone 1")}`);
console.log(`Contains preserved constraints: ${brief.includes("STRICT CONSTRAINT")}`);
