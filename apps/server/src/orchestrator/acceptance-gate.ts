import { Task, VerificationResult, CriticReview } from "@orchestrator/shared-types";
import { PolicyEngine } from "@orchestrator/policy-schema";

export interface AcceptanceDecision {
  accepted: boolean;
  reasons: string[];
  blockers: string[];
}

export class AcceptanceGate {
  private policyEngine: PolicyEngine;

  constructor() {
    this.policyEngine = new PolicyEngine();
  }

  public evaluate(
    task: Task,
    changedFiles: string[],
    verificationResults: VerificationResult[],
    criticReview: CriticReview
  ): AcceptanceDecision {
    const reasons: string[] = [];
    const blockers: string[] = [];

    // 1. Mandatory verification checks must pass
    const verificationViolations = this.policyEngine.evaluateVerificationPolicy(verificationResults);
    if (verificationViolations.length > 0) {
      for (const v of verificationViolations) {
        blockers.push(`Verification check failure: ${v.message}`);
      }
    } else {
      reasons.push("All mandatory verification checks passed with exit code 0.");
    }

    // 2. Path safety policy
    const pathViolations = this.policyEngine.evaluatePathPolicy(task, changedFiles);
    if (pathViolations.length > 0) {
      for (const v of pathViolations) {
        blockers.push(`Forbidden path violation: ${v.message}`);
      }
    } else {
      reasons.push("All changed paths comply with project boundary constraints.");
    }

    // 3. Critic verdict check
    if (criticReview.verdict !== "accept") {
      blockers.push(`Independent Critic verdict is '${criticReview.verdict}': ${criticReview.rationale}`);
    } else {
      reasons.push("Independent Critic endorsed acceptance.");
    }

    // 4. Acceptance criteria evidence check
    const unverifiedCriteria = criticReview.criteria.filter((c) => c.status !== "passed");
    if (unverifiedCriteria.length > 0) {
      for (const c of unverifiedCriteria) {
        blockers.push(`Acceptance criterion '${c.criterion_id}' is ${c.status}: ${c.reason}`);
      }
    } else {
      reasons.push("All task acceptance criteria verified with concrete evidence.");
    }

    const accepted = blockers.length === 0;

    return {
      accepted,
      reasons,
      blockers,
    };
  }
}
