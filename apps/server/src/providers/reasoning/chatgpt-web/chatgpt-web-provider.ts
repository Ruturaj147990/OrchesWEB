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
import crypto from "node:crypto";

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
  private static idempotencyCache = new Map<string, ReasoningResult>();
  private static inFlightOperations = new Map<string, Promise<ReasoningResult>>();
  /**
   * One browser tab serves every project, so ChatGPT Web operations must never interleave: two runs
   * navigating the same tab would read each other's answers. Every operation queues on this lock.
   */
  private static browserLock: Promise<void> = Promise.resolve();

  private static async withBrowserLock<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = ChatGPTWebProvider.browserLock;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    ChatGPTWebProvider.browserLock = previous.then(() => mine);
    try {
      if (signal) {
        let onAbort: (() => void) | null = null;
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Request cancelled by user."));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          await Promise.race([previous, aborted]);
        } finally {
          if (onAbort) signal.removeEventListener("abort", onAbort);
        }
      } else {
        await previous;
      }
      return await fn();
    } finally {
      release();
    }
  }

  /** Writes one idempotency-lifecycle row; failures are logged (never swallowed) and reported to the caller. */
  private persistOperation(db: any, idempotencyKey: string, label: string, sql: string, params: unknown[]): boolean {
    try {
      db.prepare(sql).run(...params);
      return true;
    } catch (err) {
      console.error(`[ChatGPTWeb] [PERSISTENCE_ERROR] Could not record '${label}' for ${idempotencyKey}: ${(err as Error).message}`);
      return false;
    }
  }

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
    // ChatGPT Web accepts long pastes (they become attachments), so prompts are not pruned for a small window.
    return 128_000;
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

    // 1. Assemble the prompt text & compute payload fingerprint
    const promptText = this.assemblePrompt(request);
    const payloadHash = crypto.createHash("sha256").update(promptText).digest("hex").slice(0, 12);

    // 2. Operation-Level Idempotency check:
    // Only applies if request specifies stable identity (runId, attempt, stage/operation, or chunkIdentity)
    const idempotencyKey = request.runId && request.operation
      ? `${request.runId}:att-${request.attempt ?? 1}:stg-${request.stage ?? "impl"}:op-${request.operationId ?? request.operation}:chunk-${request.chunkIdentity?.chunkIndex ?? 0}-${payloadHash}`
      : null;

    if (idempotencyKey) {
      if (ChatGPTWebProvider.idempotencyCache.has(idempotencyKey)) {
        console.log(`[ChatGPTWeb] [IDEMPOTENT_CACHE_HIT:MEM] Skipping duplicate browser submission for ${idempotencyKey}`);
        return ChatGPTWebProvider.idempotencyCache.get(idempotencyKey)!;
      }

      // Check persistent SQLite store across server restarts
      try {
        const persisted = db.prepare(`
          SELECT status, response_text, parsed_json, provider_id, model_id, input_tokens, output_tokens, duration_ms
          FROM idempotent_operations WHERE idempotency_key = ?
        `).get(idempotencyKey) as any;

        if (persisted && persisted.status === "completed" && persisted.response_text) {
          console.log(`[ChatGPTWeb] [IDEMPOTENT_CACHE_HIT:DB] Restored completed operation across restart for ${idempotencyKey}`);
          const restoredResult: ReasoningResult = {
            text: persisted.response_text,
            parsed: persisted.parsed_json ? JSON.parse(persisted.parsed_json) : undefined,
            providerId: persisted.provider_id,
            modelId: persisted.model_id,
            usage: {
              inputTokens: persisted.input_tokens,
              outputTokens: persisted.output_tokens,
              totalTokens: persisted.input_tokens + persisted.output_tokens,
            },
            durationMs: persisted.duration_ms,
            warnings: [],
          };
          ChatGPTWebProvider.idempotencyCache.set(idempotencyKey, restoredResult);
          return restoredResult;
        }
      } catch (dbErr) {
        console.error(`[ChatGPTWeb] [PERSISTENCE_ERROR] Could not read idempotency record ${idempotencyKey}: ${(dbErr as Error).message}`);
      }

      // Concurrency lock: If this exact logical operation is already in-flight, await the ongoing promise
      if (ChatGPTWebProvider.inFlightOperations.has(idempotencyKey)) {
        console.log(`[ChatGPTWeb] [CONCURRENT_LOCK_WAIT] Awaiting ongoing in-flight operation for ${idempotencyKey}`);
        return await ChatGPTWebProvider.inFlightOperations.get(idempotencyKey)!;
      }
    }

    // Wrap execution with inFlightOperations promise so concurrent callers share the exact same execution
    const executionPromise = ChatGPTWebProvider.withBrowserLock(async () => {
      // A crash-window reconciliation is only legitimate when this exact operation was already handed
      // to the browser earlier (status 'submitting' / 'accepted_by_browser') without a recorded answer.
      // Without that evidence, reusing an answer already on the page would return a stale response.
      let priorStatus: string | null = null;
      if (idempotencyKey) {
        try {
          const row = db.prepare("SELECT status FROM idempotent_operations WHERE idempotency_key = ?").get(idempotencyKey) as { status?: string } | undefined;
          priorStatus = row?.status ?? null;
        } catch (dbErr) {
          console.error(`[ChatGPTWeb] [PERSISTENCE_ERROR] Could not read prior status for ${idempotencyKey}: ${(dbErr as Error).message}`);
        }
      }
      const mayHaveBeenSubmitted = priorStatus === "submitting" || priorStatus === "accepted_by_browser";

      // Durable lifecycle state 1: PREPARATION
      if (idempotencyKey) {
        this.persistOperation(db, idempotencyKey, "prepared", `
            INSERT INTO idempotent_operations (
              idempotency_key, project_id, run_id, attempt, stage, operation, payload_hash,
              status, provider_id, model_id, input_tokens, output_tokens, duration_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, 0, 0, ?, ?)
            ON CONFLICT(idempotency_key) DO UPDATE SET
              status = CASE WHEN status IN ('completed', 'submitting', 'accepted_by_browser') THEN status ELSE 'prepared' END,
              updated_at = excluded.updated_at
          `, [
            idempotencyKey,
            request.projectId,
            request.runId ?? null,
            request.attempt ?? 1,
            request.stage ?? "implementation",
            request.operation,
            payloadHash,
            this.id,
            this.getModel(),
            estimateTokens(promptText),
            new Date().toISOString(),
            new Date().toISOString(),
          ]);
      }

      console.log(`[ChatGPTWeb] [DISPATCH] run=${request.runId ?? "none"} att=${request.attempt ?? 1} stg=${request.stage ?? "impl"} op=${request.operation} chunk=${request.chunkIdentity ? `${request.chunkIdentity.chunkIndex}/${request.chunkIdentity.totalChunks}` : "single"} fp=${payloadHash} chars=${promptText.length}`);

      // 3. Ensure browser page is available and user is authenticated
      const page = await this.browserManager.ensureChatGPTPage({ signal });
      await this.browserManager.ensureAuthenticated({ signal, timeoutMs: 180_000 });

      // 4. Ensure project-scoped persistent ChatGPT conversation is mapped and open
      const mappedConversationUrl = await conversationManager.ensureProjectConversation(
        page,
        { projectId: request.projectId },
        { signal }
      );

      // 5. For operations involving project source materials, deliver any pending attachments
      if (!request.skipSourceDelivery && (request.operation === "code_generation" || request.operation === "task_planning" || request.operation === "repair_diagnosis")) {
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

      this.browserManager.getStateMachine().transition("PROMPT_READY", `Prompt assembled (${promptText.length} chars)`);

      // 6. Capture pre-submission baseline state for stale response protection
      // The "before" snapshot must be taken on an idle thread; a reply still arriving (e.g. to a source
      // upload or the conversation greeting) would otherwise be read as the answer to this prompt.
      await PromptSender.waitForThreadIdle(page, 120_000, signal);
      const baseline = await PromptSender.captureBaseline(page);

      // Crash-window reconciliation: only when this exact operation was previously handed to the browser.
      let userReconciliation: { alreadySubmitted: boolean; isGenerating: boolean; diagnostic?: string };
      if (mayHaveBeenSubmitted) {
        const existingCompleted = await ResponseReader.checkForCompletedResponse(page, baseline);
        if (existingCompleted) {
          console.log(`[ChatGPTWeb] [RECONCILIATION] Discovered already completed assistant response for previously submitted ${idempotencyKey}.`);
          return this.processResponse(existingCompleted, request, promptText, startTime, mappedConversationUrl, page, idempotencyKey, payloadHash, conversationManager, db);
        }
        userReconciliation = await PromptSender.reconcileExistingUserSubmission(page, promptText);
      } else {
        userReconciliation = { alreadySubmitted: false, isGenerating: await PromptSender.isGenerating(page) };
      }
      let skipBrowserSubmission = false;
      if (userReconciliation.alreadySubmitted) {
        console.log(`[ChatGPTWeb] [CRASH_WINDOW_RECONCILIATION] Detected existing accepted prompt (${userReconciliation.diagnostic}).`);
        if (idempotencyKey) {
          this.persistOperation(db, idempotencyKey, "accepted_by_browser", `UPDATE idempotent_operations SET status = 'accepted_by_browser', updated_at = ? WHERE idempotency_key = ?`, [new Date().toISOString(), idempotencyKey]);
        }

        if (!userReconciliation.isGenerating) {
          // Check if ChatGPT already completed its response to this accepted prompt
          const assistantTexts = await PromptSender.getAssistantMessageTexts(page);
          const latestAssistantText = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";
          if (
            latestAssistantText &&
            latestAssistantText.length > 20 &&
            !ResponseReader.isWorkspaceInitializationEcho(latestAssistantText) &&
            !ResponseReader.isAttachmentClarification(latestAssistantText)
          ) {
            console.log(
              `[ChatGPTWeb] [CRASH_WINDOW_RECONCILIATION] Captured existing completed response (${latestAssistantText.length} chars). Proceeding immediately.`
            );
            if (idempotencyKey) {
              this.persistOperation(db, idempotencyKey, "response_received", `UPDATE idempotent_operations SET status = 'response_received', response_text = ?, updated_at = ? WHERE idempotency_key = ?`, [latestAssistantText, new Date().toISOString(), idempotencyKey]);
            }
            this.browserManager.getStateMachine().transition("VALIDATING_RESPONSE");
            return this.processResponse(
              latestAssistantText,
              request,
              promptText,
              startTime,
              mappedConversationUrl,
              page,
              idempotencyKey,
              payloadHash,
              conversationManager,
              db
            );
          } else {
            console.warn("[ChatGPTWeb] Prompt was present in thread but has no completed assistant response. Will submit prompt.");
            skipBrowserSubmission = false;
          }
        } else {
          // ChatGPT is currently generating the answer to this prompt!
          console.log(`[ChatGPTWeb] [CRASH_WINDOW_RECONCILIATION] Assistant is actively generating response to accepted prompt. Tracking completion.`);
          skipBrowserSubmission = true;
          // Adjust baseline so waitForCompletion recognizes the in-flight generation as the target response
          baseline.assistantCount = Math.max(0, baseline.assistantCount - 1);
          // Our prompt was already on the page when the baseline tagged it; count it as new again.
          await PromptSender.unmarkLastUserTurn(page);
          baseline.lastAssistantText = "";
        }
      } else if (userReconciliation.isGenerating) {
        // If ChatGPT is currently generating a prior turn (e.g. initialization or previous answer),
        // wait for it to complete before proceeding with new baseline capture & submission!
        console.log(`[ChatGPTWeb] ChatGPT is currently generating a prior turn. Waiting for completion before prompt submission.`);
        await PromptSender.waitForGenerationToFinish(page, 45_000, signal);
        const updatedBaseline = await PromptSender.captureBaseline(page);
        baseline.assistantCount = updatedBaseline.assistantCount;
        baseline.lastAssistantText = updatedBaseline.lastAssistantText;
        baseline.userCount = updatedBaseline.userCount;
      }

      try {
        if (!skipBrowserSubmission) {
          // Durable lifecycle state 2: SUBMITTING
          if (idempotencyKey) {
            this.persistOperation(db, idempotencyKey, "submitting", `UPDATE idempotent_operations SET status = 'submitting', updated_at = ? WHERE idempotency_key = ?`, [new Date().toISOString(), idempotencyKey]);
          }

          this.browserManager.getStateMachine().transition("SUBMITTING");
          await PromptSender.submitPrompt(page, promptText, baseline, {
            signal,
            stateMachine: this.browserManager.getStateMachine(),
          });

          // Durable lifecycle state 3: BROWSER ACCEPTED
          if (idempotencyKey) {
            this.persistOperation(db, idempotencyKey, "accepted_by_browser", `UPDATE idempotent_operations SET status = 'accepted_by_browser', updated_at = ? WHERE idempotency_key = ?`, [new Date().toISOString(), idempotencyKey]);
          }
        }

        // 7. Wait for generation completion with multi-signal detection
        this.browserManager.getStateMachine().transition("WAITING_FOR_RESPONSE");
        let rawResponse: string;
        try {
          rawResponse = await ResponseReader.waitForCompletion(page, baseline, {
            timeoutMs: request.timeoutMs || this.timeoutMs,
            signal,
            stateMachine: this.browserManager.getStateMachine(),
          });
        } catch (waitErr) {
          // Timeout reconciliation: If timeout occurs after browser acceptance, inspect conversation before retrying
          console.warn(`[ChatGPTWeb] Timeout wait reached. Inspecting active conversation state for completed response...`);
          const reconciled = await ResponseReader.checkForCompletedResponse(page, baseline);
          if (reconciled) {
            console.log(`[ChatGPTWeb] [RECONCILED_ON_TIMEOUT] Found completed response after timeout.`);
            rawResponse = reconciled;
          } else {
            // Only the reply that follows OUR prompt may be used, and only once it has finished streaming.
            const stillGenerating = await PromptSender.isGenerating(page).catch(() => false);
            const turn = await PromptSender.getNewTurnResponse(page);
            const latestMsg = turn.supported && turn.userPosted ? turn.text ?? "" : "";
            if (
              !stillGenerating &&
              latestMsg.length > 20 &&
              !ResponseReader.isWorkspaceInitializationEcho(latestMsg)
            ) {
              console.log(`[ChatGPTWeb] [RECONCILED_ON_TIMEOUT] Recovered latest completed assistant message (${latestMsg.length} chars).`);
              rawResponse = latestMsg;
            } else {
              throw waitErr;
            }
          }
        }
        rawResponse = ResponseReader.stripUiChips(rawResponse);

        // Durable lifecycle state 4: RESPONSE RECEIVED
        if (idempotencyKey) {
          this.persistOperation(db, idempotencyKey, "response_received", `UPDATE idempotent_operations SET status = 'response_received', response_text = ?, updated_at = ? WHERE idempotency_key = ?`, [rawResponse, new Date().toISOString(), idempotencyKey]);
        }

        this.browserManager.getStateMachine().transition("VALIDATING_RESPONSE");

        return this.processResponse(rawResponse, request, promptText, startTime, mappedConversationUrl, page, idempotencyKey, payloadHash, conversationManager, db);
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
    }, signal);

    if (idempotencyKey) {
      ChatGPTWebProvider.inFlightOperations.set(idempotencyKey, executionPromise);
    }

    try {
      const result = await executionPromise;
      return result;
    } finally {
      if (idempotencyKey) {
        ChatGPTWebProvider.inFlightOperations.delete(idempotencyKey);
      }
    }
  }

  private processResponse(
    rawResponse: string,
    request: ReasoningRequest,
    promptText: string,
    startTime: number,
    mappedConversationUrl: string | null,
    page: any,
    idempotencyKey: string | null,
    payloadHash: string,
    conversationManager: ConversationManager,
    db: any
  ): ReasoningResult {
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

      const reviewResult: ReasoningResult = {
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

      if (idempotencyKey) {
        // Cached in memory either way so this server session never re-submits the same operation.
        ChatGPTWebProvider.idempotencyCache.set(idempotencyKey, reviewResult);
        const persisted = this.persistOperation(db, idempotencyKey, "completed", `
            INSERT INTO idempotent_operations (
              idempotency_key, project_id, run_id, attempt, stage, operation, payload_hash,
              status, response_text, parsed_json, provider_id, model_id, input_tokens, output_tokens, duration_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(idempotency_key) DO UPDATE SET
              status = 'completed',
              response_text = excluded.response_text,
              parsed_json = excluded.parsed_json,
              input_tokens = excluded.input_tokens,
              output_tokens = excluded.output_tokens,
              duration_ms = excluded.duration_ms,
              updated_at = excluded.updated_at
          `, [
            idempotencyKey,
            request.projectId,
            request.runId ?? null,
            request.attempt ?? 1,
            request.stage ?? "implementation",
            request.operation,
            payloadHash,
            rawResponse,
            JSON.stringify(reviewResult.parsed ?? null),
            this.id,
            this.getModel(),
            inputTokens,
            outputTokens,
            Date.now() - startTime,
            new Date().toISOString(),
            new Date().toISOString()
        ]);
        if (!persisted) reviewResult.warnings.push("The response was received but could not be durably recorded; it is cached for this server session only.");
      }
      return reviewResult;
    }

    // Only instruction requests carry the instruction protocol. Every other operation (requirements
    // analysis, memory summaries, connection tests, …) gets the reply verbatim for its own parser.
    if (request.operation !== "code_generation" && request.operation !== "repair_diagnosis") {
      const url = page.url();
      conversationManager.recordSuccess(request.projectId, url.includes("/c/") ? url : mappedConversationUrl && mappedConversationUrl.includes("/c/") ? mappedConversationUrl : undefined);
      const inTok = estimateTokens(promptText);
      const outTok = estimateTokens(rawResponse);
      return {
        text: rawResponse,
        providerId: this.id,
        modelId: this.getModel(),
        usage: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok },
        durationMs: Date.now() - startTime,
        warnings: [],
      };
    }

    // 9. Extract the substantive engineering instruction adhering strictly to the routing protocol
    const extracted = ResponseReader.extractInstruction(rawResponse, {
      startTime,
      allowLegacyJson: false,
      requireProtocolStatus: false,
    });

    const currentUrl = page.url();
    if (currentUrl.includes("/c/")) {
      conversationManager.recordSuccess(request.projectId, currentUrl);
    } else if (mappedConversationUrl && mappedConversationUrl.includes("/c/")) {
      conversationManager.recordSuccess(request.projectId, mappedConversationUrl);
    } else {
      conversationManager.recordSuccess(request.projectId);
    }

    if (extracted.action === "stop") {
      console.log(`[ChatGPTWeb] Explicit stop response received: ${extracted.stopReason || extracted.rationale}`);
      this.browserManager.getStateMachine().transition("STOPPED", extracted.rationale);
      const stopReason = extracted.stopReason || extracted.rationale || "Operation stopped by reasoning model.";
      const stopParsed = {
        action: "stop",
        stop_reason: stopReason,
        rationale: extracted.rationale,
        is_refusal: extracted.isRefusal ?? true,
        alternative_offered: extracted.alternativeOffered ?? null,
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

    if (extracted.status === "INVALID" || !extracted.instructionText.trim()) {
      const errorDetail = extracted.validationError || "Response did not contain a valid natural-language engineering instruction";
      console.warn(`[ChatGPTWeb] Response protocol validation notice: ${errorDetail}`);
      return {
        text: rawResponse,
        providerId: this.id,
        modelId: this.getModel(),
        usage: {
          inputTokens: estimateTokens(promptText),
          outputTokens: estimateTokens(rawResponse),
          totalTokens: estimateTokens(promptText) + estimateTokens(rawResponse),
        },
        durationMs: Date.now() - startTime,
        warnings: [errorDetail],
      };
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

    const result: ReasoningResult = {
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

    if (idempotencyKey) {
      // Cached in memory either way so this server session never re-submits the same operation.
      ChatGPTWebProvider.idempotencyCache.set(idempotencyKey, result);
      const persisted = this.persistOperation(db, idempotencyKey, "completed", `
          INSERT INTO idempotent_operations (
            idempotency_key, project_id, run_id, attempt, stage, operation, payload_hash,
            status, response_text, parsed_json, provider_id, model_id, input_tokens, output_tokens, duration_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            status = 'completed',
            response_text = excluded.response_text,
            parsed_json = excluded.parsed_json,
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            duration_ms = excluded.duration_ms,
            updated_at = excluded.updated_at
        `, [
          idempotencyKey,
          request.projectId,
          request.runId ?? null,
          request.attempt ?? 1,
          request.stage ?? "implementation",
          request.operation,
          payloadHash,
          protocolText,
          JSON.stringify(internalParsed),
          this.id,
          this.getModel(),
          inputTokens,
          outputTokens,
          Date.now() - startTime,
          new Date().toISOString(),
          new Date().toISOString()
      ]);
      if (!persisted) result.warnings.push("The response was received but could not be durably recorded; it is cached for this server session only.");
    }
    return result;
  }

  private assemblePrompt(request: ReasoningRequest): string {
    const parts: string[] = [];

    if (request.systemInstruction) {
      parts.push(`SYSTEM INSTRUCTIONS:\n${request.systemInstruction}\n`);
    }

    for (const msg of request.messages) {
      parts.push(`${msg.role.toUpperCase()}:\n${msg.content}\n`);
    }

    // Instruction requests need the routing protocol; append it only when the prompt does not already
    // define it (Orches' own prompts state the reply format once, in their last section).
    const definesFormat = request.messages.some((m) => m.content.includes("[ORCHES_ANTIGRAVITY_INSTRUCTION]"));
    if ((request.operation === "code_generation" || request.operation === "repair_diagnosis") && !definesFormat) {
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
