import { z } from "zod";
import { AutonomyMode, Task, VerificationResult } from "@orchestrator/shared-types";

export const ConstraintClassSchema = z.enum(["hard", "soft", "informational"]);
export type ConstraintClass = z.infer<typeof ConstraintClassSchema>;

export const ConstraintScopeSchema = z.enum([
  "product_scope",
  "architecture",
  "workspace_boundaries",
  "privacy_data_sharing",
  "dependencies",
  "testing_quality",
  "performance",
  "budget",
  "tool_permissions",
  "external_actions",
]);
export type ConstraintScope = z.infer<typeof ConstraintScopeSchema>;

export const ConstraintRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  class: ConstraintClassSchema,
  scope: ConstraintScopeSchema,
  ruleKey: z.string(),
  parameter: z.unknown().optional(),
  enabled: z.boolean().default(true),
});
export type ConstraintRule = z.infer<typeof ConstraintRuleSchema>;

export interface PolicyViolation {
  ruleId: string;
  name: string;
  class: ConstraintClass;
  message: string;
}

export class PolicyEngine {
  private constraints: ConstraintRule[] = [];

  constructor(initialConstraints: ConstraintRule[] = []) {
    this.constraints = [...initialConstraints];
  }

  public getConstraints(): ConstraintRule[] {
    return [...this.constraints];
  }

  public addConstraint(constraint: ConstraintRule): void {
    this.constraints.push(constraint);
  }

  /**
   * Enforces path safety outside the language model:
   * Rejects changes touching forbidden paths or paths outside allowed boundaries.
   */
  public evaluatePathPolicy(task: Task, changedFiles: string[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const file of changedFiles) {
      const normalized = file.replace(/\\/g, "/");

      // Check forbidden patterns
      let matchedForbidden = false;
      for (const forbidden of task.forbiddenPaths) {
        const regex = new RegExp("^" + forbidden.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
        if (regex.test(normalized)) {
          violations.push({
            ruleId: "PATH-FORBIDDEN",
            name: "Forbidden Path Modification",
            class: "hard",
            message: `File '${normalized}' matches forbidden path rule: '${forbidden}'`,
          });
          matchedForbidden = true;
          break;
        }
      }

      if (!matchedForbidden && (normalized.includes(".orchestrator") || normalized.includes(".env"))) {
        violations.push({
          ruleId: "PATH-FORBIDDEN",
          name: "Forbidden Path Modification",
          class: "hard",
          message: `File '${normalized}' matches reserved internal system path`,
        });
      }
    }

    return violations;
  }

  /**
   * Validates mandatory verification checks:
   * If any mandatory check failed or timed out, task must NOT pass.
   */
  public evaluateVerificationPolicy(results: VerificationResult[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const res of results) {
      if (res.status === "failed" || res.status === "timeout") {
        violations.push({
          ruleId: `VERIFY-${res.checkType.toUpperCase()}`,
          name: `Verification Failure: ${res.command}`,
          class: "hard",
          message: `Required check '${res.command}' failed with exit code ${res.exitCode}. Snippet: ${res.stderrSnippet || res.stdoutSnippet}`,
        });
      }
    }

    return violations;
  }

  /**
   * Detects policy/configuration contradictions
   */
  public detectContradictions(
    autonomyMode: AutonomyMode,
    isLocalReasoning: boolean,
    allowsCloudFallback: boolean
  ): string[] {
    const conflicts: string[] = [];
    if (isLocalReasoning && allowsCloudFallback) {
      conflicts.push("Contradiction: Local-only reasoning mode is enabled, but cloud fallback is also allowed. Local-only mode strictly forbids cloud fallback.");
    }
    return conflicts;
  }
}
