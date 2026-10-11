import { PrivacyClass } from "@orchestrator/shared-types";

export type ReasoningOperation =
  | "project_analysis"
  | "requirement_extraction"
  | "task_planning"
  | "result_review"
  | "repair_diagnosis"
  | "memory_summary"
  | "backlog_prioritization";

export interface ReasoningRequest {
  operation: ReasoningOperation;
  systemInstruction: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputTokens?: number;
  dataClassification: "public" | "internal" | "sensitive";
  projectId: string;
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
  healthCheck(): Promise<ProviderHealth>;
  listModels?(): Promise<string[]>;
  generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult>;
}
