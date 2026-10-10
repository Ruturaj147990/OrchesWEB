import { z } from "zod";
export declare const AutonomyModeSchema: z.ZodEnum<["creative_within_constraints", "creative_exploration", "strict_blueprint_adherence"]>;
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;
export declare const ProjectStatusSchema: z.ZodEnum<["draft", "ready", "active", "paused", "completed", "archived"]>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    objective: z.ZodString;
    rootPath: z.ZodString;
    profileId: z.ZodDefault<z.ZodString>;
    autonomyMode: z.ZodDefault<z.ZodEnum<["creative_within_constraints", "creative_exploration", "strict_blueprint_adherence"]>>;
    status: z.ZodDefault<z.ZodEnum<["draft", "ready", "active", "paused", "completed", "archived"]>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "draft" | "ready" | "active" | "paused" | "completed" | "archived";
    id: string;
    name: string;
    objective: string;
    rootPath: string;
    profileId: string;
    autonomyMode: "creative_within_constraints" | "creative_exploration" | "strict_blueprint_adherence";
    createdAt: string;
    updatedAt: string;
}, {
    id: string;
    name: string;
    objective: string;
    rootPath: string;
    createdAt: string;
    updatedAt: string;
    status?: "draft" | "ready" | "active" | "paused" | "completed" | "archived" | undefined;
    profileId?: string | undefined;
    autonomyMode?: "creative_within_constraints" | "creative_exploration" | "strict_blueprint_adherence" | undefined;
}>;
export type Project = z.infer<typeof ProjectSchema>;
export declare const RunStatusSchema: z.ZodEnum<["draft", "ready", "running", "pausing", "paused", "completing", "completed", "completed_with_warnings", "blocked", "budget_exhausted", "stalled", "stopped", "failed", "canceled"]>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export declare const RunSchema: z.ZodObject<{
    id: z.ZodString;
    projectId: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["draft", "ready", "running", "pausing", "paused", "completing", "completed", "completed_with_warnings", "blocked", "budget_exhausted", "stalled", "stopped", "failed", "canceled"]>>;
    currentTaskId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    iterationCount: z.ZodDefault<z.ZodNumber>;
    stopReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    startedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    endedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "draft" | "ready" | "paused" | "completed" | "running" | "pausing" | "completing" | "completed_with_warnings" | "blocked" | "budget_exhausted" | "stalled" | "stopped" | "failed" | "canceled";
    id: string;
    projectId: string;
    currentTaskId: string | null;
    iterationCount: number;
    stopReason: string | null;
    startedAt: string | null;
    endedAt: string | null;
}, {
    id: string;
    projectId: string;
    status?: "draft" | "ready" | "paused" | "completed" | "running" | "pausing" | "completing" | "completed_with_warnings" | "blocked" | "budget_exhausted" | "stalled" | "stopped" | "failed" | "canceled" | undefined;
    currentTaskId?: string | null | undefined;
    iterationCount?: number | undefined;
    stopReason?: string | null | undefined;
    startedAt?: string | null | undefined;
    endedAt?: string | null | undefined;
}>;
export type Run = z.infer<typeof RunSchema>;
export declare const TaskStatusSchema: z.ZodEnum<["draft", "queued", "planning", "dispatching", "running", "collecting", "verifying", "critic_reviewing", "integrating", "succeeded", "needs_approval", "awaiting_agent_permission", "awaiting_agent_question", "retry_wait", "rollback_pending", "quarantined", "blocked", "failed", "canceled"]>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const AcceptanceCriterionSchema: z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    required: z.ZodDefault<z.ZodBoolean>;
    verification: z.ZodDefault<z.ZodEnum<["lint", "typecheck", "unit_test", "integration_test", "build", "browser_ui", "manual_review"]>>;
    status: z.ZodDefault<z.ZodEnum<["pending", "passed", "failed", "unverified"]>>;
    evidenceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "pending" | "passed" | "unverified";
    id: string;
    description: string;
    required: boolean;
    verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
    evidenceId?: string | undefined;
}, {
    id: string;
    description: string;
    status?: "failed" | "pending" | "passed" | "unverified" | undefined;
    required?: boolean | undefined;
    verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
    evidenceId?: string | undefined;
}>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    projectId: z.ZodString;
    runId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    title: z.ZodString;
    objective: z.ZodString;
    roadmapItemId: z.ZodString;
    requirementIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    status: z.ZodDefault<z.ZodEnum<["draft", "queued", "planning", "dispatching", "running", "collecting", "verifying", "critic_reviewing", "integrating", "succeeded", "needs_approval", "awaiting_agent_permission", "awaiting_agent_question", "retry_wait", "rollback_pending", "quarantined", "blocked", "failed", "canceled"]>>;
    priority: z.ZodDefault<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    risk: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
    allowedPaths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    forbiddenPaths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    acceptanceCriteria: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        required: z.ZodDefault<z.ZodBoolean>;
        verification: z.ZodDefault<z.ZodEnum<["lint", "typecheck", "unit_test", "integration_test", "build", "browser_ui", "manual_review"]>>;
        status: z.ZodDefault<z.ZodEnum<["pending", "passed", "failed", "unverified"]>>;
        evidenceId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "failed" | "pending" | "passed" | "unverified";
        id: string;
        description: string;
        required: boolean;
        verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
        evidenceId?: string | undefined;
    }, {
        id: string;
        description: string;
        status?: "failed" | "pending" | "passed" | "unverified" | undefined;
        required?: boolean | undefined;
        verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
        evidenceId?: string | undefined;
    }>, "many">>;
    verificationPlan: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    attemptCount: z.ZodDefault<z.ZodNumber>;
    currentAttemptId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxAttempts: z.ZodDefault<z.ZodNumber>;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "draft" | "running" | "blocked" | "failed" | "canceled" | "queued" | "planning" | "dispatching" | "collecting" | "verifying" | "critic_reviewing" | "integrating" | "succeeded" | "needs_approval" | "awaiting_agent_permission" | "awaiting_agent_question" | "retry_wait" | "rollback_pending" | "quarantined";
    id: string;
    objective: string;
    createdAt: string;
    updatedAt: string;
    projectId: string;
    runId: string | null;
    title: string;
    roadmapItemId: string;
    requirementIds: string[];
    priority: "low" | "medium" | "high" | "critical";
    risk: "low" | "medium" | "high";
    allowedPaths: string[];
    forbiddenPaths: string[];
    acceptanceCriteria: {
        status: "failed" | "pending" | "passed" | "unverified";
        id: string;
        description: string;
        required: boolean;
        verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
        evidenceId?: string | undefined;
    }[];
    verificationPlan: string[];
    attemptCount: number;
    currentAttemptId: string | null;
    maxAttempts: number;
    requiresApproval: boolean;
}, {
    id: string;
    objective: string;
    createdAt: string;
    updatedAt: string;
    projectId: string;
    title: string;
    roadmapItemId: string;
    status?: "draft" | "running" | "blocked" | "failed" | "canceled" | "queued" | "planning" | "dispatching" | "collecting" | "verifying" | "critic_reviewing" | "integrating" | "succeeded" | "needs_approval" | "awaiting_agent_permission" | "awaiting_agent_question" | "retry_wait" | "rollback_pending" | "quarantined" | undefined;
    runId?: string | null | undefined;
    requirementIds?: string[] | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    risk?: "low" | "medium" | "high" | undefined;
    allowedPaths?: string[] | undefined;
    forbiddenPaths?: string[] | undefined;
    acceptanceCriteria?: {
        id: string;
        description: string;
        status?: "failed" | "pending" | "passed" | "unverified" | undefined;
        required?: boolean | undefined;
        verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
        evidenceId?: string | undefined;
    }[] | undefined;
    verificationPlan?: string[] | undefined;
    attemptCount?: number | undefined;
    currentAttemptId?: string | null | undefined;
    maxAttempts?: number | undefined;
    requiresApproval?: boolean | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export declare const AgentTestClaimSchema: z.ZodObject<{
    command: z.ZodString;
    agent_claim: z.ZodEnum<["passed", "failed", "skipped"]>;
    claimed_exit_code: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    command: string;
    agent_claim: "failed" | "passed" | "skipped";
    claimed_exit_code?: number | undefined;
}, {
    command: string;
    agent_claim: "failed" | "passed" | "skipped";
    claimed_exit_code?: number | undefined;
}>;
export declare const AgentReportSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<1>>;
    task_id: z.ZodString;
    attempt_id: z.ZodString;
    status: z.ZodEnum<["reported_complete", "reported_failed", "blocked", "awaiting_permission", "question"]>;
    summary: z.ZodString;
    files_changed: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    tests: z.ZodDefault<z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        agent_claim: z.ZodEnum<["passed", "failed", "skipped"]>;
        claimed_exit_code: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        command: string;
        agent_claim: "failed" | "passed" | "skipped";
        claimed_exit_code?: number | undefined;
    }, {
        command: string;
        agent_claim: "failed" | "passed" | "skipped";
        claimed_exit_code?: number | undefined;
    }>, "many">>;
    blockers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    questions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    suggestions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    requires_human: z.ZodDefault<z.ZodBoolean>;
    agent_session_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "blocked" | "reported_complete" | "reported_failed" | "awaiting_permission" | "question";
    schema_version: 1;
    task_id: string;
    attempt_id: string;
    summary: string;
    files_changed: string[];
    tests: {
        command: string;
        agent_claim: "failed" | "passed" | "skipped";
        claimed_exit_code?: number | undefined;
    }[];
    blockers: string[];
    questions: string[];
    suggestions: string[];
    requires_human: boolean;
    agent_session_id: string | null;
}, {
    status: "blocked" | "reported_complete" | "reported_failed" | "awaiting_permission" | "question";
    task_id: string;
    attempt_id: string;
    summary: string;
    schema_version?: 1 | undefined;
    files_changed?: string[] | undefined;
    tests?: {
        command: string;
        agent_claim: "failed" | "passed" | "skipped";
        claimed_exit_code?: number | undefined;
    }[] | undefined;
    blockers?: string[] | undefined;
    questions?: string[] | undefined;
    suggestions?: string[] | undefined;
    requires_human?: boolean | undefined;
    agent_session_id?: string | null | undefined;
}>;
export type AgentReport = z.infer<typeof AgentReportSchema>;
export declare const PlannedTaskSchema: z.ZodObject<{
    task_id: z.ZodString;
    roadmap_item_id: z.ZodString;
    requirement_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    title: z.ZodString;
    objective: z.ZodString;
    allowed_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    acceptance_criteria: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        required: z.ZodDefault<z.ZodBoolean>;
        verification: z.ZodDefault<z.ZodEnum<["lint", "typecheck", "unit_test", "integration_test", "build", "browser_ui", "manual_review"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        description: string;
        required: boolean;
        verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
    }, {
        id: string;
        description: string;
        required?: boolean | undefined;
        verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
    }>, "many">;
    verification_plan_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    risk: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
    estimated_cost_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    requires_approval: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    objective: string;
    title: string;
    risk: "low" | "medium" | "high";
    task_id: string;
    roadmap_item_id: string;
    requirement_ids: string[];
    allowed_paths: string[];
    acceptance_criteria: {
        id: string;
        description: string;
        required: boolean;
        verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
    }[];
    verification_plan_ids: string[];
    requires_approval: boolean;
    estimated_cost_usd?: number | null | undefined;
}, {
    objective: string;
    title: string;
    task_id: string;
    roadmap_item_id: string;
    acceptance_criteria: {
        id: string;
        description: string;
        required?: boolean | undefined;
        verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
    }[];
    risk?: "low" | "medium" | "high" | undefined;
    requirement_ids?: string[] | undefined;
    allowed_paths?: string[] | undefined;
    verification_plan_ids?: string[] | undefined;
    estimated_cost_usd?: number | null | undefined;
    requires_approval?: boolean | undefined;
}>;
export declare const PlannerOutputSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<1>>;
    decision: z.ZodEnum<["dispatch_task", "replan_proposal", "needs_human", "no_eligible_work", "stop"]>;
    rationale: z.ZodString;
    next_task: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        task_id: z.ZodString;
        roadmap_item_id: z.ZodString;
        requirement_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        title: z.ZodString;
        objective: z.ZodString;
        allowed_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        acceptance_criteria: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
            verification: z.ZodDefault<z.ZodEnum<["lint", "typecheck", "unit_test", "integration_test", "build", "browser_ui", "manual_review"]>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            description: string;
            required: boolean;
            verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
        }, {
            id: string;
            description: string;
            required?: boolean | undefined;
            verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
        }>, "many">;
        verification_plan_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        risk: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
        estimated_cost_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        requires_approval: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        objective: string;
        title: string;
        risk: "low" | "medium" | "high";
        task_id: string;
        roadmap_item_id: string;
        requirement_ids: string[];
        allowed_paths: string[];
        acceptance_criteria: {
            id: string;
            description: string;
            required: boolean;
            verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
        }[];
        verification_plan_ids: string[];
        requires_approval: boolean;
        estimated_cost_usd?: number | null | undefined;
    }, {
        objective: string;
        title: string;
        task_id: string;
        roadmap_item_id: string;
        acceptance_criteria: {
            id: string;
            description: string;
            required?: boolean | undefined;
            verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
        }[];
        risk?: "low" | "medium" | "high" | undefined;
        requirement_ids?: string[] | undefined;
        allowed_paths?: string[] | undefined;
        verification_plan_ids?: string[] | undefined;
        estimated_cost_usd?: number | null | undefined;
        requires_approval?: boolean | undefined;
    }>>>;
    roadmap_proposals: z.ZodDefault<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
    open_questions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    stop: z.ZodDefault<z.ZodBoolean>;
    stop_reason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    schema_version: 1;
    decision: "dispatch_task" | "replan_proposal" | "needs_human" | "no_eligible_work" | "stop";
    stop: boolean;
    rationale: string;
    next_task: {
        objective: string;
        title: string;
        risk: "low" | "medium" | "high";
        task_id: string;
        roadmap_item_id: string;
        requirement_ids: string[];
        allowed_paths: string[];
        acceptance_criteria: {
            id: string;
            description: string;
            required: boolean;
            verification: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review";
        }[];
        verification_plan_ids: string[];
        requires_approval: boolean;
        estimated_cost_usd?: number | null | undefined;
    } | null;
    roadmap_proposals: Record<string, unknown>[];
    open_questions: string[];
    stop_reason: string | null;
}, {
    decision: "dispatch_task" | "replan_proposal" | "needs_human" | "no_eligible_work" | "stop";
    rationale: string;
    schema_version?: 1 | undefined;
    stop?: boolean | undefined;
    next_task?: {
        objective: string;
        title: string;
        task_id: string;
        roadmap_item_id: string;
        acceptance_criteria: {
            id: string;
            description: string;
            required?: boolean | undefined;
            verification?: "lint" | "typecheck" | "unit_test" | "integration_test" | "build" | "browser_ui" | "manual_review" | undefined;
        }[];
        risk?: "low" | "medium" | "high" | undefined;
        requirement_ids?: string[] | undefined;
        allowed_paths?: string[] | undefined;
        verification_plan_ids?: string[] | undefined;
        estimated_cost_usd?: number | null | undefined;
        requires_approval?: boolean | undefined;
    } | null | undefined;
    roadmap_proposals?: Record<string, unknown>[] | undefined;
    open_questions?: string[] | undefined;
    stop_reason?: string | null | undefined;
}>;
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export declare const CriticCriterionResultSchema: z.ZodObject<{
    criterion_id: z.ZodString;
    status: z.ZodEnum<["passed", "failed", "unverified"]>;
    evidence_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "passed" | "unverified";
    criterion_id: string;
    evidence_ids: string[];
    reason: string;
}, {
    status: "failed" | "passed" | "unverified";
    criterion_id: string;
    reason: string;
    evidence_ids?: string[] | undefined;
}>;
export declare const CriticReviewSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<1>>;
    task_id: z.ZodString;
    attempt_id: z.ZodString;
    verdict: z.ZodEnum<["accept", "repair", "reject_out_of_scope", "needs_human", "stop"]>;
    criteria: z.ZodArray<z.ZodObject<{
        criterion_id: z.ZodString;
        status: z.ZodEnum<["passed", "failed", "unverified"]>;
        evidence_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: "failed" | "passed" | "unverified";
        criterion_id: string;
        evidence_ids: string[];
        reason: string;
    }, {
        status: "failed" | "passed" | "unverified";
        criterion_id: string;
        reason: string;
        evidence_ids?: string[] | undefined;
    }>, "many">;
    scope_drift: z.ZodObject<{
        detected: z.ZodBoolean;
        details: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        detected: boolean;
        details: string[];
    }, {
        detected: boolean;
        details?: string[] | undefined;
    }>;
    quality_findings: z.ZodDefault<z.ZodArray<z.ZodObject<{
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        finding: z.ZodString;
        evidence_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        suggested_action: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        evidence_ids: string[];
        severity: "low" | "medium" | "high" | "critical";
        finding: string;
        suggested_action: string;
    }, {
        severity: "low" | "medium" | "high" | "critical";
        finding: string;
        suggested_action: string;
        evidence_ids?: string[] | undefined;
    }>, "many">>;
    missing_evidence: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    repair_instructions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    roadmap_or_spec_proposal: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    requires_human: z.ZodDefault<z.ZodBoolean>;
    rationale: z.ZodString;
}, "strip", z.ZodTypeAny, {
    schema_version: 1;
    task_id: string;
    attempt_id: string;
    requires_human: boolean;
    rationale: string;
    verdict: "needs_human" | "stop" | "accept" | "repair" | "reject_out_of_scope";
    criteria: {
        status: "failed" | "passed" | "unverified";
        criterion_id: string;
        evidence_ids: string[];
        reason: string;
    }[];
    scope_drift: {
        detected: boolean;
        details: string[];
    };
    quality_findings: {
        evidence_ids: string[];
        severity: "low" | "medium" | "high" | "critical";
        finding: string;
        suggested_action: string;
    }[];
    missing_evidence: string[];
    repair_instructions: string[];
    roadmap_or_spec_proposal: string | null;
}, {
    task_id: string;
    attempt_id: string;
    rationale: string;
    verdict: "needs_human" | "stop" | "accept" | "repair" | "reject_out_of_scope";
    criteria: {
        status: "failed" | "passed" | "unverified";
        criterion_id: string;
        reason: string;
        evidence_ids?: string[] | undefined;
    }[];
    scope_drift: {
        detected: boolean;
        details?: string[] | undefined;
    };
    schema_version?: 1 | undefined;
    requires_human?: boolean | undefined;
    quality_findings?: {
        severity: "low" | "medium" | "high" | "critical";
        finding: string;
        suggested_action: string;
        evidence_ids?: string[] | undefined;
    }[] | undefined;
    missing_evidence?: string[] | undefined;
    repair_instructions?: string[] | undefined;
    roadmap_or_spec_proposal?: string | null | undefined;
}>;
export type CriticReview = z.infer<typeof CriticReviewSchema>;
export declare const VerificationCheckTypeSchema: z.ZodEnum<["lint", "typecheck", "test", "build", "browser_ui", "security", "custom"]>;
export type VerificationCheckType = z.infer<typeof VerificationCheckTypeSchema>;
export declare const VerificationResultSchema: z.ZodObject<{
    id: z.ZodString;
    taskId: z.ZodString;
    attemptId: z.ZodString;
    checkType: z.ZodEnum<["lint", "typecheck", "test", "build", "browser_ui", "security", "custom"]>;
    command: z.ZodString;
    argv: z.ZodArray<z.ZodString, "many">;
    cwd: z.ZodString;
    status: z.ZodEnum<["passed", "failed", "skipped", "timeout"]>;
    exitCode: z.ZodNullable<z.ZodNumber>;
    durationMs: z.ZodNumber;
    outputArtifactId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    stdoutSnippet: z.ZodDefault<z.ZodString>;
    stderrSnippet: z.ZodDefault<z.ZodString>;
    truncated: z.ZodDefault<z.ZodBoolean>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "passed" | "skipped" | "timeout";
    id: string;
    command: string;
    taskId: string;
    attemptId: string;
    checkType: "lint" | "typecheck" | "build" | "browser_ui" | "custom" | "test" | "security";
    argv: string[];
    cwd: string;
    exitCode: number | null;
    durationMs: number;
    outputArtifactId: string | null;
    stdoutSnippet: string;
    stderrSnippet: string;
    truncated: boolean;
    timestamp: string;
}, {
    status: "failed" | "passed" | "skipped" | "timeout";
    id: string;
    command: string;
    taskId: string;
    attemptId: string;
    checkType: "lint" | "typecheck" | "build" | "browser_ui" | "custom" | "test" | "security";
    argv: string[];
    cwd: string;
    exitCode: number | null;
    durationMs: number;
    timestamp: string;
    outputArtifactId?: string | null | undefined;
    stdoutSnippet?: string | undefined;
    stderrSnippet?: string | undefined;
    truncated?: boolean | undefined;
}>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export declare const BrowserVerificationEvidenceSchema: z.ZodObject<{
    id: z.ZodString;
    taskId: z.ZodString;
    attemptId: z.ZodString;
    url: z.ZodString;
    viewport: z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
    }, {
        width: number;
        height: number;
    }>;
    assertionsPassed: z.ZodNumber;
    assertionsFailed: z.ZodNumber;
    consoleErrors: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    networkFailures: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    screenshotArtifactId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    durationMs: z.ZodNumber;
    passed: z.ZodBoolean;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    passed: boolean;
    taskId: string;
    attemptId: string;
    durationMs: number;
    timestamp: string;
    url: string;
    viewport: {
        width: number;
        height: number;
    };
    assertionsPassed: number;
    assertionsFailed: number;
    consoleErrors: string[];
    networkFailures: string[];
    screenshotArtifactId: string | null;
}, {
    id: string;
    passed: boolean;
    taskId: string;
    attemptId: string;
    durationMs: number;
    timestamp: string;
    url: string;
    viewport: {
        width: number;
        height: number;
    };
    assertionsPassed: number;
    assertionsFailed: number;
    consoleErrors?: string[] | undefined;
    networkFailures?: string[] | undefined;
    screenshotArtifactId?: string | null | undefined;
}>;
export type BrowserVerificationEvidence = z.infer<typeof BrowserVerificationEvidenceSchema>;
export declare const BudgetLimitsSchema: z.ZodObject<{
    perTaskWarningUsd: z.ZodDefault<z.ZodNumber>;
    perTaskHardUsd: z.ZodDefault<z.ZodNumber>;
    perRunHardUsd: z.ZodDefault<z.ZodNumber>;
    maxRepairsPerTask: z.ZodDefault<z.ZodNumber>;
    maxReasoningCallsPerTask: z.ZodDefault<z.ZodNumber>;
    maxReasoningCallsPerRun: z.ZodDefault<z.ZodNumber>;
    maxTasksPerRun: z.ZodDefault<z.ZodNumber>;
    maxIterationsPerRun: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    perTaskWarningUsd: number;
    perTaskHardUsd: number;
    perRunHardUsd: number;
    maxRepairsPerTask: number;
    maxReasoningCallsPerTask: number;
    maxReasoningCallsPerRun: number;
    maxTasksPerRun: number;
    maxIterationsPerRun: number;
}, {
    perTaskWarningUsd?: number | undefined;
    perTaskHardUsd?: number | undefined;
    perRunHardUsd?: number | undefined;
    maxRepairsPerTask?: number | undefined;
    maxReasoningCallsPerTask?: number | undefined;
    maxReasoningCallsPerRun?: number | undefined;
    maxTasksPerRun?: number | undefined;
    maxIterationsPerRun?: number | undefined;
}>;
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;
export declare const CostStateSchema: z.ZodEnum<["measured", "estimated", "reserved", "unknown", "local_no_api_charge"]>;
export type CostState = z.infer<typeof CostStateSchema>;
export declare const BudgetUsageSchema: z.ZodObject<{
    measuredCostUsd: z.ZodDefault<z.ZodNumber>;
    estimatedCostUsd: z.ZodDefault<z.ZodNumber>;
    reservedCostUsd: z.ZodDefault<z.ZodNumber>;
    totalInputTokens: z.ZodDefault<z.ZodNumber>;
    totalOutputTokens: z.ZodDefault<z.ZodNumber>;
    totalRequests: z.ZodDefault<z.ZodNumber>;
    costState: z.ZodDefault<z.ZodEnum<["measured", "estimated", "reserved", "unknown", "local_no_api_charge"]>>;
}, "strip", z.ZodTypeAny, {
    measuredCostUsd: number;
    estimatedCostUsd: number;
    reservedCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    costState: "unknown" | "measured" | "estimated" | "reserved" | "local_no_api_charge";
}, {
    measuredCostUsd?: number | undefined;
    estimatedCostUsd?: number | undefined;
    reservedCostUsd?: number | undefined;
    totalInputTokens?: number | undefined;
    totalOutputTokens?: number | undefined;
    totalRequests?: number | undefined;
    costState?: "unknown" | "measured" | "estimated" | "reserved" | "local_no_api_charge" | undefined;
}>;
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;
export declare const PrivacyClassSchema: z.ZodEnum<["local", "cloud", "unknown"]>;
export type PrivacyClass = z.infer<typeof PrivacyClassSchema>;
export declare const ProviderProfileSchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodString;
    type: z.ZodEnum<["openai", "openai_compatible_local", "mock"]>;
    endpoint: z.ZodString;
    modelId: z.ZodString;
    privacyClass: z.ZodEnum<["local", "cloud", "unknown"]>;
    isReasoningProvider: z.ZodDefault<z.ZodBoolean>;
    isCodingAgent: z.ZodDefault<z.ZodBoolean>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "openai" | "openai_compatible_local" | "mock";
    id: string;
    displayName: string;
    endpoint: string;
    modelId: string;
    privacyClass: "unknown" | "local" | "cloud";
    isReasoningProvider: boolean;
    isCodingAgent: boolean;
    enabled: boolean;
}, {
    type: "openai" | "openai_compatible_local" | "mock";
    id: string;
    displayName: string;
    endpoint: string;
    modelId: string;
    privacyClass: "unknown" | "local" | "cloud";
    isReasoningProvider?: boolean | undefined;
    isCodingAgent?: boolean | undefined;
    enabled?: boolean | undefined;
}>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export declare const HumanMessageKindSchema: z.ZodEnum<["guidance", "replan", "safe_interrupt", "priority_override", "scope_change"]>;
export type HumanMessageKind = z.infer<typeof HumanMessageKindSchema>;
export declare const HumanMessageSchema: z.ZodObject<{
    id: z.ZodString;
    projectId: z.ZodString;
    kind: z.ZodEnum<["guidance", "replan", "safe_interrupt", "priority_override", "scope_change"]>;
    content: z.ZodString;
    priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    status: z.ZodDefault<z.ZodEnum<["pending", "consumed", "canceled"]>>;
    createdAt: z.ZodString;
    consumedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "canceled" | "pending" | "consumed";
    id: string;
    createdAt: string;
    projectId: string;
    priority: "low" | "high" | "normal" | "urgent";
    kind: "guidance" | "replan" | "safe_interrupt" | "priority_override" | "scope_change";
    content: string;
    consumedAt: string | null;
}, {
    id: string;
    createdAt: string;
    projectId: string;
    kind: "guidance" | "replan" | "safe_interrupt" | "priority_override" | "scope_change";
    content: string;
    status?: "canceled" | "pending" | "consumed" | undefined;
    priority?: "low" | "high" | "normal" | "urgent" | undefined;
    consumedAt?: string | null | undefined;
}>;
export type HumanMessage = z.infer<typeof HumanMessageKindSchema>;
export declare const RunEventSchema: z.ZodObject<{
    id: z.ZodString;
    eventSeq: z.ZodNumber;
    projectId: z.ZodString;
    runId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    taskId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    type: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    projectId: string;
    runId: string | null;
    taskId: string | null;
    timestamp: string;
    eventSeq: number;
    payload: Record<string, unknown>;
}, {
    type: string;
    id: string;
    projectId: string;
    timestamp: string;
    eventSeq: number;
    payload: Record<string, unknown>;
    runId?: string | null | undefined;
    taskId?: string | null | undefined;
}>;
export type RunEvent = z.infer<typeof RunEventSchema>;
//# sourceMappingURL=index.d.ts.map