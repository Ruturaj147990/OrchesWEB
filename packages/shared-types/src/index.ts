import { z } from "zod";

// --- Project & Autonomy ---
export const AutonomyModeSchema = z.enum([
  "creative_within_constraints",
  "creative_exploration",
  "strict_blueprint_adherence",
]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

export const ProjectStatusSchema = z.enum([
  "draft",
  "ready",
  "active",
  "paused",
  "completed",
  "archived",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  objective: z.string().default(""),
  rootPath: z.string(),
  profileId: z.string().default("general"),
  autonomyMode: AutonomyModeSchema.default("creative_within_constraints"),
  status: ProjectStatusSchema.default("draft"),
  /** Verification commands the user configured; when empty, checks are detected from project files. */
  verificationCommands: z.array(z.string()).default([]),
  /** Commit accepted changes on the current branch when the workspace is a clean Git work tree. */
  autoCommit: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

// --- Run Lifecycle ---
export const RunStatusSchema = z.enum([
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
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: RunStatusSchema.default("ready"),
  currentTaskId: z.string().nullable().default(null),
  iterationCount: z.number().default(0),
  stopReason: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  endedAt: z.string().nullable().default(null),
  taskText: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  providerId: z.string().nullable().default(null),
  modelId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  /** verified | unverified | rejected | error | cancelled — set when the run finishes. */
  outcome: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  safetyMode: z.string().nullable().default(null),
  commitSha: z.string().nullable().default(null),
});
export type Run = z.infer<typeof RunSchema>;

// --- Task Lifecycle & Contract ---
export const TaskStatusSchema = z.enum([
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
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
  verification: z.enum([
    "lint",
    "typecheck",
    "unit_test",
    "integration_test",
    "build",
    "browser_ui",
    "manual_review",
  ]).default("integration_test"),
  status: z.enum(["pending", "passed", "failed", "unverified"]).default("pending"),
  evidenceId: z.string().optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  runId: z.string().nullable().default(null),
  title: z.string().min(1),
  objective: z.string(),
  roadmapItemId: z.string(),
  requirementIds: z.array(z.string()).default([]),
  status: TaskStatusSchema.default("queued"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  allowedPaths: z.array(z.string()).default(["**/*"]),
  forbiddenPaths: z.array(z.string()).default([".env*", ".orchestrator/**", "**/*.pem"]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
  verificationPlan: z.array(z.string()).default(["npm test"]),
  attemptCount: z.number().default(0),
  currentAttemptId: z.string().nullable().default(null),
  maxAttempts: z.number().default(3),
  requiresApproval: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

// --- Normalized Coding Agent Report (Wire Contract) ---
export const AgentTestClaimSchema = z.object({
  command: z.string(),
  agent_claim: z.enum(["passed", "failed", "skipped"]),
  claimed_exit_code: z.number().optional(),
});

export const AgentReportSchema = z.object({
  schema_version: z.literal(1).default(1),
  task_id: z.string(),
  attempt_id: z.string(),
  status: z.enum([
    "reported_complete",
    "reported_failed",
    "blocked",
    "awaiting_permission",
    "question",
  ]),
  summary: z.string(),
  files_changed: z.array(z.string()).default([]),
  tests: z.array(AgentTestClaimSchema).default([]),
  blockers: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  requires_human: z.boolean().default(false),
  agent_session_id: z.string().nullable().default(null),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;

// --- Planner Machine Response Schema ---
export const PlannedTaskSchema = z.object({
  task_id: z.string(),
  roadmap_item_id: z.string(),
  requirement_ids: z.array(z.string()).default([]),
  title: z.string(),
  objective: z.string(),
  allowed_paths: z.array(z.string()).default(["**/*"]),
  acceptance_criteria: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      required: z.boolean().default(true),
      verification: z.enum([
        "lint",
        "typecheck",
        "unit_test",
        "integration_test",
        "build",
        "browser_ui",
        "manual_review",
      ]).default("integration_test"),
    })
  ),
  verification_plan_ids: z.array(z.string()).default(["test", "build"]),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  estimated_cost_usd: z.number().nullable().optional(),
  requires_approval: z.boolean().default(false),
});

export const PlannerOutputSchema = z.object({
  schema_version: z.literal(1).default(1),
  decision: z.enum([
    "dispatch_task",
    "replan_proposal",
    "needs_human",
    "no_eligible_work",
    "stop",
  ]),
  rationale: z.string(),
  next_task: PlannedTaskSchema.nullable().default(null),
  roadmap_proposals: z.array(z.record(z.unknown())).default([]),
  open_questions: z.array(z.string()).default([]),
  stop: z.boolean().default(false),
  stop_reason: z.string().nullable().default(null),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// --- Independent Critic Schema ---
export const CriticCriterionResultSchema = z.object({
  criterion_id: z.string(),
  status: z.enum(["passed", "failed", "unverified"]),
  evidence_ids: z.array(z.string()).default([]),
  reason: z.string(),
});

export const CriticReviewSchema = z.object({
  schema_version: z.literal(1).default(1),
  task_id: z.string(),
  attempt_id: z.string(),
  verdict: z.enum(["accept", "repair", "reject_out_of_scope", "needs_human", "stop"]),
  criteria: z.array(CriticCriterionResultSchema),
  scope_drift: z.object({
    detected: z.boolean(),
    details: z.array(z.string()).default([]),
  }),
  quality_findings: z.array(
    z.object({
      severity: z.enum(["low", "medium", "high", "critical"]),
      finding: z.string(),
      evidence_ids: z.array(z.string()).default([]),
      suggested_action: z.string(),
    })
  ).default([]),
  missing_evidence: z.array(z.string()).default([]),
  repair_instructions: z.array(z.string()).default([]),
  roadmap_or_spec_proposal: z.string().nullable().default(null),
  requires_human: z.boolean().default(false),
  rationale: z.string(),
});
export type CriticReview = z.infer<typeof CriticReviewSchema>;

// --- Verification Evidence ---
export const VerificationCheckTypeSchema = z.enum([
  "lint",
  "typecheck",
  "test",
  "build",
  "browser_ui",
  "security",
  "custom",
]);
export type VerificationCheckType = z.infer<typeof VerificationCheckTypeSchema>;

export const VerificationResultSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  attemptId: z.string(),
  checkType: VerificationCheckTypeSchema,
  command: z.string(),
  argv: z.array(z.string()),
  cwd: z.string(),
  status: z.enum(["passed", "failed", "skipped", "timeout"]),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  outputArtifactId: z.string().nullable().default(null),
  stdoutSnippet: z.string().default(""),
  stderrSnippet: z.string().default(""),
  truncated: z.boolean().default(false),
  timestamp: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// --- Browser / UI Verification Evidence ---
export const BrowserVerificationEvidenceSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  attemptId: z.string(),
  url: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  assertionsPassed: z.number(),
  assertionsFailed: z.number(),
  consoleErrors: z.array(z.string()).default([]),
  networkFailures: z.array(z.string()).default([]),
  screenshotArtifactId: z.string().nullable().default(null),
  durationMs: z.number(),
  passed: z.boolean(),
  timestamp: z.string(),
});
export type BrowserVerificationEvidence = z.infer<typeof BrowserVerificationEvidenceSchema>;

// --- Budget and Cost Controls ---
export const BudgetLimitsSchema = z.object({
  perTaskWarningUsd: z.number().default(0.5),
  perTaskHardUsd: z.number().default(2.0),
  perRunHardUsd: z.number().default(10.0),
  maxRepairsPerTask: z.number().default(2),
  maxReasoningCallsPerTask: z.number().default(12),
  maxReasoningCallsPerRun: z.number().default(40),
  maxTasksPerRun: z.number().default(20),
  maxIterationsPerRun: z.number().default(30),
});
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

export const CostStateSchema = z.enum([
  "measured",
  "estimated",
  "reserved",
  "unknown",
  "local_no_api_charge",
]);
export type CostState = z.infer<typeof CostStateSchema>;

export const BudgetUsageSchema = z.object({
  measuredCostUsd: z.number().default(0),
  estimatedCostUsd: z.number().default(0),
  reservedCostUsd: z.number().default(0),
  totalInputTokens: z.number().default(0),
  totalOutputTokens: z.number().default(0),
  totalRequests: z.number().default(0),
  costState: CostStateSchema.default("local_no_api_charge"),
});
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

// --- Provider & Privacy Definitions ---
export const PrivacyClassSchema = z.enum(["local", "cloud", "unknown"]);
export type PrivacyClass = z.infer<typeof PrivacyClassSchema>;

export const ProviderProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.enum(["openai", "openai_compatible_local", "mock"]),
  endpoint: z.string(),
  modelId: z.string(),
  privacyClass: PrivacyClassSchema,
  isReasoningProvider: z.boolean().default(true),
  isCodingAgent: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// --- Human Messages / Directions ---
export const HumanMessageKindSchema = z.enum([
  "guidance",
  "replan",
  "safe_interrupt",
  "priority_override",
  "scope_change",
]);
export type HumanMessageKind = z.infer<typeof HumanMessageKindSchema>;

export const HumanMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: HumanMessageKindSchema,
  content: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["pending", "consumed", "canceled"]).default("pending"),
  createdAt: z.string(),
  consumedAt: z.string().nullable().default(null),
});
export type HumanMessage = z.infer<typeof HumanMessageSchema>;

// --- Events (Durable SSE Event Log) ---
export const RunEventSchema = z.object({
  id: z.string(),
  eventSeq: z.number(),
  projectId: z.string(),
  runId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  type: z.string(),
  payload: z.record(z.unknown()),
  timestamp: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

// --- Visible Antigravity IDE Integration ---
export const IdeConnectionStepSchema = z.enum([
  "ide_detected",
  "workspace_identified",
  "connection_established",
  "workspace_confirmed",
  "agent_tested",
  "ready",
]);
export type IdeConnectionStep = z.infer<typeof IdeConnectionStepSchema>;

export const IdeStageStatusSchema = z.enum(["pending", "in_progress", "passed", "failed"]);
export type IdeStageStatus = z.infer<typeof IdeStageStatusSchema>;

export const IdeStageInfoSchema = z.object({
  status: IdeStageStatusSchema.default("pending"),
  message: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type IdeStageInfo = z.infer<typeof IdeStageInfoSchema>;

export const IdeWorkspaceInfoSchema = z.object({
  id: z.string(),
  folderUri: z.string(),
  canonicalPath: z.string(),
  name: z.string(),
  isMatchingProject: z.boolean().default(false),
  isActiveWindow: z.boolean().default(false),
  processId: z.number().nullable().optional(),
  lastHeartbeat: z.string().nullable().optional(),
});
export type IdeWorkspaceInfo = z.infer<typeof IdeWorkspaceInfoSchema>;

export const IdeExecutionModeSchema = z.enum(["visible_ide", "headless_cli"]);
export type IdeExecutionMode = z.infer<typeof IdeExecutionModeSchema>;

export const IdeConnectionStateSchema = z.object({
  status: z.enum(["disconnected", "detecting", "connected", "ready", "error"]).default("disconnected"),
  stages: z.object({
    ide_detected: IdeStageInfoSchema,
    workspace_identified: IdeStageInfoSchema,
    connection_established: IdeStageInfoSchema,
    workspace_confirmed: IdeStageInfoSchema,
    agent_tested: IdeStageInfoSchema,
    ready: IdeStageInfoSchema,
  }),
  detectedWorkspaces: z.array(IdeWorkspaceInfoSchema).default([]),
  selectedWorkspace: IdeWorkspaceInfoSchema.nullable().default(null),
  activeMode: IdeExecutionModeSchema.default("visible_ide"),
  agentBridgeType: z.enum(["agentapi_native", "ide_workspace_bridge", "headless_cli"]).default("agentapi_native"),
  lastHeartbeat: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
});
export type IdeConnectionState = z.infer<typeof IdeConnectionStateSchema>;

