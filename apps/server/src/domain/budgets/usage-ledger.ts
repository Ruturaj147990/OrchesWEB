import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { DEFAULT_PRICING_CATALOGUE } from "./budget-service.js";

export interface UsageRecord {
  id: string;
  providerId: string;
  modelId: string;
  requestType: "planner" | "critic" | "repair" | "summary" | "test_generation" | "agent_coding";
  projectId?: string;
  runId?: string;
  taskId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  success: boolean;
  costState: "measured" | "estimated" | "local_no_api_charge" | "unknown";
  timestamp: string;
  errorMessage?: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  recentRecords: UsageRecord[];
}

export class ReasoningUsageLedger {
  private static instance: ReasoningUsageLedger | null = null;
  private db: DatabaseSync | null = null;
  private memoryRecords: UsageRecord[] = [];

  constructor(db?: DatabaseSync) {
    if (db) {
      this.db = db;
      this.initTable();
    }
  }

  public static getShared(db?: DatabaseSync): ReasoningUsageLedger {
    if (!ReasoningUsageLedger.instance) {
      ReasoningUsageLedger.instance = new ReasoningUsageLedger(db);
    } else if (db && !ReasoningUsageLedger.instance.db) {
      ReasoningUsageLedger.instance.db = db;
      ReasoningUsageLedger.instance.initTable();
    }
    return ReasoningUsageLedger.instance;
  }

  private initTable(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS reasoning_usage_ledger (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          request_type TEXT NOT NULL,
          project_id TEXT,
          run_id TEXT,
          task_id TEXT,
          prompt_tokens INTEGER NOT NULL,
          completion_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          estimated_cost_usd REAL NOT NULL,
          duration_ms INTEGER NOT NULL,
          success INTEGER NOT NULL,
          cost_state TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          error_message TEXT
        );
      `);
    } catch (err) {
      console.error("[ReasoningUsageLedger] Failed to init table:", err);
    }
  }

  public calculateCost(modelId: string, promptTokens: number, completionTokens: number): {
    costUsd: number;
    costState: "measured" | "estimated" | "local_no_api_charge";
  } {
    const pricing = DEFAULT_PRICING_CATALOGUE[modelId];
    if (!pricing || pricing.provider === "local") {
      return { costUsd: 0, costState: "local_no_api_charge" };
    }
    const cost =
      (promptTokens * pricing.inputPerMillionUsd) / 1_000_000 +
      (completionTokens * pricing.outputPerMillionUsd) / 1_000_000;
    return { costUsd: cost, costState: "measured" };
  }

  public record(params: {
    providerId: string;
    modelId: string;
    requestType: "planner" | "critic" | "repair" | "summary" | "test_generation" | "agent_coding";
    projectId?: string;
    runId?: string;
    taskId?: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    success?: boolean;
    errorMessage?: string;
  }): UsageRecord {
    const totalTokens = params.promptTokens + params.completionTokens;
    const { costUsd, costState } = this.calculateCost(params.modelId, params.promptTokens, params.completionTokens);

    const record: UsageRecord = {
      id: `usage-${crypto.randomUUID()}`,
      providerId: params.providerId,
      modelId: params.modelId,
      requestType: params.requestType,
      projectId: params.projectId,
      runId: params.runId,
      taskId: params.taskId,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens,
      estimatedCostUsd: costUsd,
      durationMs: params.durationMs,
      success: params.success !== false,
      costState,
      timestamp: new Date().toISOString(),
      errorMessage: params.errorMessage,
    };

    this.memoryRecords.unshift(record);
    if (this.memoryRecords.length > 500) {
      this.memoryRecords.pop();
    }

    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO reasoning_usage_ledger (
            id, provider_id, model_id, request_type, project_id, run_id, task_id,
            prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
            duration_ms, success, cost_state, timestamp, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.providerId,
          record.modelId,
          record.requestType,
          record.projectId || null,
          record.runId || null,
          record.taskId || null,
          record.promptTokens,
          record.completionTokens,
          record.totalTokens,
          record.estimatedCostUsd,
          record.durationMs,
          record.success ? 1 : 0,
          record.costState,
          record.timestamp,
          record.errorMessage || null
        );
      } catch (err) {
        console.error("[ReasoningUsageLedger] Failed to insert usage record:", err);
      }
    }

    return record;
  }

  public getSummary(projectId?: string): UsageSummary {
    if (this.db) {
      try {
        const filter = projectId ? "WHERE project_id = ?" : "";
        const row = this.db.prepare(`
          SELECT 
            COUNT(*) as total_requests,
            COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd
          FROM reasoning_usage_ledger
          ${filter}
        `).get(...(projectId ? [projectId] : [])) as {
          total_requests: number;
          total_prompt_tokens: number;
          total_completion_tokens: number;
          total_tokens: number;
          total_cost_usd: number;
        };

        const records = this.db.prepare(`
          SELECT * FROM reasoning_usage_ledger
          ${filter}
          ORDER BY timestamp DESC
          LIMIT 25
        `).all(...(projectId ? [projectId] : [])) as Array<any>;

        return {
          totalRequests: row?.total_requests || 0,
          totalPromptTokens: row?.total_prompt_tokens || 0,
          totalCompletionTokens: row?.total_completion_tokens || 0,
          totalTokens: row?.total_tokens || 0,
          totalCostUsd: Number((row?.total_cost_usd || 0).toFixed(4)),
          recentRecords: records.map((r) => ({
            id: r.id,
            providerId: r.provider_id,
            modelId: r.model_id,
            requestType: r.request_type,
            projectId: r.project_id,
            runId: r.run_id,
            taskId: r.task_id,
            promptTokens: r.prompt_tokens,
            completionTokens: r.completion_tokens,
            totalTokens: r.total_tokens,
            estimatedCostUsd: r.estimated_cost_usd,
            durationMs: r.duration_ms,
            success: Boolean(r.success),
            costState: r.cost_state,
            timestamp: r.timestamp,
            errorMessage: r.error_message,
          })),
        };
      } catch {}
    }

    // Memory fallback
    const filtered = projectId
      ? this.memoryRecords.filter((r) => r.projectId === projectId)
      : this.memoryRecords;

    const totalRequests = filtered.length;
    const totalPromptTokens = filtered.reduce((acc, r) => acc + r.promptTokens, 0);
    const totalCompletionTokens = filtered.reduce((acc, r) => acc + r.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const totalCostUsd = Number(filtered.reduce((acc, r) => acc + r.estimatedCostUsd, 0).toFixed(4));

    return {
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd,
      recentRecords: filtered.slice(0, 25),
    };
  }
}
