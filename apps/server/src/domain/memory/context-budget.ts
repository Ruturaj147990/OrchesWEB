import { ReasoningProvider } from "../../providers/reasoning/provider.js";
import { SettingsManager } from "../../platform/settings-manager.js";

export interface MeasuredContextComponents {
  systemInstructionTokens?: number;
  activeTaskTokens?: number;
  requirementTokens?: number;
  memorySnapshotTokens?: number;
  evidenceTokens?: number;
  maxOutputTokens?: number;
  safetyMarginPct?: number;
}

export interface ContextBudget {
  providerId: string;
  modelId: string;
  totalContextTokens: number;
  reserveTokens: number;
  availableHistoryBudget: number;
  compactionThresholdTokens: number;
  safetyMarginTokens: number;
  breakdown: {
    systemTokens: number;
    specificationTokens: number;
    evidenceTokens: number;
    maxOutputTokens: number;
    safetyMarginTokens: number;
  };
}

/**
 * Approximates token count using character length (~4 chars per token).
 * Handles null/undefined and empty strings safely.
 */
export function estimateTokens(content: string | null | undefined): number {
  if (!content) return 0;
  return Math.ceil(content.length / 4);
}

/**
 * Calculates a model-aware context budget.
 * Accurately scales between local Ollama (e.g. 16k tokens) and cloud OpenAI (e.g. 128k tokens)
 * without hardcoding single-provider limits.
 *
 * Defines and accounts for:
 * - Model context capacity (provider-reported or model configuration fallback)
 * - System and orchestration instructions (~1,500 tokens or measured)
 * - Active specification and requirements (~2,500 tokens or measured)
 * - Verification evidence (~2,000 tokens or measured)
 * - Reserved generation output (~3,500 tokens or scaled for small windows)
 * - Safety margin (~5% of total context limit)
 * - Compaction trigger (70% of available history budget)
 */
export function calculateContextBudget(
  provider: ReasoningProvider,
  options?: MeasuredContextComponents
): ContextBudget {
  let totalContextTokens: number;

  if (typeof provider.getContextWindow === "function") {
    totalContextTokens = provider.getContextWindow();
  } else {
    const settings = SettingsManager.loadSettings();
    if (provider.id === "openai") {
      const m = provider.getModel().toLowerCase();
      if (m.includes("gpt-4o") || m.includes("o1") || m.includes("o3") || m.includes("o4")) {
        totalContextTokens = 128_000;
      } else if (m.includes("gpt-4")) {
        totalContextTokens = 8_192;
      } else if (m.includes("gpt-3.5")) {
        totalContextTokens = 16_385;
      } else {
        totalContextTokens = 32_768;
      }
    } else {
      totalContextTokens = settings.localContextTokens || 16_384;
    }
  }

  // Ensure reasonable bounds (minimum 2048)
  totalContextTokens = Math.max(2048, totalContextTokens);

  // 1. Safety margin (5% of window, bounded between 100 and 2,000 tokens)
  const safetyMarginPct = options?.safetyMarginPct ?? 0.05;
  const safetyMarginTokens = Math.max(100, Math.min(2000, Math.floor(totalContextTokens * safetyMarginPct)));

  // 2. Reserved generation output (default 3,500, scaled down for small context windows)
  let maxOutputTokens = options?.maxOutputTokens ?? 3500;
  if (totalContextTokens <= 4096) {
    maxOutputTokens = Math.min(maxOutputTokens, Math.floor(totalContextTokens * 0.25));
  } else if (totalContextTokens <= 8192) {
    maxOutputTokens = Math.min(maxOutputTokens, Math.floor(totalContextTokens * 0.30));
  }

  // 3. System instruction tokens (default baseline 1,500 or measured)
  let systemTokens = options?.systemInstructionTokens ?? 1500;
  if (totalContextTokens <= 4096) {
    systemTokens = Math.min(systemTokens, Math.floor(totalContextTokens * 0.20));
  }

  // 4. Active specification and requirements tokens (default baseline 2,500 or measured)
  let specificationTokens =
    (options?.activeTaskTokens !== undefined || options?.requirementTokens !== undefined)
      ? (options?.activeTaskTokens || 0) + (options?.requirementTokens || 0)
      : 2500;
  if (totalContextTokens <= 4096) {
    specificationTokens = Math.min(specificationTokens, Math.floor(totalContextTokens * 0.25));
  }

  // 5. Verification evidence tokens (default baseline 2,000 or measured)
  let evidenceTokens = options?.evidenceTokens ?? 2000;
  if (totalContextTokens <= 4096) {
    evidenceTokens = Math.min(evidenceTokens, Math.floor(totalContextTokens * 0.15));
  }

  // Total reserve
  let reserveTokens = systemTokens + specificationTokens + evidenceTokens + maxOutputTokens + safetyMarginTokens;

  // For smaller local context windows (e.g. <= 16,384), scale reserve so that
  // available history budget remains practical (at least 40% of total window).
  if (totalContextTokens <= 16_384 && reserveTokens >= totalContextTokens * 0.60) {
    reserveTokens = Math.floor(totalContextTokens * 0.55);
  } else if (reserveTokens >= totalContextTokens * 0.70) {
    reserveTokens = Math.floor(totalContextTokens * 0.50);
  }

  const availableHistoryBudget = Math.max(100, totalContextTokens - reserveTokens);
  // Trigger compaction when active conversation history reaches 70% of available history budget
  const compactionThresholdTokens = Math.floor(availableHistoryBudget * 0.70);

  return {
    providerId: provider.id,
    modelId: provider.getModel(),
    totalContextTokens,
    reserveTokens,
    availableHistoryBudget,
    compactionThresholdTokens,
    safetyMarginTokens,
    breakdown: {
      systemTokens,
      specificationTokens,
      evidenceTokens,
      maxOutputTokens,
      safetyMarginTokens,
    },
  };
}

/**
 * Checks whether the cumulative token count of the conversation context
 * approaches or exceeds the compaction threshold.
 */
export function shouldTriggerCompaction(currentTokens: number, budget: ContextBudget): boolean {
  return currentTokens >= budget.compactionThresholdTokens;
}
