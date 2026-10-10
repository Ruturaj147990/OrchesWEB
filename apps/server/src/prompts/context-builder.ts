import fs from "node:fs";
import path from "node:path";
import { Task, VerificationResult, AgentReport } from "@orchestrator/shared-types";

export interface ProjectMemory {
  spec: string;
  decisions: string;
  roadmap: string;
  repoMap: string;
  currentState: string;
}

export class ContextBuilder {
  constructor(private workspacePath: string) {}

  public loadProjectMemory(): ProjectMemory {
    const readFileSafe = (relPath: string, fallback: string): string => {
      const full = path.join(this.workspacePath, relPath);
      if (fs.existsSync(full)) {
        try {
          return fs.readFileSync(full, "utf8");
        } catch {
          return fallback;
        }
      }
      return fallback;
    };

    return {
      spec: readFileSafe("SPEC.md", "# Project Specification\nNo specification defined yet."),
      decisions: readFileSafe("DECISIONS.md", "# Architectural Decisions\nNo decisions recorded yet."),
      roadmap: readFileSafe(".orchestrator/ROADMAP.md", "# Approved Roadmap\n- ROADMAP-001: Baseline verification and initial core feature"),
      repoMap: readFileSafe(".orchestrator/REPO_MAP.md", "# Repository Map\nWorkspace root structure."),
      currentState: readFileSafe("CURRENT_STATE.md", "# Current State\nStatus: Initializing."),
    };
  }

  public buildPlannerContext(projectObjective: string, budgetSummary: string): string {
    const memory = this.loadProjectMemory();
    return `
=== PROJECT OBJECTIVE ===
${projectObjective}

=== BUDGET & CONSTRAINTS ===
${budgetSummary}

=== APPROVED ROADMAP (.orchestrator/ROADMAP.md) ===
${memory.roadmap}

=== SPECIFICATION (SPEC.md) ===
${memory.spec}

=== ARCHITECTURAL DECISIONS (DECISIONS.md) ===
${memory.decisions}

=== CURRENT REPOSITORY STATE ===
${memory.currentState}
`.trim();
  }

  public buildExecutorContext(task: Task, attemptNumber: number, priorFailureEvidence?: string): string {
    return `
=== TASK CONTRACT [Attempt ${attemptNumber}] ===
Task ID: ${task.id}
Roadmap Item: ${task.roadmapItemId}
Title: ${task.title}
Objective: ${task.objective}
Priority: ${task.priority} | Risk: ${task.risk}

=== SCOPE RULES ===
Allowed Paths: ${task.allowedPaths.join(", ")}
Forbidden Paths: ${task.forbiddenPaths.join(", ")}

=== ACCEPTANCE CRITERIA ===
${task.acceptanceCriteria.map((c) => `- [${c.id}] (${c.verification}) ${c.description}`).join("\n")}

=== MANDATORY VERIFICATION PLAN ===
${task.verificationPlan.join("\n")}

${priorFailureEvidence ? `=== PRIOR ATTEMPT FAILURE EVIDENCE ===\n${priorFailureEvidence}` : ""}
`.trim();
  }

  public buildCriticContext(
    task: Task,
    diff: string,
    verificationResults: VerificationResult[],
    agentReport: AgentReport
  ): string {
    const memory = this.loadProjectMemory();
    return `
=== TASK UNDER REVIEW ===
Task ID: ${task.id}
Roadmap Item: ${task.roadmapItemId}
Title: ${task.title}
Objective: ${task.objective}

=== ACCEPTANCE CRITERIA ===
${task.acceptanceCriteria.map((c) => `- [${c.id}] ${c.description} (Required: ${c.required})`).join("\n")}

=== ACTUAL GIT DIFF EVIDENCE ===
${diff.slice(0, 8000)}

=== INDEPENDENT ORCHESTRATOR VERIFICATION EVIDENCE ===
${verificationResults
  .map(
    (v) =>
      `Check: ${v.checkType} | Command: ${v.command} | Exit Code: ${v.exitCode} | Status: ${v.status} | Duration: ${v.durationMs}ms\nOutput:\n${v.stdoutSnippet || v.stderrSnippet || "(No output)"}`
  )
  .join("\n\n")}

=== CODING AGENT REPORT CLAIMS ===
Status Claim: ${agentReport.status}
Summary: ${agentReport.summary}
Files Changed: ${agentReport.files_changed.join(", ")}
Blockers: ${agentReport.blockers.join(", ") || "None"}

=== CANONICAL PROJECT SPECIFICATION ===
${memory.spec.slice(0, 2000)}
`.trim();
  }
}
