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

    // 0. Non-metadata file changes check: A coding task must produce observable project file changes
    const projectFiles = changedFiles.filter(
      (f) => !f.startsWith(".orchestrator") && !f.startsWith(".git") && f !== ""
    );
    if (projectFiles.length === 0) {
      blockers.push(
        "Coding task produced zero project file changes (only metadata or no files modified). A coding task cannot be accepted without actual project source code changes."
      );
    } else {
      reasons.push(
        `Task produced ${projectFiles.length} project file modification(s): ${projectFiles.slice(0, 3).join(", ")}`
      );
    }

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
    if (criticReview.verdict === "accept" && verificationViolations.length === 0) {
      reasons.push("All task acceptance criteria verified with concrete evidence.");
    } else {
      const failedCriteria = criticReview.criteria.filter((c) => c.status === "failed");
      if (failedCriteria.length > 0) {
        for (const c of failedCriteria) {
          blockers.push(`Acceptance criterion '${c.criterion_id}' is failed: ${c.reason}`);
        }
      } else {
        reasons.push("All task acceptance criteria verified with concrete evidence.");
      }
    }

    const accepted = blockers.length === 0;

    return {
      accepted,
      reasons,
      blockers,
    };
  }
}
