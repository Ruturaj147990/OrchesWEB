import { Conversation, ConversationMessage, ConversationMemorySnapshot } from "@orchestrator/shared-types";
import { ReasoningProvider } from "../../providers/reasoning/provider.js";
import { RequirementInventory } from "../requirements/requirement-inventory.js";
import { SecretRedactor } from "../../platform/secret-redactor.js";
import { estimateTokens } from "./context-budget.js";

const COMPACTOR_SYSTEM = `You are the Memory Architect for Orches, an autonomous engineering orchestrator.
Your task is to synthesize an incremental, highly structured Context Memory Snapshot in Markdown from the ongoing engineering conversation.

CRITICAL DIRECTIVES:
1. PRESERVE FACTUAL GROUND TRUTH:
   - Clearly distinguish VERIFIED FACTS (passed automated tests, clean builds, endorsed critic reviews) from UNVERIFIED CLAIMS (agent proposals, unexecuted plans, untested changes).
   - NEVER mark unverified work as complete.
   - Preserve all explicit requirements, negative constraints, and architectural boundaries with exact requirement IDs ([REQ-xxx]).
   - DO NOT turn an optional feature into a mandatory requirement, or a mandatory requirement into an optional suggestion.
   - DO NOT drop negative constraints, prohibitions, or architectural boundaries.
   - DO NOT replace an explicit user decision with an unapproved alternative.
   - Distinguish active immediate scope from deferred phases or roadmap milestones.
   - DO NOT introduce unsupported facts while summarizing historical model output.
2. CONDENSE PROGRESS ECONOMICALLY:
   - Synthesize prior decisions, rationale, current file changes, and outstanding issues into a compact, unified Markdown document.
   - Do NOT simply append summaries to create a bloated context. Update and replace outdated assumptions with latest verified ground truth.
3. PRESERVE REPRODUCIBLE EVIDENCE:
   - Retain exact error snippets, failing check commands, and specific blocker descriptions.
   - Highlight outstanding blockers, known bugs, and immediate next actions.
4. Output valid Markdown only matching the requested section headers.`;

export interface CompactorInput {
  conversation: Conversation;
  messages: ConversationMessage[];
  previousSnapshot?: ConversationMemorySnapshot | null;
  requirementInventory?: RequirementInventory | null;
  provider: ReasoningProvider;
  signal?: AbortSignal;
}

export interface CompactionResult {
  snapshotMarkdown: string;
  tokenCount: number;
  source: "model" | "heuristic_fallback";
  error?: string;
  sourceMessageCount: number;
}

export class ContextCompactor {
  /**
   * Compacts conversation history into a structured Markdown memory snapshot.
   * If LLM summarization fails, uses a safe deterministic heuristic fallback
   * so useful context is NEVER lost or replaced with an empty snapshot.
   */
  public async compact(input: CompactorInput): Promise<CompactionResult> {
    const { conversation, messages, previousSnapshot, requirementInventory, provider, signal } = input;

    // Filter relevant messages to preserve
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant" || m.role === "orchestrator");
    const toolMessages = messages.filter((m) => m.role === "tool");

    try {
      const prompt = this.buildSummarizationPrompt(
        conversation,
        messages,
        previousSnapshot,
        requirementInventory
      );

      const response = await provider.generate(
        {
          operation: "memory_summary",
          systemInstruction: COMPACTOR_SYSTEM,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          maxOutputTokens: 2500,
          projectId: conversation.projectId,
        },
        signal
      );

      const rawText = response.text ? response.text.trim() : "";
      if (rawText && rawText.length >= 100 && this.hasRequiredSections(rawText)) {
        const sanitized = SecretRedactor.redactString(rawText);
        return {
          snapshotMarkdown: sanitized,
          tokenCount: estimateTokens(sanitized),
          source: "model",
          sourceMessageCount: messages.length,
        };
      }

      console.warn("[ContextCompactor] Model output was underspecified or lacked structure; engaging heuristic fallback.");
      return this.heuristicFallback(conversation, messages, previousSnapshot, requirementInventory, "Model output was underspecified");
    } catch (err) {
      console.warn(`[ContextCompactor] Model summarization failed (${(err as Error).message}); engaging heuristic fallback.`);
      return this.heuristicFallback(conversation, messages, previousSnapshot, requirementInventory, (err as Error).message);
    }
  }

