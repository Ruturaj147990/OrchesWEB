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

export interface ProviderHealth {
  ok: boolean;
  latencyMs?: number;
  message?: string;
  discoveredModels?: string[];
}

export interface ReasoningProvider {
  id: string;
  displayName: string;
  privacyClass: PrivacyClass;
  healthCheck(): Promise<ProviderHealth>;
  listModels?(): Promise<string[]>;
  generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult>;
}
