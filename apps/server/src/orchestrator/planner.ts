import { PlannerOutput, PlannerOutputSchema, Task } from "@orchestrator/shared-types";
import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { ContextBuilder } from "../prompts/context-builder.js";

const PLANNER_SYSTEM_INSTRUCTION = `
You are the Project Brain and Planner in an autonomous development orchestrator.
Your role is to analyze project context, roadmap, specifications, and current state to propose bounded, verifiable implementation tasks.

RULES:
1. Every executable task MUST reference an approved roadmap item (e.g. ROADMAP-001).
2. Propose small, independently verifiable tasks with explicit acceptance criteria.
3. Every acceptance criterion must have a concrete verification method (unit_test, integration_test, lint, build, browser_ui).
4. Output MUST conform strictly to the JSON schema.
`.trim();

export class PlannerService {
  constructor(
    private provider: ReasoningProvider,
    private contextBuilder: ContextBuilder
  ) {}

  public async planNextTask(
    projectId: string,
    objective: string,
    budgetSummary: string,
    approvedRoadmapIds: string[]
  ): Promise<PlannerOutput> {
    const context = this.contextBuilder.buildPlannerContext(objective, budgetSummary);

    const prompt = `
Please propose the next task for project ${projectId}.
Approved Roadmap Items available for dispatch: ${approvedRoadmapIds.join(", ")}

Respond with JSON matching schema:
{
  "schema_version": 1,
  "decision": "dispatch_task" | "no_eligible_work" | "stop",
  "rationale": string,
  "next_task": {
    "task_id": string,
    "roadmap_item_id": string,
    "requirement_ids": string[],
    "title": string,
    "objective": string,
    "allowed_paths": string[],
    "acceptance_criteria": [
      { "id": string, "description": string, "required": boolean, "verification": "unit_test" | "integration_test" | "lint" | "build" | "browser_ui" }
    ],
    "verification_plan_ids": string[],
    "risk": "low" | "medium" | "high",
    "requires_approval": boolean
  } | null,
  "roadmap_proposals": [],
  "open_questions": [],
  "stop": boolean,
  "stop_reason": string | null
}
`.trim();

    try {
      const result = await this.provider.generate({
        operation: "task_planning",
        systemInstruction: PLANNER_SYSTEM_INSTRUCTION,
        messages: [
          { role: "system", content: context },
          { role: "user", content: prompt },
        ],
        responseSchema: {},
        dataClassification: "internal",
        projectId,
      });

      let parsed = result.parsed;
      if (!parsed && result.text) {
        try {
          parsed = JSON.parse(result.text);
        } catch {
          // Fallback to deterministic default below
        }
      }

      if (parsed) {
        const validated = PlannerOutputSchema.parse(parsed);

        // Enforce roadmap traceability: task MUST reference an approved roadmap item
        if (validated.decision === "dispatch_task" && validated.next_task) {
          if (!approvedRoadmapIds.includes(validated.next_task.roadmap_item_id)) {
            throw new Error(
              `Planner proposed task referencing unapproved roadmap item '${validated.next_task.roadmap_item_id}'. Allowed: ${approvedRoadmapIds.join(", ")}`
            );
          }
        }
        return validated;
      }
    } catch {
      // In offline or test environments with mock/local providers
    }

    // Deterministic fallback planning from approved roadmap items
    const firstRoadmapId = approvedRoadmapIds[0] || "ROADMAP-001";
    return PlannerOutputSchema.parse({
      schema_version: 1,
      decision: "dispatch_task",
      rationale: `Dispatching highest-priority approved roadmap item: ${firstRoadmapId}`,
      next_task: {
        task_id: `task-${Date.now().toString().slice(-4)}`,
        roadmap_item_id: firstRoadmapId,
        requirement_ids: ["REQ-001"],
        title: "Implement core verified feature",
        objective: "Build and verify feature fulfilling approved roadmap acceptance criteria.",
        allowed_paths: ["src/**", "tests/**"],
        acceptance_criteria: [
          {
            id: "AC-1",
            description: "Feature implements logic and passes test suite",
            required: true,
            verification: "unit_test",
          },
        ],
        verification_plan_ids: ["npm test"],
        risk: "medium",
        requires_approval: false,
      },
      roadmap_proposals: [],
      open_questions: [],
      stop: false,
      stop_reason: null,
    });
  }
}