  private hasRequiredSections(text: string): boolean {
    const lower = text.toLowerCase();
    const matches = [
      lower.includes("objective") || lower.includes("deliverable"),
      lower.includes("requirement") || lower.includes("constraint"),
      lower.includes("decision") || lower.includes("state") || lower.includes("work"),
    ];
    return matches.filter(Boolean).length >= 2;
  }

  private buildSummarizationPrompt(
    conversation: Conversation,
    messages: ConversationMessage[],
    previousSnapshot?: ConversationMemorySnapshot | null,
    inventory?: RequirementInventory | null
  ): string {
    const sections: string[] = [
      `CONVERSATION TITLE: ${conversation.title}`,
      `CONVERSATION ID: ${conversation.id}`,
      `TOTAL MESSAGES TO COMPACT: ${messages.length}`,
      "",
    ];

    if (previousSnapshot?.snapshotMarkdown) {
      sections.push("### PREVIOUS MEMORY SNAPSHOT (Base for Incremental Update):");
      sections.push(previousSnapshot.snapshotMarkdown.slice(0, 4000));
      sections.push("");
    }

    if (inventory) {
      sections.push("### AUTHORITATIVE REQUIREMENT INVENTORY:");
      const constraints = inventory.requirements.filter((r) => r.classification === "explicit_constraint");
      if (constraints.length > 0) {
        sections.push("Constraints & Prohibitions:");
        constraints.forEach((c) => sections.push(`- [${c.id}] STRICT: ${c.description}`));
      }
      const mandatory = inventory.requirements.filter((r) => r.classification === "mandatory_requirement");
      if (mandatory.length > 0) {
        sections.push("Key Mandatory Requirements:");
        mandatory.slice(0, 15).forEach((m) => sections.push(`- [${m.id}] (${m.status}): ${m.title} — ${m.description}`));
      }
      sections.push("");
    }

    sections.push("### RECENT MESSAGES & ITERATION HISTORY:");
    for (const msg of messages.slice(-30)) {
      const meta = Object.keys(msg.meta).length > 0 ? ` [Meta: ${JSON.stringify(msg.meta).slice(0, 150)}]` : "";
      sections.push(`[${msg.createdAt}] (${msg.role.toUpperCase()})${meta}:\n${msg.content.slice(0, 800)}\n`);
    }

    sections.push(`
Please generate the comprehensive, updated Context Memory Snapshot in Markdown using the following exact structure:

# Context Memory Snapshot: ${conversation.title}
Generated: ${new Date().toISOString()}

## 1. Overall Objective & Requested Deliverables
(Summarize user goals, target scope, and primary deliverables)

## 2. Explicit Requirements, Technology Constraints & Prohibitions
(List exact non-negotiable constraints, negative prohibitions, stack limits, and [REQ-xxx] IDs)

## 3. Important Decisions & Rationale
(Architectural choices, data model agreements, rejected alternatives with why)

## 4. Current Implementation State & Changed Files
(List modified, added, or deleted files; distinguish verified file state from unverified edits)

## 5. Completed Work & Verified Evidence
(Only include work confirmed by passing automated checks or endorsed critic verdicts)

## 6. Outstanding Requirements, Bugs & Blockers
(Unfulfilled requirements, failing checks, active bugs, and immediate next repair actions)

## 7. Relevant Commands, Test Results & Errors
(Exact verification commands run, exit codes, and error snippets)

## 8. Unresolved Questions & Ambiguities
(Questions awaiting user clarification or conflicting instructions)
`);

    return sections.join("\n");
  }

