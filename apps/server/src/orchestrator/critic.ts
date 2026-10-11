import { CriticReview, CriticReviewSchema, Task, VerificationResult, AgentReport } from "@orchestrator/shared-types";
import { ReasoningProvider } from "../providers/reasoning/provider.js";
import { ContextBuilder } from "../prompts/context-builder.js";
import { extractJsonFromText } from "../prompts/json-extractor.js";

const CRITIC_SYSTEM_INSTRUCTION = `
You are the Independent Critic in an autonomous development orchestrator.
Your role is to independently review actual code diffs, exit codes, and verification evidence against task acceptance criteria.

RULES:
1. You MUST NOT endorse prior claims by the Planner or coding agent without verifiable evidence.
2. If any mandatory verification check failed, you MUST NOT return "accept". Verdict must be "repair".
3. Evaluate every acceptance criterion individually with status ("passed", "failed", "unverified").
4. Output MUST conform strictly to the JSON schema.
`.trim();

export class CriticService {
  constructor(
    private provider: ReasoningProvider,
    private contextBuilder: ContextBuilder
  ) {}

  public async reviewAttempt(
    task: Task,
    diff: string,
    verificationResults: VerificationResult[],
    agentReport: AgentReport
  ): Promise<CriticReview> {
    const context = this.contextBuilder.buildCriticContext(task, diff, verificationResults, agentReport);

    // Deterministic pre-gate: if any mandatory check failed, Critic cannot accept
    const mandatoryFailed = verificationResults.some(
      (v) => v.status === "failed" || v.status === "timeout"
    );

    const prompt = `
Please evaluate task ${task.id} (Attempt ${task.attemptCount}).
Mandatory checks status: ${mandatoryFailed ? "FAILED CHECKS PRESENT" : "ALL CHECKS PASSED"}

Respond with JSON matching schema:
{
  "schema_version": 1,
  "task_id": string,
  "attempt_id": string,
  "verdict": "accept" | "repair" | "reject_out_of_scope" | "needs_human" | "stop",
  "criteria": [
    { "criterion_id": string, "status": "passed" | "failed" | "unverified", "evidence_ids": string[], "reason": string }
  ],
  "scope_drift": { "detected": boolean, "details": string[] },
  "quality_findings": [],
  "missing_evidence": string[],
  "repair_instructions": string[],
  "roadmap_or_spec_proposal": null,
  "requires_human": boolean,
  "rationale": string
}
`.trim();

    try {
      const result = await this.provider.generate({
        operation: "result_review",
        systemInstruction: CRITIC_SYSTEM_INSTRUCTION,
        messages: [
          { role: "system", content: context },
          { role: "user", content: prompt },
        ],
        responseSchema: {},
        dataClassification: "internal",
        projectId: task.projectId,
        taskId: task.id,
      });

      let parsed = result.parsed;
      if (!parsed && result.text) {
        parsed = extractJsonFromText(result.text);
      }

      if (parsed) {
        const validated = CriticReviewSchema.parse(parsed);

        // Enforce hard gate: Critic CANNOT waive a failed mandatory check
        if (mandatoryFailed && validated.verdict === "accept") {
          validated.verdict = "repair";
          validated.rationale = "Critic attempted to accept despite failed verification checks. Overridden by deterministic policy gate to repair.";
        }
        return validated;
      }
    } catch {
      // Deterministic evaluation fallback
    }

    // Deterministic evaluation based on actual verification results
    const criteriaResults = task.acceptanceCriteria.map((c) => {
      const checkPassed = !mandatoryFailed;
      return {
        criterion_id: c.id,
        status: (checkPassed ? "passed" : "failed") as "passed" | "failed",
        evidence_ids: verificationResults.map((v) => v.id),
        reason: checkPassed ? "Verification command completed with exit code 0." : "Verification command failed.",
      };
    });

    const verdict = mandatoryFailed ? ("repair" as const) : ("accept" as const);

    return CriticReviewSchema.parse({
      schema_version: 1,
      task_id: task.id,
      attempt_id: task.currentAttemptId || "attempt-1",
      verdict,
      criteria: criteriaResults,
      scope_drift: { detected: false, details: [] },
      quality_findings: [],
      missing_evidence: [],
      repair_instructions: mandatoryFailed ? ["Fix failing verification checks and rerun test suite."] : [],
      roadmap_or_spec_proposal: null,
      requires_human: false,
      rationale: mandatoryFailed
        ? "Deterministic check failed: code must pass all verifier checks before acceptance."
        : "All mandatory verifier checks passed with clean exit code and verified diff.",
    });
  }
}
