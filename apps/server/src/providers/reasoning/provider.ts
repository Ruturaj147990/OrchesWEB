import { PrivacyClass } from "@orchestrator/shared-types";

export type ReasoningOperation =
  | "project_analysis"
  | "requirement_extraction"
  | "task_planning"
  | "code_generation"
  | "result_review"
  | "repair_diagnosis"
  | "memory_summary"
  | "backlog_prioritization";

export interface ReasoningRequest {
  operation: ReasoningOperation;
  systemInstruction: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Ask the provider for a JSON object response (JSON mode). */
  json?: boolean;
  /** @deprecated use `json`; kept so older callers still request JSON mode. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  dataClassification?: "public" | "internal" | "sensitive";
  projectId: string;
  runId?: string;
  taskId?: string;
}

export interface ReasoningResult {
  text: string;
  parsed?: unknown;
  providerId: string;
  modelId: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs: number;
  warnings: string[];
}

export type ProviderConnectionStatus =
  | "not_detected"
  | "server_unreachable"
  | "server_responding"
  | "model_installed"
  | "model_unavailable"
  | "model_loading"
  | "warming_up"
  | "request_succeeded"
  | "request_failed"
  | "ready";

export interface ProviderHealth {
  ok: boolean;
  status?: ProviderConnectionStatus;
  latencyMs?: number;
  message?: string;
  discoveredModels?: string[];
  serverVersion?: string;
  installCommand?: string;
  normalizedOrigin?: string;
}

export interface ReasoningProvider {
  id: string;
  displayName: string;
  privacyClass: PrivacyClass;
  /** Model identifier that `generate` will use. */
  getModel(): string;
  healthCheck(): Promise<ProviderHealth>;
  listModels?(): Promise<string[]>;
  generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult>;
}

export function wantsJson(request: ReasoningRequest): boolean {
  return Boolean(request.json || request.responseSchema);
}

export function ledgerRequestType(op: ReasoningOperation): "planner" | "critic" | "agent_coding" | "test_generation" {
  if (op === "result_review") return "critic";
  if (op === "code_generation") return "agent_coding";
  if (op === "project_analysis") return "test_generation";
  return "planner";
}
