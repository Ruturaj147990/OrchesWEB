import type { ReasoningProvider, ReasoningRequest, ReasoningResult, ProviderHealth } from "../provider.js";
import type { PrivacyClass } from "@orchestrator/shared-types";
import { BrowserManager } from "./browser-manager.js";
import { ConversationManager } from "./conversation-manager.js";
import { PromptSender } from "./prompt-sender.js";
import { ResponseReader } from "./response-reader.js";
import { AuthDetector } from "./auth-detector.js";
import { getDb } from "../../../storage/db.js";
import { BlueprintRepository } from "../../../storage/repositories/blueprint-repository.js";
import { AttachmentUploader } from "./attachment-uploader.js";
import { estimateTokens } from "../../../domain/memory/context-budget.js";
import { extractJsonFromText } from "../../../prompts/json-extractor.js";

export interface ChatGPTWebProviderConfig {
  headless?: boolean;
  profileDir?: string;
  timeoutMs?: number;
}

export class ChatGPTWebProvider implements ReasoningProvider {
  public id = "chatgpt-web";
  public displayName = "ChatGPT Web (Browser)";
  public privacyClass: PrivacyClass = "cloud";
  private browserManager: BrowserManager;
  private timeoutMs: number;

  constructor(config: ChatGPTWebProviderConfig = {}) {
    this.browserManager = BrowserManager.getShared({
      headless: config.headless,
      profileDir: config.profileDir,
      timeoutMs: config.timeoutMs,
    });
    this.timeoutMs = config.timeoutMs || 300_000;
  }

  public getModel(): string {
    return "chatgpt-web";
  }

  public getContextWindow(): number {
    return 32_768;
  }

  public getStateMachine() {
    return this.browserManager.getStateMachine();
  }

  public async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const page = await this.browserManager.ensureChatGPTPage();
      const auth = await AuthDetector.detect(page);
      const latencyMs = Date.now() - start;

      if (auth === "authenticated") {
        return {
          ok: true,
          status: "ready",
          latencyMs,
          message: "ChatGPT Web session is authenticated and ready.",
          discoveredModels: ["chatgpt-web"],
        };
      } else if (auth === "login_required") {
        return {
          ok: false,
          status: "not_detected",
          latencyMs,
          message: "ChatGPT login required. Please sign in to chatgpt.com in the open browser window.",
        };
      } else if (auth === "challenge_required") {
        return {
          ok: false,
          status: "warning" as any,
          latencyMs,
          message: "Verification challenge detected on ChatGPT. Please complete it in the browser.",
        };
      }

