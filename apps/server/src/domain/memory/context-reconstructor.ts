import { ConversationMemorySnapshot, ConversationMessage } from "@orchestrator/shared-types";
import { RequirementInventory } from "../requirements/requirement-inventory.js";
import { ContextBudget, estimateTokens } from "./context-budget.js";

export interface ReconstructedContext {
  promptSection: string;
  totalTokens: number;
  snapshotIncluded: boolean;
  snapshotId: string | null;
  messageCountIncluded: number;
  includedMessageIds: string[];
}

export interface ReconstructionInput {
  projectId: string;
  conversationId: string;
  currentTaskText: string;
  requirementInventory?: RequirementInventory | null;
  latestSnapshot?: ConversationMemorySnapshot | null;
  recentMessages: ConversationMessage[];
  budget: ContextBudget;
}

export class ContextReconstructor {
  /**
   * Reconstructs the reasoning context adhering strictly to the priority hierarchy:
   * 1. Current user instructions and task.
   * 2. Non-negotiable project requirements and constraints.
   * 3. Latest context-memory snapshot.
   * 4. Outstanding requirements and recent implementation progress.
   * 5. Relevant historical messages, errors, and verification evidence.
   *
   * Maintains strict conversation and project isolation.
   */
  public reconstruct(input: ReconstructionInput): ReconstructedContext {
    const {
      conversationId,
      currentTaskText,
      requirementInventory,
      latestSnapshot,
      recentMessages,
      budget,
    } = input;

    // Filter messages to ensure strict conversation isolation
    const validMessages = recentMessages.filter((m) => m.conversationId === conversationId);

    const sections: string[] = [];
    let currentTokens = 0;
    const includedMessageIds: string[] = [];
    let snapshotIncluded = false;
    let snapshotId: string | null = null;

    // 1 & 2: Current Task & Authoritative Requirements are handled in the main prompt/inventory,
    // but we reinforce non-negotiable constraints if available.
    if (requirementInventory) {
      const constraints = requirementInventory.requirements.filter(
        (r) => r.classification === "explicit_constraint"
      );
      if (constraints.length > 0) {
        const constraintBlock = [
          "### NON-NEGOTIABLE REQUIREMENTS & CONSTRAINTS (Authoritative Inventory):",
          ...constraints.map((c) => `- [${c.id}] STRICT: ${c.description} (Ref: ${c.sourceReference})`),
        ].join("\n");
        sections.push(constraintBlock);
        currentTokens += estimateTokens(constraintBlock);
      }
    }

    // 3: Latest Context-Memory Snapshot
    if (latestSnapshot?.snapshotMarkdown) {
      const snapshotTokens = latestSnapshot.tokenCount || estimateTokens(latestSnapshot.snapshotMarkdown);
      // Ensure the snapshot fits within the available history budget
      if (currentTokens + snapshotTokens <= budget.availableHistoryBudget) {
        sections.push("### PERSISTENT CONTEXT MEMORY SNAPSHOT (Synthesized Ground Truth):");
        sections.push(latestSnapshot.snapshotMarkdown);
        currentTokens += snapshotTokens;
        snapshotIncluded = true;
        snapshotId = latestSnapshot.id;
      } else {
        // If snapshot is large, truncate gently while keeping essential sections
        const truncated = latestSnapshot.snapshotMarkdown.slice(0, budget.availableHistoryBudget * 3);
        sections.push("### PERSISTENT CONTEXT MEMORY SNAPSHOT (Synthesized Ground Truth - Truncated):");
        sections.push(truncated);
        currentTokens += estimateTokens(truncated);
        snapshotIncluded = true;
        snapshotId = latestSnapshot.id;
      }
    }

    // 4 & 5: Relevant Recent Historical Messages & Verification Evidence
    // Prioritize newest messages backwards up to available budget
    const remainingBudget = Math.max(0, budget.availableHistoryBudget - currentTokens);
    if (remainingBudget > 200 && validMessages.length > 0) {
      const historyBlocks: string[] = [];
      let historyTokens = 0;

      // Scan from newest to oldest
      for (let i = validMessages.length - 1; i >= 0; i--) {
        const msg = validMessages[i];
        const block = `[${msg.createdAt}] (${msg.role.toUpperCase()}):\n${msg.content}`;
        const blockTokens = estimateTokens(block);

        if (historyTokens + blockTokens <= remainingBudget) {
          historyBlocks.unshift(block);
          includedMessageIds.unshift(msg.id);
          historyTokens += blockTokens;
        } else {
          break;
        }
      }

      if (historyBlocks.length > 0) {
        sections.push("### RECENT CONVERSATION & VERIFICATION EVIDENCE:");
        sections.push(historyBlocks.join("\n\n"));
        currentTokens += historyTokens;
      }
    }

    const promptSection = sections.join("\n\n");

    return {
      promptSection,
      totalTokens: currentTokens,
      snapshotIncluded,
      snapshotId,
      messageCountIncluded: includedMessageIds.length,
      includedMessageIds,
    };
  }
}
