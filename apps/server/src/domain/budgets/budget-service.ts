import { BudgetLimits, BudgetLimitsSchema, BudgetUsage, CostState } from "@orchestrator/shared-types";

export interface ModelPricing {
  modelId: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  provider: "openai" | "local" | "unknown";
}

export const DEFAULT_PRICING_CATALOGUE: Record<string, ModelPricing> = {
  "gpt-4o-mini": {
    modelId: "gpt-4o-mini",
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.60,
    provider: "openai",
  },
  "gpt-4o": {
    modelId: "gpt-4o",
    inputPerMillionUsd: 2.50,
    outputPerMillionUsd: 10.00,
    provider: "openai",
  },
  "gpt-4.1": { modelId: "gpt-4.1", inputPerMillionUsd: 2.0, outputPerMillionUsd: 8.0, provider: "openai" },
  "gpt-4.1-mini": { modelId: "gpt-4.1-mini", inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6, provider: "openai" },
  "gpt-4.1-nano": { modelId: "gpt-4.1-nano", inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4, provider: "openai" },
  "llama3.1:8b": {
    modelId: "llama3.1:8b",
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    provider: "local",
  },
};

export class BudgetExceededError extends Error {
  constructor(public limitType: string, public current: number, public max: number) {
    super(`Budget limit exceeded: ${limitType} reached ${current} (Maximum allowed: ${max})`);
    this.name = "BudgetExceededError";
  }
}

export class BudgetService {
  private limits: BudgetLimits;
  private usage: BudgetUsage;
  private pricingCatalogue: Map<string, ModelPricing>;

  constructor(customLimits?: Partial<BudgetLimits>) {
    this.limits = BudgetLimitsSchema.parse(customLimits || {});
    this.usage = {
      measuredCostUsd: 0,
      estimatedCostUsd: 0,
      reservedCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      costState: "local_no_api_charge",
    };
    this.pricingCatalogue = new Map(Object.entries(DEFAULT_PRICING_CATALOGUE));
  }

  public getLimits(): BudgetLimits {
    return { ...this.limits };
  }

  public getUsage(): BudgetUsage {
    return { ...this.usage };
  }

  public calculateCost(modelId: string, inputTokens: number, outputTokens: number): { costUsd: number; costState: CostState } {
    const pricing = this.pricingCatalogue.get(modelId);
    if (!pricing || pricing.provider === "local") {
      return { costUsd: 0, costState: "local_no_api_charge" };
    }

    const cost =
      (inputTokens * pricing.inputPerMillionUsd) / 1_000_000 +
      (outputTokens * pricing.outputPerMillionUsd) / 1_000_000;

    return { costUsd: cost, costState: "estimated" };
  }

  /**
   * Pre-dispatch check & reservation:
   * Verifies that the run/task budget will not exceed hard limits before dispatching a model call.
   */
  public reserveAndCheckPreflight(modelId: string, estimatedWorstCaseTokens = 4000): void {
    if (this.usage.totalRequests >= this.limits.maxReasoningCallsPerRun) {
      throw new BudgetExceededError(
        "Max reasoning calls per run",
        this.usage.totalRequests,
        this.limits.maxReasoningCallsPerRun
      );
    }

    const estimated = this.calculateCost(modelId, estimatedWorstCaseTokens / 2, estimatedWorstCaseTokens / 2);

    if (this.usage.estimatedCostUsd + estimated.costUsd > this.limits.perRunHardUsd) {
      throw new BudgetExceededError(
        "Hard run spend ceiling ($USD)",
        this.usage.estimatedCostUsd + estimated.costUsd,
        this.limits.perRunHardUsd
      );
    }

    this.usage.reservedCostUsd += estimated.costUsd;
  }

  /**
   * Records completed provider call usage and updates totals
   */
  public recordCall(modelId: string, inputTokens: number, outputTokens: number): {
    costUsd: number;
    softWarning: boolean;
  } {
    const { costUsd, costState } = this.calculateCost(modelId, inputTokens, outputTokens);

    this.usage.totalInputTokens += inputTokens;
    this.usage.totalOutputTokens += outputTokens;
    this.usage.totalRequests += 1;
    this.usage.estimatedCostUsd += costUsd;
    this.usage.costState = costState;

    // Release reservation
    this.usage.reservedCostUsd = Math.max(0, this.usage.reservedCostUsd - costUsd);

    const softWarning = this.usage.estimatedCostUsd >= this.limits.perTaskWarningUsd;

    return { costUsd, softWarning };
  }
}
