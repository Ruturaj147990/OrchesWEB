"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunEventSchema = exports.HumanMessageSchema = exports.HumanMessageKindSchema = exports.ProviderProfileSchema = exports.PrivacyClassSchema = exports.BudgetUsageSchema = exports.CostStateSchema = exports.BudgetLimitsSchema = exports.BrowserVerificationEvidenceSchema = exports.VerificationResultSchema = exports.VerificationCheckTypeSchema = exports.CriticReviewSchema = exports.CriticCriterionResultSchema = exports.PlannerOutputSchema = exports.PlannedTaskSchema = exports.AgentReportSchema = exports.AgentTestClaimSchema = exports.TaskSchema = exports.AcceptanceCriterionSchema = exports.TaskStatusSchema = exports.RunSchema = exports.RunStatusSchema = exports.ProjectSchema = exports.ProjectStatusSchema = exports.AutonomyModeSchema = void 0;
const zod_1 = require("zod");
// --- Project & Autonomy ---
exports.AutonomyModeSchema = zod_1.z.enum([
    "creative_within_constraints",
    "creative_exploration",
    "strict_blueprint_adherence",
]);
exports.ProjectStatusSchema = zod_1.z.enum([
    "draft",
    "ready",
    "active",
    "paused",
    "completed",
    "archived",
]);
exports.ProjectSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string().min(1),
    objective: zod_1.z.string(),
    rootPath: zod_1.z.string(),
    profileId: zod_1.z.string().default("general"),
    autonomyMode: exports.AutonomyModeSchema.default("creative_within_constraints"),
    status: exports.ProjectStatusSchema.default("draft"),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