      return {
        ok: false,
        status: "warming_up",
        latencyMs,
        message: "ChatGPT page is loading...",
      };
    } catch (err) {
      return {
        ok: false,
        status: "server_unreachable",
        latencyMs: Date.now() - start,
        message: `Browser failed to launch or navigate: ${(err as Error).message}`,
      };
    }
  }

  public async generate(request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> {
    if (signal?.aborted) throw new Error("Request cancelled by user.");

    const db = getDb();
    const conversationManager = new ConversationManager(db);
    const attachmentUploader = new AttachmentUploader(db);
    const blueprintRepo = new BlueprintRepository(db);

    const startTime = Date.now();
    console.log(`[ChatGPTWeb] Generating reasoning for operation '${request.operation}' on project '${request.projectId}'`);

    // 1. Ensure browser page is available and user is authenticated
    const page = await this.browserManager.ensureChatGPTPage({ signal });
    await this.browserManager.ensureAuthenticated({ signal, timeoutMs: 180_000 });

    // 2. Ensure project-scoped persistent ChatGPT conversation is mapped and open
    const mappedConversationUrl = await conversationManager.ensureProjectConversation(
      page,
      { projectId: request.projectId },
      { signal }
    );

    // 3. For operations involving project source materials, deliver any pending attachments
    if (request.operation === "code_generation" || request.operation === "task_planning" || request.operation === "repair_diagnosis") {
      try {
        const blueprints = blueprintRepo.listBlueprints(request.projectId);
        if (blueprints.length > 0) {
          console.log(`[ChatGPTWeb] Verifying delivery of ${blueprints.length} blueprint attachment(s)...`);
          this.browserManager.getStateMachine().transition("ATTACHMENTS_UPLOADING");
          await attachmentUploader.ensureSourcesDelivered(page, request.projectId, blueprints, { signal });
          this.browserManager.getStateMachine().transition("ATTACHMENTS_READY");
        }
      } catch (attErr) {
        console.warn(`[ChatGPTWeb] Notice during attachment delivery: ${(attErr as Error).message}`);
      }
    }

    // 4. Assemble the prompt text
    const promptText = this.assemblePrompt(request);
    this.browserManager.getStateMachine().transition("PROMPT_READY", `Prompt assembled (${promptText.length} chars)`);

    // 5. Capture pre-submission baseline state for stale response protection
    const baseline = await PromptSender.captureBaseline(page);

    try {
      // 6. Submit prompt with duplicate prevention & verification
      this.browserManager.getStateMachine().transition("SUBMITTING");
      await PromptSender.submitPrompt(page, promptText, baseline, {
        signal,
        stateMachine: this.browserManager.getStateMachine(),
      });

      // 7. Wait for generation completion with multi-signal detection
      this.browserManager.getStateMachine().transition("WAITING_FOR_RESPONSE");
      const rawResponse = await ResponseReader.waitForCompletion(page, baseline, {
        timeoutMs: request.timeoutMs || this.timeoutMs,
        signal,
        stateMachine: this.browserManager.getStateMachine(),
      });

      this.browserManager.getStateMachine().transition("VALIDATING_RESPONSE");

      // 8. Extract according to operation mode: Review Mode vs Instruction Mode
      if (request.operation === "result_review") {
        const review = ResponseReader.extractReview(rawResponse, { allowLegacyJson: false });

        // Record success if conversation url exists
        const currentUrl = page.url();
        if (currentUrl.includes("/c/")) {
          conversationManager.recordSuccess(request.projectId, currentUrl);
        } else if (mappedConversationUrl && mappedConversationUrl.includes("/c/")) {
          conversationManager.recordSuccess(request.projectId, mappedConversationUrl);
        } else {
          conversationManager.recordSuccess(request.projectId);
        }

        const inputTokens = estimateTokens(promptText);
        const outputTokens = estimateTokens(rawResponse);

        if (review.status === "INVALID") {
          const errorDetail = review.validationError || "Response did not contain a valid natural-language review";
          console.warn(`[ChatGPTWeb] Review protocol validation notice: ${errorDetail}`);
          // Return raw response text so the critic's protocol recovery mechanism can analyze substantive commentary and issue follow-up
          return {
            text: rawResponse,
            providerId: this.id,
            modelId: this.getModel(),
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            durationMs: Date.now() - startTime,
            warnings: [errorDetail],
          };
        }

        return {
          text: rawResponse,
          parsed: {
            verdict: review.verdict,
            criteria: review.criteria,
            findings: review.findings,
            repair_instructions: review.repairInstructions,
            summary: review.summary,
          },
          providerId: this.id,
          modelId: this.getModel(),
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
          durationMs: Date.now() - startTime,
          warnings: [],
        };
      }

      // 9. Extract the substantive engineering instruction adhering strictly to the routing protocol
      const extracted = ResponseReader.extractInstruction(rawResponse, {
        startTime,
        allowLegacyJson: false,
        requireProtocolStatus: true,
      });

      // Record success with genuine conversation URL if promoted
      const currentUrl = page.url();
      if (currentUrl.includes("/c/")) {
        conversationManager.recordSuccess(request.projectId, currentUrl);
      } else if (mappedConversationUrl && mappedConversationUrl.includes("/c/")) {
        conversationManager.recordSuccess(request.projectId, mappedConversationUrl);
      } else {
        conversationManager.recordSuccess(request.projectId);
      }

      // Handle explicit stop action from model (or refusal)
      if (extracted.action === "stop") {
        console.log(`[ChatGPTWeb] Explicit stop response received: ${extracted.stopReason || extracted.rationale}`);
        this.browserManager.getStateMachine().transition("STOPPED", extracted.rationale);
        const stopReason = extracted.stopReason || extracted.rationale || "Operation stopped by reasoning model.";
        const stopParsed = {
          action: "stop",
          stop_reason: stopReason,
          rationale: extracted.rationale,
        };
        const stopProtocolText = `ORCHES_STATUS: STOP\n\nReason: ${stopReason}`;
        return {
          text: stopProtocolText,
          parsed: stopParsed,
          providerId: this.id,
          modelId: this.getModel(),
          usage: {
            inputTokens: estimateTokens(promptText),
            outputTokens: estimateTokens(rawResponse),
            totalTokens: estimateTokens(promptText) + estimateTokens(rawResponse),
          },
          durationMs: Date.now() - startTime,
          warnings: [],
        };
      }

      // Safe rejection of invalid or malformed responses
      if (extracted.status === "INVALID" || !extracted.instructionText.trim()) {
        const errorDetail = extracted.validationError || "Response did not contain a valid natural-language engineering instruction";
        console.warn(`[ChatGPTWeb] Response protocol validation failed: ${errorDetail}`);
        this.browserManager.getStateMachine().transition("FAILED_RECOVERABLE", errorDetail);
        throw new Error(`ChatGPT Web response protocol validation failed: ${errorDetail}`);
      }

      this.browserManager.getStateMachine().transition("INSTRUCTION_READY");

      const instructionText = extracted.instructionText;
      const protocolText = `ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n${instructionText}\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
      const internalParsed = {
        action: "instruct",
        instruction: instructionText,
        rationale: extracted.rationale,
      };

      const inputTokens = estimateTokens(promptText);
      const outputTokens = estimateTokens(protocolText);

      return {
        text: protocolText,
        parsed: internalParsed,
        providerId: this.id,
        modelId: this.getModel(),
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        durationMs: Date.now() - startTime,
        warnings: [],
      };
    } catch (err) {
      const errorMsg = (err as Error).message || "Unknown ChatGPT Web provider error";
      if (signal?.aborted) {
        this.browserManager.getStateMachine().transition("CLOSED", "Cancelled by user");
      } else if (errorMsg.includes("login") || errorMsg.includes("auth")) {
        this.browserManager.getStateMachine().transition("FAILED_TERMINAL", errorMsg);
      } else {
        this.browserManager.getStateMachine().transition("FAILED_RECOVERABLE", errorMsg);
      }
      throw err;
    }
  }

  private assemblePrompt(request: ReasoningRequest): string {
    const parts: string[] = [];

    if (request.systemInstruction) {
      parts.push(`SYSTEM INSTRUCTIONS:\n${request.systemInstruction}\n`);
    }

    for (const msg of request.messages) {
      parts.push(`${msg.role.toUpperCase()}:\n${msg.content}\n`);
    }

    // Require the mandatory natural-language routing protocol
    if (request.operation === "code_generation" || request.operation === "repair_diagnosis") {
      parts.push(`
CRITICAL ROUTING & OUTPUT CONTRACT:
You must reply using the Orches text-based routing protocol. Do NOT return a JSON object. Do NOT wrap your response in JSON.

For a successful instruction response, you MUST output this exact structure:
ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]

# Implementation Mission

<The complete, project-specific substantive engineering brief in Markdown>

[/ORCHES_ANTIGRAVITY_INSTRUCTION]

For an operation that must stop:
ORCHES_STATUS: STOP

Reason: <A concise and truthful explanation of why the operation cannot proceed and, where appropriate, a safe alternative>

CRITICAL PROTOCOL RULES:
- The substantive engineering brief must be Markdown and natural language.
- Do NOT return a JSON envelope or task descriptor around the engineering brief.
- Do NOT return only a task title, short summary, task descriptor, or generic plan.
- The content inside [ORCHES_ANTIGRAVITY_INSTRUCTION] must contain the complete, actionable engineering brief with concrete objectives, architecture guidance, functional requirements with [REQ-xxx] traceability, implementation boundaries, and automated verification expectations.
`);
    }

    return parts.join("\n").trim();
  }
}