  /**
   * Deterministic, resilient fallback generator that guarantees a comprehensive,
   * non-empty snapshot even if provider/model is offline, times out, or errors.
   */
  public heuristicFallback(
    conversation: Conversation,
    messages: ConversationMessage[],
    previousSnapshot?: ConversationMemorySnapshot | null,
    inventory?: RequirementInventory | null,
    fallbackReason?: string
  ): CompactionResult {
    const lines: string[] = [];
    const timestamp = new Date().toISOString();

    lines.push(`# Context Memory Snapshot: ${conversation.title}`);
    lines.push(`Generated: ${timestamp} | Mode: Heuristic Resilient Fallback${fallbackReason ? ` (Reason: ${fallbackReason})` : ""}`);
    lines.push("");

    if (fallbackReason) {
      lines.push(`> [!NOTE] Resilient Context Fallback: Snapshot synthesized via deterministic fallback (${fallbackReason}). Explicit requirements, constraints, and prior verified milestones have been preserved.`);
      lines.push("");
    }

    // 1. Objectives from user messages
    lines.push("## 1. Overall Objective & Requested Deliverables");
    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length > 0) {
      lines.push(`- **Primary Task**: ${userMsgs[0].content.trim()}`);
      if (userMsgs.length > 1) {
        lines.push("- **Subsequent Instructions / Follow-ups**:");
        for (const u of userMsgs.slice(1)) {
          lines.push(`  - ${u.content.trim().slice(0, 300)}`);
        }
      }
    } else {
      lines.push(`- Objective for conversation ${conversation.title}`);
    }
    lines.push("");

    // 2. Explicit Requirements and Constraints
    lines.push("## 2. Explicit Requirements, Technology Constraints & Prohibitions");
    if (inventory && inventory.requirements.length > 0) {
      const constraints = inventory.requirements.filter((r) => r.classification === "explicit_constraint");
      if (constraints.length > 0) {
        lines.push("### Constraints & Prohibitions (Non-Negotiable):");
        constraints.forEach((c) => lines.push(`- **[${c.id}]** STRICT CONSTRAINT: ${c.description} (Ref: ${c.sourceReference})`));
      } else {
        lines.push("- Maintain workspace boundaries and respect existing conventions.");
      }

      const mandatory = inventory.requirements.filter((r) => r.classification === "mandatory_requirement");
      if (mandatory.length > 0) {
        lines.push("");
        lines.push("### Key Mandatory Requirements:");
        mandatory.slice(0, 15).forEach((m) => lines.push(`- **[${m.id}]** (${m.status}): ${m.title} — ${m.description}`));
      }

      const optional = inventory.requirements.filter((r) => r.classification === "optional_requirement");
      if (optional.length > 0) {
        lines.push("");
        lines.push("### Optional Enhancements (Non-Binding Suggestions):");
        optional.forEach((o) => lines.push(`- **[${o.id}]** (Optional): ${o.title} — ${o.description}`));
      }

      const phases = new Set<string>();
      if (inventory.summary.phases) {
        inventory.summary.phases.forEach((p) => phases.add(p));
      }
      inventory.requirements.forEach((r) => {
        if (r.phase) phases.add(r.phase);
        const m = (r.title || "").match(/(Phase\s+\d+|Milestone\s+\d+)/i);
        if (m) phases.add(m[1]);
      });

      if (phases.size > 0) {
        lines.push("");
        lines.push("### Phased Implementation Roadmap & Deferred Milestones:");
        phases.forEach((p) => lines.push(`- Phase: ${p}`));
      }

      const criteria = inventory.requirements.filter((r) => r.classification === "acceptance_criterion");
      if (criteria.length > 0) {
        lines.push("");
        lines.push("### Acceptance Criteria:");
        criteria.forEach((ac) => lines.push(`- **[${ac.id}]** ${ac.description}`));
      }
    } else {
      lines.push("- Adhere strictly to user specifications without introducing unrequested dependencies.");
    }
    lines.push("");

    // 3. Decisions & Rationale
    lines.push("## 3. Important Decisions & Rationale");
    const preservedDecisions = new Set<string>();