// --- Run Lifecycle ---
exports.RunStatusSchema = zod_1.z.enum([
    "draft",
    "ready",
    "running",
    "pausing",
    "paused",
    "completing",
    "completed",
    "completed_with_warnings",
    "blocked",
    "budget_exhausted",
    "stalled",
    "stopped",
    "failed",
    "canceled",
]);
exports.RunSchema = zod_1.z.object({
    id: zod_1.z.string(),
    projectId: zod_1.z.string(),
    status: exports.RunStatusSchema.default("ready"),
    currentTaskId: zod_1.z.string().nullable().default(null),
    iterationCount: zod_1.z.number().default(0),
    stopReason: zod_1.z.string().nullable().default(null),
    startedAt: zod_1.z.string().nullable().default(null),
    endedAt: zod_1.z.string().nullable().default(null),
});
// --- Task Lifecycle & Contract ---
exports.TaskStatusSchema = zod_1.z.enum([
    "draft",
    "queued",
    "planning",
    "dispatching",
    "running",
    "collecting",
    "verifying",
    "critic_reviewing",
    "integrating",
    "succeeded",
    "needs_approval",
    "awaiting_agent_permission",
    "awaiting_agent_question",
    "retry_wait",
    "rollback_pending",
    "quarantined",
    "blocked",
    "failed",
    "canceled",
]);
exports.AcceptanceCriterionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    description: zod_1.z.string(),
    required: zod_1.z.boolean().default(true),
    verification: zod_1.z.enum([
        "lint",
        "typecheck",
        "unit_test",
        "integration_test",
        "build",
        "browser_ui",
        "manual_review",
    ]).default("integration_test"),
    status: zod_1.z.enum(["pending", "passed", "failed", "unverified"]).default("pending"),
    evidenceId: zod_1.z.string().optional(),
});
exports.TaskSchema = zod_1.z.object({
    id: zod_1.z.string(),
    projectId: zod_1.z.string(),
    runId: zod_1.z.string().nullable().default(null),
    title: zod_1.z.string().min(1),
    objective: zod_1.z.string(),
    roadmapItemId: zod_1.z.string(),
    requirementIds: zod_1.z.array(zod_1.z.string()).default([]),
    status: exports.TaskStatusSchema.default("queued"),
    priority: zod_1.z.enum(["low", "medium", "high", "critical"]).default("medium"),
    risk: zod_1.z.enum(["low", "medium", "high"]).default("medium"),
    allowedPaths: zod_1.z.array(zod_1.z.string()).default(["**/*"]),
    forbiddenPaths: zod_1.z.array(zod_1.z.string()).default([".env*", ".orchestrator/**", "**/*.pem"]),
    acceptanceCriteria: zod_1.z.array(exports.AcceptanceCriterionSchema).default([]),
    verificationPlan: zod_1.z.array(zod_1.z.string()).default(["npm test"]),
    attemptCount: zod_1.z.number().default(0),
    currentAttemptId: zod_1.z.string().nullable().default(null),
    maxAttempts: zod_1.z.number().default(3),
    requiresApproval: zod_1.z.boolean().default(false),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
// --- Normalized Coding Agent Report (Wire Contract) ---
exports.AgentTestClaimSchema = zod_1.z.object({
    command: zod_1.z.string(),
    agent_claim: zod_1.z.enum(["passed", "failed", "skipped"]),
    claimed_exit_code: zod_1.z.number().optional(),
});
exports.AgentReportSchema = zod_1.z.object({
    schema_version: zod_1.z.literal(1).default(1),
    task_id: zod_1.z.string(),
    attempt_id: zod_1.z.string(),
    status: zod_1.z.enum([
        "reported_complete",
        "reported_failed",
        "blocked",
        "awaiting_permission",
        "question",
    ]),
    summary: zod_1.z.string(),
    files_changed: zod_1.z.array(zod_1.z.string()).default([]),
    tests: zod_1.z.array(exports.AgentTestClaimSchema).default([]),
    blockers: zod_1.z.array(zod_1.z.string()).default([]),
    questions: zod_1.z.array(zod_1.z.string()).default([]),
    suggestions: zod_1.z.array(zod_1.z.string()).default([]),
    requires_human: zod_1.z.boolean().default(false),
    agent_session_id: zod_1.z.string().nullable().default(null),
});
// --- Planner Machine Response Schema ---
exports.PlannedTaskSchema = zod_1.z.object({
    task_id: zod_1.z.string(),
    roadmap_item_id: zod_1.z.string(),
    requirement_ids: zod_1.z.array(zod_1.z.string()).default([]),
    title: zod_1.z.string(),
    objective: zod_1.z.string(),
    allowed_paths: zod_1.z.array(zod_1.z.string()).default(["**/*"]),
    acceptance_criteria: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        description: zod_1.z.string(),
        required: zod_1.z.boolean().default(true),
        verification: zod_1.z.enum([
            "lint",
            "typecheck",
            "unit_test",
            "integration_test",
            "build",
            "browser_ui",
            "manual_review",
        ]).default("integration_test"),
    })),
    verification_plan_ids: zod_1.z.array(zod_1.z.string()).default(["test", "build"]),
    risk: zod_1.z.enum(["low", "medium", "high"]).default("medium"),
    estimated_cost_usd: zod_1.z.number().nullable().optional(),
    requires_approval: zod_1.z.boolean().default(false),
});
exports.PlannerOutputSchema = zod_1.z.object({
    schema_version: zod_1.z.literal(1).default(1),
    decision: zod_1.z.enum([
        "dispatch_task",
        "replan_proposal",
        "needs_human",
        "no_eligible_work",
        "stop",
    ]),
    rationale: zod_1.z.string(),
    next_task: exports.PlannedTaskSchema.nullable().default(null),
    roadmap_proposals: zod_1.z.array(zod_1.z.record(zod_1.z.unknown())).default([]),
    open_questions: zod_1.z.array(zod_1.z.string()).default([]),
    stop: zod_1.z.boolean().default(false),
    stop_reason: zod_1.z.string().nullable().default(null),
});
// --- Independent Critic Schema ---
exports.CriticCriterionResultSchema = zod_1.z.object({
    criterion_id: zod_1.z.string(),
    status: zod_1.z.enum(["passed", "failed", "unverified"]),
    evidence_ids: zod_1.z.array(zod_1.z.string()).default([]),
    reason: zod_1.z.string(),
});
exports.CriticReviewSchema = zod_1.z.object({
    schema_version: zod_1.z.literal(1).default(1),
    task_id: zod_1.z.string(),
    attempt_id: zod_1.z.string(),
    verdict: zod_1.z.enum(["accept", "repair", "reject_out_of_scope", "needs_human", "stop"]),
    criteria: zod_1.z.array(exports.CriticCriterionResultSchema),
    scope_drift: zod_1.z.object({
        detected: zod_1.z.boolean(),
        details: zod_1.z.array(zod_1.z.string()).default([]),
    }),
    quality_findings: zod_1.z.array(zod_1.z.object({
        severity: zod_1.z.enum(["low", "medium", "high", "critical"]),
        finding: zod_1.z.string(),
        evidence_ids: zod_1.z.array(zod_1.z.string()).default([]),
        suggested_action: zod_1.z.string(),
    })).default([]),
    missing_evidence: zod_1.z.array(zod_1.z.string()).default([]),
    repair_instructions: zod_1.z.array(zod_1.z.string()).default([]),
    roadmap_or_spec_proposal: zod_1.z.string().nullable().default(null),
    requires_human: zod_1.z.boolean().default(false),
    rationale: zod_1.z.string(),
});
// --- Verification Evidence ---
exports.VerificationCheckTypeSchema = zod_1.z.enum([
    "lint",
    "typecheck",
    "test",
    "build",
    "browser_ui",
    "security",
    "custom",
]);
exports.VerificationResultSchema = zod_1.z.object({
    id: zod_1.z.string(),
    taskId: zod_1.z.string(),
    attemptId: zod_1.z.string(),
    checkType: exports.VerificationCheckTypeSchema,
    command: zod_1.z.string(),
    argv: zod_1.z.array(zod_1.z.string()),
    cwd: zod_1.z.string(),
    status: zod_1.z.enum(["passed", "failed", "skipped", "timeout"]),
    exitCode: zod_1.z.number().nullable(),
    durationMs: zod_1.z.number(),
    outputArtifactId: zod_1.z.string().nullable().default(null),
    stdoutSnippet: zod_1.z.string().default(""),
    stderrSnippet: zod_1.z.string().default(""),
    truncated: zod_1.z.boolean().default(false),
    timestamp: zod_1.z.string(),
});
// --- Browser / UI Verification Evidence ---
exports.BrowserVerificationEvidenceSchema = zod_1.z.object({
    id: zod_1.z.string(),
    taskId: zod_1.z.string(),
    attemptId: zod_1.z.string(),
    url: zod_1.z.string(),
    viewport: zod_1.z.object({ width: zod_1.z.number(), height: zod_1.z.number() }),
    assertionsPassed: zod_1.z.number(),
    assertionsFailed: zod_1.z.number(),
    consoleErrors: zod_1.z.array(zod_1.z.string()).default([]),
    networkFailures: zod_1.z.array(zod_1.z.string()).default([]),
    screenshotArtifactId: zod_1.z.string().nullable().default(null),
    durationMs: zod_1.z.number(),
    passed: zod_1.z.boolean(),
    timestamp: zod_1.z.string(),
});
// --- Budget and Cost Controls ---
exports.BudgetLimitsSchema = zod_1.z.object({
    perTaskWarningUsd: zod_1.z.number().default(0.5),
    perTaskHardUsd: zod_1.z.number().default(2.0),
    perRunHardUsd: zod_1.z.number().default(10.0),
    maxRepairsPerTask: zod_1.z.number().default(2),
    maxReasoningCallsPerTask: zod_1.z.number().default(12),
    maxReasoningCallsPerRun: zod_1.z.number().default(40),
    maxTasksPerRun: zod_1.z.number().default(20),
    maxIterationsPerRun: zod_1.z.number().default(30),
});
exports.CostStateSchema = zod_1.z.enum([
    "measured",
    "estimated",
    "reserved",
    "unknown",
    "local_no_api_charge",
]);
exports.BudgetUsageSchema = zod_1.z.object({
    measuredCostUsd: zod_1.z.number().default(0),
    estimatedCostUsd: zod_1.z.number().default(0),
    reservedCostUsd: zod_1.z.number().default(0),
    totalInputTokens: zod_1.z.number().default(0),
    totalOutputTokens: zod_1.z.number().default(0),
    totalRequests: zod_1.z.number().default(0),
    costState: exports.CostStateSchema.default("local_no_api_charge"),
});
// --- Provider & Privacy Definitions ---
exports.PrivacyClassSchema = zod_1.z.enum(["local", "cloud", "unknown"]);
exports.ProviderProfileSchema = zod_1.z.object({
    id: zod_1.z.string(),
    displayName: zod_1.z.string(),
    type: zod_1.z.enum(["openai", "openai_compatible_local", "mock"]),
    endpoint: zod_1.z.string(),
    modelId: zod_1.z.string(),
    privacyClass: exports.PrivacyClassSchema,
    isReasoningProvider: zod_1.z.boolean().default(true),
    isCodingAgent: zod_1.z.boolean().default(false),
    enabled: zod_1.z.boolean().default(true),
});
// --- Human Messages / Directions ---
exports.HumanMessageKindSchema = zod_1.z.enum([
    "guidance",
    "replan",
    "safe_interrupt",
    "priority_override",
    "scope_change",
]);
exports.HumanMessageSchema = zod_1.z.object({
    id: zod_1.z.string(),
    projectId: zod_1.z.string(),
    kind: exports.HumanMessageKindSchema,
    content: zod_1.z.string().min(1),
    priority: zod_1.z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    status: zod_1.z.enum(["pending", "consumed", "canceled"]).default("pending"),
    createdAt: zod_1.z.string(),
    consumedAt: zod_1.z.string().nullable().default(null),
});
// --- Events (Durable SSE Event Log) ---
exports.RunEventSchema = zod_1.z.object({
    id: zod_1.z.string(),
    eventSeq: zod_1.z.number(),
    projectId: zod_1.z.string(),
    runId: zod_1.z.string().nullable().default(null),
    taskId: zod_1.z.string().nullable().default(null),
    type: zod_1.z.string(),
    payload: zod_1.z.record(zod_1.z.unknown()),
    timestamp: zod_1.z.string(),
});
//# sourceMappingURL=index.js.map