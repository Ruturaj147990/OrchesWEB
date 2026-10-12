import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import type { PreSubmissionState } from "./prompt-sender.js";
import { PromptSender } from "./prompt-sender.js";
import { BrowserStateMachine } from "./state-machine.js";
import { extractJsonFromText } from "../../../prompts/json-extractor.js";

export interface ExtractedInstruction {
  action: "instruct" | "stop";
  instructionText: string;
  rationale: string;
  stopReason?: string;
  isMarkerExtracted: boolean;
  rawText: string;
  durationMs: number;
}

export class ResponseReader {
  public static readonly MARKER_START = "[ORCHES_ANTIGRAVITY_INSTRUCTION]";
  public static readonly MARKER_END = "[/ORCHES_ANTIGRAVITY_INSTRUCTION]";

  /**
   * Patterns indicating the assistant is only asking what to do with attachments/files
   * and has NOT actually responded to an engineering brief or task instruction.
   */
  public static readonly ATTACHMENT_QUERY_PATTERNS = [
    /what (would|do) you like (me )?to do with (this|these|the) (file|files|document|documents|attachment|attachments)/i,
    /how (can|should) i (help|assist) you with (this|these|the) (file|files|document|documents)/i,
    /please let me know what you('d| would) like me to do with/i,
    /i have received the (file|files|attachment|attachments)\.? what/i,
    /i've received your (file|files|attachment|attachments)/i,
  ];

  /**
   * Checks whether the given text is merely an attachment acknowledgment asking for instructions.
   */
  public static isAttachmentClarification(text: string): boolean {
    const trimmed = (text || "").trim();
    if (!trimmed) return false;
    return this.ATTACHMENT_QUERY_PATTERNS.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Checks whether a new, completed assistant response already exists in the conversation
   * compared to the pre-submission baseline.
   */
  public static async checkForCompletedResponse(
    page: Page,
    baseline: PreSubmissionState
  ): Promise<string | null> {
    const isGen = await PromptSender.isGenerating(page);
    if (isGen) return null; // Still actively generating

    const assistantTexts = await PromptSender.getAssistantMessageTexts(page);
    if (assistantTexts.length === 0) return null;

    const latestText = assistantTexts[assistantTexts.length - 1];
    if (!latestText || latestText.length < 20) return null;

    // Must be new compared to baseline
    const isNew =
      assistantTexts.length > baseline.assistantCount ||
      latestText !== baseline.lastAssistantText;

    if (!isNew) return null;

    // Reject attachment-only clarification inquiries
    if (this.isAttachmentClarification(latestText)) return null;

    return latestText;
  }

  /**
   * Waits for ChatGPT to finish generating its response to the new user prompt,
   * using multi-signal completion detection (Stop button disappearance, message text stabilization,
   * user turn advancement, fast-path completion recovery, and rejection of attachment-only inquiries).
   */
  public static async waitForCompletion(
    page: Page,
    baseline: PreSubmissionState,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      stabilizationIntervalMs?: number;
      stateMachine?: BrowserStateMachine;
    } = {}
  ): Promise<string> {
    const timeoutMs = options.timeoutMs || 180_000;
    const stabilizationInterval = options.stabilizationIntervalMs || 1000;
    const startTime = Date.now();

    // Fast path: response may have completed while submission was being confirmed
    const alreadyCompleted = await this.checkForCompletedResponse(page, baseline);
    if (alreadyCompleted) {
      console.log("[ResponseReader] Fast path: completed assistant response detected immediately on page.");
      options.stateMachine?.transition("RESPONSE_COMPLETE");
      return alreadyCompleted;
    }

    let lastObservedText = "";
    let stableCount = 0;
    let lastLogTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (options.signal?.aborted) throw new Error("Cancelled by user.");

      // Check for error banners
      for (const errSel of SELECTORS.errorBanner) {
        const count = await page.locator(errSel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(errSel).first().isVisible().catch(() => false);
          if (visible) {
            const errText = await page.locator(errSel).first().innerText().catch(() => "Unknown page error");
            options.stateMachine?.transition("FAILED_RECOVERABLE", `Page error: ${errText}`);
            throw new Error(`ChatGPT Web returned an error: ${errText}`);
          }
        }
      }

      const generating = await PromptSender.isGenerating(page);
      if (generating) {
        options.stateMachine?.transition("ASSISTANT_GENERATING");
      }

      // Locate assistant messages
      const currentTexts = await PromptSender.getAssistantMessageTexts(page);
      if (currentTexts.length > 0) {
        const latestText = currentTexts[currentTexts.length - 1];

        // Ensure this is not the stale baseline message
        const isNewMessage =
          currentTexts.length > baseline.assistantCount ||
          (latestText.length > 0 && latestText !== baseline.lastAssistantText);

        if (isNewMessage && latestText.length > 20) {
          options.stateMachine?.transition("READING_RESPONSE");
          const isAttachmentQuery = this.isAttachmentClarification(latestText);

          if (!generating) {
            if (latestText === lastObservedText) {
              stableCount++;
              if (stableCount >= 2) {
                if (isAttachmentQuery) {
                  console.warn(
                    "[ResponseReader] Detected attachment query rather than task response; waiting for task answer."
                  );
                } else {
                  console.log(
                    `[ResponseReader] Assistant response complete and stabilized (${latestText.length} chars).`
                  );
                  options.stateMachine?.transition("RESPONSE_COMPLETE");
                  return latestText;
                }
              }
            } else {
              lastObservedText = latestText;
              stableCount = 0;
            }
          } else {
            lastObservedText = latestText;
            stableCount = 0;
          }
        }
      }

      // Periodic logging every 10 seconds to provide visibility into polling
      if (Date.now() - lastLogTime >= 10_000) {
        lastLogTime = Date.now();
        console.log(
          `[ResponseReader] Polling for response completion (${Math.round((Date.now() - startTime) / 1000)}s elapsed). Generating: ${generating}, messages: ${currentTexts.length}.`
        );
      }

      await page.waitForTimeout(stabilizationInterval).catch(() => {});
    }

    // Check if we captured substantive text that is not an attachment query
    if (
      lastObservedText &&
      lastObservedText.length > 100 &&
      lastObservedText !== baseline.lastAssistantText &&
      !this.isAttachmentClarification(lastObservedText)
    ) {
      console.warn("[ResponseReader] Generation timeout reached, but captured substantive response text.");
      options.stateMachine?.transition("RESPONSE_COMPLETE");
      return lastObservedText;
    }

    options.stateMachine?.transition("FAILED_RECOVERABLE", "Response timeout");
    throw new Error(`ChatGPT response did not complete within ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  /**
   * Extracts the actual substantive engineering instruction from the raw assistant text.
   * Handles JSON envelopes (`{ action, instruction, rationale, stop_reason }`),
   * marker-delimited Markdown (`[ORCHES_ANTIGRAVITY_INSTRUCTION] ... [/ORCHES_ANTIGRAVITY_INSTRUCTION]`),
   * and clean Markdown fallbacks.
   */
  public static extractInstruction(rawText: string, startTime: number = Date.now()): ExtractedInstruction {
    const durationMs = Date.now() - startTime;
    const clean = (rawText || "").trim();

    // 1. Try parsing JSON envelope first
    const parsed = extractJsonFromText(clean) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const action = String(parsed.action || "").toLowerCase().trim();
      const rationale = String(parsed.rationale || parsed.reason || "Reasoning response from ChatGPT Web").trim();

      if (action === "stop") {
        const stopReason = String(parsed.stop_reason || parsed.stopReason || rationale || "The model stopped the run.").trim();
        return {
          action: "stop",
          instructionText: "",
          rationale,
          stopReason,
          isMarkerExtracted: false,
          rawText: clean,
          durationMs,
        };
      }

      // Action is instruct (or default)
      let innerText = "";
      if (typeof parsed.instruction === "string") {
        innerText = parsed.instruction.trim();
      } else if (typeof parsed.prompt === "string") {
        innerText = parsed.prompt.trim();
      }

      // Extract markers inside instruction field if present
      if (innerText) {
        const markerResult = this.extractFromMarkers(innerText);
        if (markerResult) {
          return {
            action: "instruct",
            instructionText: markerResult,
            rationale,
            isMarkerExtracted: true,
            rawText: clean,
            durationMs,
          };
        }
        return {
          action: "instruct",
          instructionText: innerText,
          rationale,
          isMarkerExtracted: false,
          rawText: clean,
          durationMs,
        };
      }
    }

    // 2. Non-JSON: Check for markers directly in raw text
    const markerResult = this.extractFromMarkers(clean);
    if (markerResult) {
      return {
        action: "instruct",
        instructionText: markerResult,
        rationale: "Engineering implementation brief from ChatGPT Web",
        isMarkerExtracted: true,
        rawText: clean,
        durationMs,
      };
    }

    // 3. Fallback: Strip common conversational opening/closing if present
    let fallbackText = clean;
    fallbackText = fallbackText.replace(
      /^(certainly|sure|here is|here's|below is|i have created)\s+.*?:[\r\n]+/i,
      ""
    );
    fallbackText = fallbackText.replace(
      /[\r\n]+(let me know|hope this helps|feel free to ask).*$/i,
      ""
    );

    return {
      action: "instruct",
      instructionText: fallbackText.trim(),
      rationale: "Engineering implementation brief from ChatGPT Web",
      isMarkerExtracted: false,
      rawText: clean,
      durationMs,
    };
  }

  private static extractFromMarkers(text: string): string | null {
    if (!text) return null;
    const upper = text.toUpperCase();
    const startIdx = upper.indexOf(this.MARKER_START.toUpperCase());
    const endIdx = upper.indexOf(this.MARKER_END.toUpperCase());

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return text.slice(startIdx + this.MARKER_START.length, endIdx).trim();
    } else if (startIdx !== -1) {
      return text.slice(startIdx + this.MARKER_START.length).trim();
    }
    return null;
  }
}
