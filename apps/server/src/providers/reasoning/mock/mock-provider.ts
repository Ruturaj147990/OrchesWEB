import { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import { PrivacyClass } from "@orchestrator/shared-types";

export interface MockReasoningOptions {
  customPlannerOutput?: Record<string, unknown>;
  customCriticVerdict?: "accept" | "repair" | "reject_out_of_scope";
  delayMs?: number;
}

export class MockReasoningProvider implements ReasoningProvider {
  public id = "mock-reasoning";
  public displayName = "Deterministic Mock Reasoning Provider";
  public privacyClass: PrivacyClass = "local";

  constructor(private options: MockReasoningOptions = {}) {}

  public setOptions(opts: MockReasoningOptions): void {
    this.options = { ...this.options, ...opts };
  }

  public async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      status: "ready",
      latencyMs: 1,
      discoveredModels: ["mock-deterministic-v1"],
      message: "Mock reasoning engine active.",
    };
  }

  public async listModels(): Promise<string[]> {
    return ["mock-deterministic-v1"];
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (this.options.delayMs) {
      await new Promise((res) => setTimeout(res, this.options.delayMs));
    }
    if (signal?.aborted) {
      throw new Error("Task execution cancelled by abort signal");
    }

    const start = Date.now();
    let text = "";
    let parsed: any = null;

    if (request.operation === "result_review") {
      const fullText = request.messages?.map((m) => m.content).join(" ") || "";
      const isFailedPrompt = fullText.includes("FAILED CHECKS PRESENT");
      const verdict = this.options.customCriticVerdict || (isFailedPrompt ? "repair" : "accept");
      parsed = {
        schema_version: 1,
        task_id: request.taskId || "task-01",
        attempt_id: "att-01",
        verdict,
        criteria: [
          {
            criterion_id: "AC-1",
            status: verdict === "accept" ? "passed" : "failed",
            evidence_ids: ["verif-1"],
            reason: verdict === "accept" ? "Evidence verified by tests." : "Tests failed.",
          },
        ],
        scope_drift: { detected: false, details: [] },
        quality_findings: [],
        missing_evidence: [],
        repair_instructions: verdict === "accept" ? [] : ["Fix failing assertion"],
        rationale: verdict === "accept" ? "All criteria passed." : "Verification failed.",
      };
      text = JSON.stringify(parsed);
    } else {
      // Default planning or analysis
      parsed = this.options.customPlannerOutput || {
        schema_version: 1,
        decision: "dispatch_task",
        rationale: "Fulfill planned requirements",
        next_task: {
          task_id: request.taskId || "task-planned-01",
          roadmap_item_id: "ROADMAP-001",
          requirement_ids: ["REQ-001"],
          title: "Implement core verified feature",
          objective: "Build and verify feature fulfilling approved roadmap acceptance criteria.",
          allowed_paths: ["*", "**/*"],
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
      };
      text = JSON.stringify(parsed);
    }

    return {
      text,
      parsed,
      providerId: this.id,
      modelId: "mock-deterministic-v1",
      usage: {
        inputTokens: 100,
        outputTokens: 150,
        totalTokens: 250,
      },
      durationMs: Date.now() - start,
      warnings: [],
    };
  }
}
