export type AutonomyMode = "creative_within_constraints" | "creative_exploration" | "strict_blueprint_adherence";

export interface ProjectProfileDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  engineeringGuidelines: string[];
  focusAreas: string[];
  suggestedAcceptanceCriteria: string[];
}

export interface ImportedBlueprint {
  id: string;
  filename: string;
  extension: string;
  sha256: string;
  byteSize: number;
  extractedText: string;
  warnings: string[];
  importedAt: string;
}

export interface CandidateRequirement {
  id: string;
  projectId: string;
  blueprintId?: string;
  title: string;
  description: string;
  provenanceKind: "explicit" | "inferred";
  sourceReference: string;
  status: "candidate" | "approved" | "rejected";
  proposedAcceptanceTest: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  objective: string;
  rootPath: string;
  status: string;
  profileId: string;
  autonomyMode: AutonomyMode;
  verificationCommands: string[];
  autoCommit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInfo {
  exists: boolean;
  rootPath: string;
  profile?: {
    isEmpty: boolean;
    fileCount: number;
    languages: string[];
    manifests: string[];
    checks: Array<{ id: string; label: string; source: string; kind: string }>;
    notes: string[];
  };
  git?: {
    isGitRepo: boolean;
    activeBranch: string | null;
    isDirty: boolean;
    dirtyFiles: string[];
    hasRemote: boolean;
    safetyMode: "git" | "local_snapshot";
  };
}

export interface Run {
  id: string;
  projectId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  taskText: string | null;
  title: string | null;
  providerId: string | null;
  modelId: string | null;
  agentId: string | null;
  outcome: string | null;
  summary: string | null;
  safetyMode: string | null;
  commitSha: string | null;
  iterationCount: number;
}

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface CheckRecord {
  phase: "baseline" | "static" | "attempt";
  kind: string;
  label: string;
  source: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
}

export interface Attempt {
  id: string;
  number: number;
  status: string;
  agentSummary: string | null;
  agentError: string | null;
  /** Instruction the reasoning model wrote for an external coding agent (closed-loop mode). */
  instruction: string | null;
  transcript: {
    conversationId: string | null;
    state: string;
    finalReply: string;
    toolCalls: Array<{ tool: string; summary: string }>;
    writesOutsideWorkspace: string[];
  } | null;
  files: FileChange[];
  diff: string;
  gate: {
    accepted: boolean;
    outcome: string;
    blockers: string[];
    warnings: string[];
    evidence: string[];
    critic?: { available: boolean; error?: string; verdict: string; summary: string; criteria: Array<{ id: string; status: string; reason: string }>; findings: Array<{ severity: string; message: string }> };
  } | null;
  rollback: { restored: string[]; removed: string[]; failed: Array<{ path: string; error: string }>; backupDir: string | null } | null;
  checks: CheckRecord[];
}

export interface RunDetail {
  run: Run & { active: boolean };
  details: { warnings?: string[]; evidence?: string[]; usage?: { requests: number; totalTokens: number; costUsd: number; costKnown: boolean }; rollback?: Attempt["rollback"] };
  task: { id: string; title: string; status: string; acceptanceCriteria: string[] } | null;
  attempts: Attempt[];
}

export interface Settings {
  activeProviderId: "chatgpt-web";
  activeModel: string;
  chatgptWeb: {
    headless: boolean;
    profileDir: string;
    timeoutMs: number;
    browserState?: string;
  };
  codingAgentId: string;
  codingAgents: Array<{ id: string; name: string; description: string; usesReasoningProvider: boolean; available: boolean; detail: string }>;
  maxAttempts: number;
}

export interface ProviderHealth {
  ok: boolean;
  status?: string;
  message?: string;
  discoveredModels?: string[];
  latencyMs?: number;
}

export interface IdeStatus {
  installed: boolean;
  running: boolean;
  openFolders: string[];
  workspaceOpen: boolean;
  nativeAgent: { available: boolean; reason: string; bridgeInstalled: boolean };
}

export interface RunEvent {
  id: string;
  eventSeq: number;
  projectId: string;
  runId: string | null;
  type: string;
  payload: Record<string, any>;
  timestamp: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${url}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the orchestrator server. Is it running?", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(data?.error || data?.message || `Request failed (HTTP ${res.status})`, res.status);
  return data as T;
}

export const api = {
  health: () => request<{ status: string }>("GET", "/health"),
  projects: () => request<Project[]>("GET", "/projects"),
  createProject: (body: { name: string; objective?: string; rootPath: string; createFolder?: boolean; profileId?: string; autonomyMode?: AutonomyMode; verificationCommands?: string[]; autoCommit?: boolean }) =>
    request<Project>("POST", "/projects", body),
  updateProject: (id: string, body: Partial<Pick<Project, "name" | "objective" | "rootPath" | "profileId" | "autonomyMode" | "verificationCommands" | "autoCommit">>) => request<Project>("PATCH", `/projects/${id}`, body),
  removeProject: (id: string) => request<{ success: boolean }>("DELETE", `/projects/${id}`),
  workspace: (id: string) => request<WorkspaceInfo>("GET", `/projects/${id}/workspace`),
  initGit: (id: string) => request<{ message: string }>("POST", `/projects/${id}/git/init`),
  runs: (id: string) => request<{ runs: Run[] }>("GET", `/projects/${id}/runs`),
  startRun: (id: string, task: string) => request<Run>("POST", `/projects/${id}/runs`, { task }),
  stopRun: (runId: string) => request<Run>("POST", `/runs/${runId}/stop`),
  runDetail: (runId: string) => request<RunDetail>("GET", `/runs/${runId}`),
  sendGuidance: (projectId: string, content: string) => request("POST", `/projects/${projectId}/messages`, { kind: "guidance", content }),
  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (body: Record<string, unknown>) => request<Settings>("PUT", "/settings", body),
  checkProvider: (id: string = "chatgpt-web") => request<ProviderHealth>("POST", `/settings/providers/${id}/check`),
  testProvider: (id: string = "chatgpt-web") => request<{ ok: boolean; output?: string; durationMs?: number; model?: string }>("POST", `/settings/providers/${id}/test`),
  openBrowser: () => request<{ ok: boolean; url: string; state: string; profileDir: string }>("POST", "/settings/browser/open"),
  localModels: (_baseUrl?: string) => Promise.resolve({ models: [] }),
  ideStatus: (projectId?: string) => request<IdeStatus>("GET", `/ide/status${projectId ? `?projectId=${projectId}` : ""}`),
  openInIde: (projectId: string) => request<{ message: string }>("POST", `/projects/${projectId}/open-in-ide`),
  profiles: () => request<ProjectProfileDefinition[]>("GET", "/profiles"),
  blueprints: (projectId: string) => request<ImportedBlueprint[]>("GET", `/projects/${projectId}/blueprints`),
  uploadBlueprint: (projectId: string, filename: string, contentText?: string, contentBase64?: string) =>
    request<{ document: ImportedBlueprint; requirements: CandidateRequirement[] }>("POST", `/projects/${projectId}/blueprints`, { filename, contentText, contentBase64 }),
  deleteBlueprint: (projectId: string, blueprintId: string) => request<{ success: boolean }>("DELETE", `/projects/${projectId}/blueprints/${blueprintId}`),
  requirements: (projectId: string) => request<CandidateRequirement[]>("GET", `/projects/${projectId}/requirements`),
  updateRequirement: (projectId: string, requirementId: string, patch: Partial<CandidateRequirement>) =>
    request<CandidateRequirement>("PATCH", `/projects/${projectId}/requirements/${requirementId}`, patch),
  conversations: (projectId: string) => request<{ conversations: ConversationSummary[] }>("GET", `/projects/${projectId}/conversations`),
  conversationDetail: (conversationId: string) => request<ConversationDetail>("GET", `/conversations/${conversationId}`),
  createConversation: (projectId: string, title?: string, initialInstruction?: string) =>
    request<{ conversation: ConversationSummary }>("POST", `/projects/${projectId}/conversations`, { title, initialInstruction }),
  updateConversation: (conversationId: string, updates: { title?: string; status?: string }) =>
    request<{ conversation: ConversationSummary }>("PATCH", `/conversations/${conversationId}`, updates),
  resumeConversation: (conversationId: string, taskText: string, maxAttempts?: number) =>
    request<{ run: Run; conversation: ConversationSummary }>("POST", `/conversations/${conversationId}/resume`, { taskText, maxAttempts }),
  deleteConversation: (conversationId: string) =>
    request<{ ok: boolean; deletedId: string }>("DELETE", `/conversations/${conversationId}`),
};

export interface ConversationSummary {
  id: string;
  projectId: string;
  title: string;
  status: "active" | "archived" | "completed";
  createdAt: string;
  updatedAt: string;
  resumedRunId: string | null;
  messageCount: number;
  lastActivityAt: string | null;
  hasMemorySnapshot: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool" | "orchestrator";
  content: string;
  meta: Record<string, any>;
  createdAt: string;
}

export interface ConversationMemorySnapshot {
  id: string;
  conversationId: string;
  snapshotMarkdown: string;
  tokenCount: number;
  meta: Record<string, any>;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: {
    id: string;
    projectId: string;
    title: string;
    status: "active" | "archived" | "completed";
    createdAt: string;
    updatedAt: string;
    resumedRunId: string | null;
    latestSnapshotId: string | null;
    messageCount: number;
    lastActivityAt: string | null;
  };
  messages: ConversationMessage[];
  latestSnapshot: ConversationMemorySnapshot | null;
}

export const AUTONOMY_MODE_LABELS: Record<AutonomyMode, { label: string; description: string }> = {
  creative_within_constraints: {
    label: "Creative with constraints",
    description: "Balances innovation with strict requirement boundaries and safety.",
  },
  creative_exploration: {
    label: "Creative exploration",
    description: "Autonomy to explore alternative architectures and re-evaluate soft constraints.",
  },
  strict_blueprint_adherence: {
    label: "Strict blueprint adherence",
    description: "Exact, faithful implementation of explicit requirements without unsolicited features.",
  },
};

export const PROVIDER_LABELS: Record<string, string> = {
  "chatgpt-web": "ChatGPT Web",
};

export const AGENT_LABELS: Record<string, string> = {
  builtin: "Built-in coder",
  antigravity: "Antigravity Agent",
  mock: "Scripted test agent",
};

/** Human wording for a run's state; the single source for badges and headings. */
export function describeRun(run: Pick<Run, "status" | "outcome">): { label: string; tone: "neutral" | "running" | "success" | "warning" | "danger" } {
  if (run.status === "running" || run.status === "ready") return { label: "Running", tone: "running" };
  switch (run.outcome) {
    case "verified":
      return { label: "Verified", tone: "success" };
    case "unverified":
      return { label: "Done — not fully verified", tone: "warning" };
    case "rejected":
      return { label: "Needs Revision (Preserved)", tone: "warning" };
    case "cancelled":
      return { label: "Stopped", tone: "neutral" };
    case "error":
      return { label: "Failed", tone: "danger" };
    default:
      return { label: run.status.replace(/_/g, " "), tone: "neutral" };
  }
}
