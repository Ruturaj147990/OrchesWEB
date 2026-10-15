import { DatabaseSync } from "node:sqlite";
import {
  Conversation,
  ConversationMessage,
  ConversationMemorySnapshot,
  ConversationSummary,
  ConversationRole,
} from "@orchestrator/shared-types";
import { ConversationRepository } from "../../storage/repositories/conversation-repository.js";
import { ContextCompactor, CompactionResult } from "./context-compactor.js";
import { ContextReconstructor, ReconstructedContext } from "./context-reconstructor.js";
import { calculateContextBudget, shouldTriggerCompaction, estimateTokens } from "./context-budget.js";
import { ReasoningProvider } from "../../providers/reasoning/provider.js";
import { RequirementInventory } from "../requirements/requirement-inventory.js";

export class ConversationMemoryService {
  private repo: ConversationRepository;
  private compactor: ContextCompactor;
  private reconstructor: ContextReconstructor;

  constructor(db: DatabaseSync) {
    this.repo = new ConversationRepository(db);
    this.compactor = new ContextCompactor();
    this.reconstructor = new ContextReconstructor();
  }

  public getRepository(): ConversationRepository {
    return this.repo;
  }

  /**
   * Generates a concise, descriptive title from a user instruction.
   */
  public generateTitle(firstInstruction: string): string {
    const trimmed = (firstInstruction || "").trim();
    if (!trimmed) return "New Conversation";

    // Split on first newline or period
    const firstLine = trimmed.split(/\r?\n/)[0].trim();
    const clean = firstLine.replace(/^[#*>\s-]+/, "").trim();
    if (clean.length <= 60) return clean;
    return `${clean.slice(0, 57)}...`;
  }

  /**
   * Finds an existing conversation or creates one for the project.
   */
  public getOrCreateConversation(params: {
    conversationId?: string | null;
    projectId: string;
    initialInstruction?: string;
    runId?: string;
  }): Conversation {
    if (params.conversationId) {
      const existing = this.repo.findById(params.conversationId);
      if (existing) {
        // Enforce project isolation: ensure conversation belongs to this project
        if (existing.projectId === params.projectId) {
          if (params.runId) this.repo.setResumedRunId(existing.id, params.runId);
          return existing;
        }
      }
    }

    const title = this.generateTitle(params.initialInstruction || "New Engineering Session");
    return this.repo.create({
      projectId: params.projectId,
      title,
      resumedRunId: params.runId ?? null,
    });
  }

  public recordUserMessage(
    conversationId: string,
    content: string,
    meta?: Record<string, unknown>
  ): ConversationMessage {
    return this.repo.addMessage({
      conversationId,
      role: "user",
      content,
      meta,
    });
  }

  public recordModelDecision(
    conversationId: string,
    decisionText: string,
    meta?: Record<string, unknown>
  ): ConversationMessage {
    return this.repo.addMessage({
      conversationId,
      role: "assistant",
      content: decisionText,
      meta,
    });
  }

  public recordAgentDispatch(
    conversationId: string,
    prompt: string,
    meta?: Record<string, unknown>
  ): ConversationMessage {
    return this.repo.addMessage({
      conversationId,
      role: "orchestrator",
      content: prompt,
      meta,
    });
  }

  public recordAgentResponse(
    conversationId: string,
    reply: string,
    meta?: Record<string, unknown>
  ): ConversationMessage {
    return this.repo.addMessage({
      conversationId,
      role: "tool",
      content: reply,
      meta,
    });
  }

  public recordVerificationOutcome(
    conversationId: string,
    outcome: {
      passed: boolean;
      checks?: Array<{ label: string; status: string; output?: string }>;
      blockers?: string[];
      filesChanged?: string[];
      criticVerdict?: string;
      criticRationale?: string;
    },
    meta?: Record<string, unknown>
  ): ConversationMessage {
    const summary = outcome.passed
      ? `Verification PASSED: ${outcome.checks?.length || 0} checks completed cleanly.`
      : `Verification FAILED: ${outcome.blockers?.join("; ") || "Checks reported errors."}`;

    return this.repo.addMessage({
      conversationId,
      role: "orchestrator",
      content: summary,
      meta: {
        ...meta,
        passed: outcome.passed,
        checks: outcome.checks,
        blockers: outcome.blockers,
        filesChanged: outcome.filesChanged,
        criticVerdict: outcome.criticVerdict,
        criticRationale: outcome.criticRationale,
      },
    });
  }

  /**
   * Evaluates the active conversation history token count against the model-aware budget
   * and triggers automatic compaction when approaching limits.
   */
  public async maybeCompact(
    conversationId: string,
    provider: ReasoningProvider,
    options?: {
      inventory?: RequirementInventory | null;
      force?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<CompactionResult | null> {
    const conversation = this.repo.findById(conversationId);
    if (!conversation) return null;

    // Only messages recorded after the latest snapshot still need compacting; everything older is
    // already summarized in that snapshot. (Counting all messages re-triggered compaction forever.)
    const previousSnapshot = this.repo.getLatestSnapshot(conversationId);
    const messages = previousSnapshot
      ? this.repo.getMessagesSince(conversationId, previousSnapshot.createdAt, 200)
      : this.repo.getRecentMessages(conversationId, 200);
    if (messages.length < 2 && !options?.force) return null;

    const budget = calculateContextBudget(provider);
    const cumulativeTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);

    const needsCompaction = options?.force || shouldTriggerCompaction(cumulativeTokens, budget);
    if (!needsCompaction) return null;

    const result = await this.compactor.compact({
      conversation,
      messages,
      previousSnapshot,
      requirementInventory: options?.inventory,
      provider,
      signal: options?.signal,
    });

    this.repo.saveSnapshot({
      conversationId,
      snapshotMarkdown: result.snapshotMarkdown,
      tokenCount: result.tokenCount,
      meta: {
        source: result.source,
        providerId: provider.id,
        modelId: provider.getModel(),
        sourceMessageCount: result.sourceMessageCount,
        error: result.error,
      },
    });

    return result;
  }

  /**
   * Reconstructs prompt context for model invocation following priority hierarchy:
   * Current Task > Requirements & Constraints > Memory Snapshot > Evidence & History
   */
  public reconstructContext(params: {
    conversationId: string;
    projectId: string;
    currentTaskText: string;
    requirementInventory?: RequirementInventory | null;
    provider: ReasoningProvider;
  }): ReconstructedContext {
    const { conversationId, projectId, currentTaskText, requirementInventory, provider } = params;

    const conversation = this.repo.findById(conversationId);
    if (!conversation || conversation.projectId !== projectId) {
      // Isolate: return empty context if conversation not found or cross-project
      return {
        promptSection: "",
        totalTokens: 0,
        snapshotIncluded: false,
        snapshotId: null,
        messageCountIncluded: 0,
        includedMessageIds: [],
      };
    }

    const budget = calculateContextBudget(provider);
    const latestSnapshot = this.repo.getLatestSnapshot(conversationId);
    const recentMessages = this.repo.getRecentMessages(conversationId, 50);

    return this.reconstructor.reconstruct({
      projectId,
      conversationId,
      currentTaskText,
      requirementInventory,
      latestSnapshot,
      recentMessages,
      budget,
    });
  }

  public listConversations(projectId: string): ConversationSummary[] {
    return this.repo.listByProject(projectId);
  }

  public getConversationDetail(id: string): {
    conversation: Conversation;
    messages: ConversationMessage[];
    latestSnapshot: ConversationMemorySnapshot | null;
  } | null {
    const conversation = this.repo.findById(id);
    if (!conversation) return null;

    const messages = this.repo.getRecentMessages(id, 200);
    const latestSnapshot = this.repo.getLatestSnapshot(id);

    return {
      conversation,
      messages,
      latestSnapshot,
    };
  }

  public updateTitle(id: string, title: string): void {
    this.repo.updateTitle(id, title);
  }

  public deleteConversation(id: string): boolean {
    return this.repo.delete(id);
  }
}