    if (previousSnapshot?.snapshotMarkdown) {
      const decMatch = previousSnapshot.snapshotMarkdown.match(/## 3\. Important Decisions & Rationale\s*([\s\S]*?)(?=## 4|$)/i);
      if (decMatch && decMatch[1]) {
        decMatch[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("-") && !l.includes("progressing according to plan"))
          .forEach((l) => preservedDecisions.add(l));
      }
    }

    const assistantMsgs = messages.filter((m) => m.role === "assistant" || m.role === "orchestrator");
    if (assistantMsgs.length > 0) {
      for (const a of assistantMsgs.slice(-5)) {
        const rationale = (a.meta?.rationale as string) || (a.content.length < 200 ? a.content : "");
        if (rationale) preservedDecisions.add(`- Decision: ${rationale}`);
      }
    }

    if (preservedDecisions.size > 0) {
      preservedDecisions.forEach((d) => lines.push(d));
    } else {
      lines.push("- Iterative implementation progressing according to plan.");
    }
    lines.push("");

    // 4. Implementation State & Files
    lines.push("## 4. Current Implementation State & Changed Files");
    const filesChangedSet = new Set<string>();
    for (const m of messages) {
      if (Array.isArray(m.meta?.filesChanged)) {
        for (const f of m.meta.filesChanged as string[]) filesChangedSet.add(f);
      }
    }
    if (filesChangedSet.size > 0) {
      lines.push(`- **Changed Files**: ${[...filesChangedSet].join(", ")}`);
    } else {
      lines.push("- No file changes recorded in message history yet.");
    }
    lines.push("");

    // 5. Completed Work & Verified Evidence
    lines.push("## 5. Completed Work & Verified Evidence");
    const verifiedChecks = new Set<string>();

    if (previousSnapshot?.snapshotMarkdown) {
      const compMatch = previousSnapshot.snapshotMarkdown.match(/## 5\. Completed Work & Verified Evidence\s*([\s\S]*?)(?=## 6|$)/i);
      if (compMatch && compMatch[1]) {
        compMatch[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("-") && !l.includes("pending or in progress"))
          .forEach((l) => verifiedChecks.add(l.replace(/^-\s*/, "")));
      }
    }

    for (const m of messages) {
      if (Array.isArray(m.meta?.checks)) {
        for (const c of m.meta.checks as Array<{ label?: string; status?: string }>) {
          if (c.status === "passed" && c.label) verifiedChecks.add(`Verified passed check: ${c.label}`);
        }
      }
    }

    if (verifiedChecks.size > 0) {
      verifiedChecks.forEach((c) => lines.push(`- ${c}`));
    } else {
      lines.push("- Verification checks pending or in progress.");
    }
    lines.push("");

    // 6. Outstanding Requirements & Blockers
    lines.push("## 6. Outstanding Requirements, Bugs & Blockers");
    const blockers: string[] = [];
    for (const m of messages) {
      if (Array.isArray(m.meta?.blockers)) {
        for (const b of m.meta.blockers as string[]) blockers.push(b);
      }
    }
    if (blockers.length > 0) {
      [...new Set(blockers)].forEach((b) => lines.push(`- **Active Blocker**: ${b}`));
    } else {
      lines.push("- No active blockers recorded.");
    }
    lines.push("");

    // 7. Commands, Test Results & Errors
    lines.push("## 7. Relevant Commands, Test Results & Errors");
    const failedChecks: string[] = [];
    for (const m of messages) {
      if (Array.isArray(m.meta?.checks)) {
        for (const c of m.meta.checks as Array<{ label?: string; status?: string; output?: string }>) {
          if (c.status !== "passed" && c.label) {
            failedChecks.push(`${c.label} (${c.status})${c.output ? `: ${c.output.slice(-200)}` : ""}`);
          }
        }
      }
    }
    if (failedChecks.length > 0) {
      failedChecks.slice(-5).forEach((f) => lines.push(`- Failing Check: ${f}`));
    } else {
      lines.push("- All executed commands passed cleanly or none run yet.");
    }
    lines.push("");

    // 8. Unresolved Questions
    lines.push("## 8. Unresolved Questions & Ambiguities");
    if (inventory && inventory.summary.contradictions > 0) {
      const contradictions = inventory.requirements.filter((r) => r.classification === "unresolved_contradiction");
      contradictions.forEach((c) => lines.push(`- Contradiction: ${c.description}`));
    } else {
      lines.push("- None currently detected.");
    }

    const markdown = SecretRedactor.redactString(lines.join("\n"));
    return {
      snapshotMarkdown: markdown,
      tokenCount: estimateTokens(markdown),
      source: "heuristic_fallback",
      error: fallbackReason,
      sourceMessageCount: messages.length,
    };
  }
}
