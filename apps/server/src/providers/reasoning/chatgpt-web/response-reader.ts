import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import type { PreSubmissionState } from "./prompt-sender.js";
import { PromptSender } from "./prompt-sender.js";

export interface ExtractedInstruction {
  instructionText: string;
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
   * Waits for ChatGPT to finish generating its response to the new user prompt,
   * using multi-signal completion detection (Stop button disappearance, message text stabilization,
   * user turn advancement, and rejection of attachment-only inquiries).
   */
  public static async waitForCompletion(
    page: Page,
    baseline: PreSubmissionState,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      stabilizationIntervalMs?: number;
    } = {}
  ): Promise<string> {
    const timeoutMs = options.timeoutMs || 180_000; // 3 minutes default
    const stabilizationInterval = options.stabilizationIntervalMs || 1500;
    const startTime = Date.now();

    let lastObservedText = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (options.signal?.aborted) throw new Error("Cancelled by user.");

      // Check for error banners
      for (const errSel of SELECTORS.errorBanner) {
        const count = await page.locator(errSel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(errSel).first().isVisible().catch(() => false);
          if (visible) {
            const errText = await page.locator(errSel).first().innerText().catch(() => "Unknown page error");
            throw new Error(`ChatGPT Web returned an error: ${errText}`);
          }
        }
      }

      const generating = await PromptSender.isGenerating(page);

      // Locate assistant messages
      const currentLocators = await this.getAssistantLocators(page);
      if (currentLocators.length > 0) {
        const latestLocator = currentLocators[currentLocators.length - 1];
        const currentText = (await latestLocator.innerText().catch(() => "")).trim();

        // Ensure this is not the stale baseline message
        const isNewMessage =
          currentLocators.length > baseline.assistantCount ||
          (currentText.length > 0 && currentText !== baseline.lastAssistantText);

        if (isNewMessage && currentText.length > 20) {
          // Reject if ChatGPT is only asking what to do with attachments
          const isAttachmentQuery = this.isAttachmentClarification(currentText);

          if (!generating) {
            // If stop button is gone, check if text has stabilized
            if (currentText === lastObservedText) {
              stableCount++;
              if (stableCount >= 2) {
                if (isAttachmentQuery) {
                  // This is an attachment prompt acknowledgment, not the substantive task answer!
                  console.warn(
                    "[ResponseReader] Detected attachment query rather than task response; waiting for task answer."
                  );
                } else {
                  // Substantive response stabilized over 2 intervals after stop button disappeared
                  return currentText;
                }
              }
            } else {
              lastObservedText = currentText;
              stableCount = 0;
            }
          } else {
            lastObservedText = currentText;
            stableCount = 0;
          }
        }
      }

      await page.waitForTimeout(stabilizationInterval).catch(() => {});
    }

    // Check if we have at least captured substantive text that is not an attachment query
    if (
      lastObservedText &&
      lastObservedText.length > 100 &&
      lastObservedText !== baseline.lastAssistantText &&
      !this.isAttachmentClarification(lastObservedText)
    ) {
      console.warn("[ResponseReader] Generation timeout reached, but captured substantive response text.");
      return lastObservedText;
    }

    throw new Error(`ChatGPT response did not complete within ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  /**
   * Extracts the actual substantive engineering instruction from the raw assistant text.
   * Prioritizes markers `[ORCHES_ANTIGRAVITY_INSTRUCTION] ... [/ORCHES_ANTIGRAVITY_INSTRUCTION]`.
   * Falls back gracefully to cleaned assistant text if markers were omitted by the model.
   */
  public static extractInstruction(rawText: string, startTime: number = Date.now()): ExtractedInstruction {
    const durationMs = Date.now() - startTime;
    const clean = (rawText || "").trim();

    // 1. Preferred contract: extract between markers (case-insensitive)
    const upper = clean.toUpperCase();
    const startIdx = upper.indexOf(this.MARKER_START.toUpperCase());
    const endIdx = upper.indexOf(this.MARKER_END.toUpperCase());

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const extracted = clean.slice(startIdx + this.MARKER_START.length, endIdx).trim();
      return {
        instructionText: extracted,
        isMarkerExtracted: true,
        rawText: clean,
        durationMs,
      };
    } else if (startIdx !== -1) {
      // Start marker present but end marker cut off or omitted
      const extracted = clean.slice(startIdx + this.MARKER_START.length).trim();
      return {
        instructionText: extracted,
        isMarkerExtracted: true,
        rawText: clean,
        durationMs,
      };
    }

    // 2. Fallback: Strip common conversational opening/closing if present
    let fallbackText = clean;
    // Strip common conversational preamble like "Sure, here is the implementation prompt:"
    fallbackText = fallbackText.replace(
      /^(certainly|sure|here is|here's|below is|i have created)\s+.*?:[\r\n]+/i,
      ""
    );
    // Strip trailing conversational sign-offs like "Let me know if you need anything else!"
    fallbackText = fallbackText.replace(
      /[\r\n]+(let me know|hope this helps|feel free to ask).*$/i,
      ""
    );

    return {
      instructionText: fallbackText.trim(),
      isMarkerExtracted: false,
      rawText: clean,
      durationMs,
    };
  }

  private static async getAssistantLocators(page: Page) {
    for (const sel of SELECTORS.assistantMessage) {
      const loc = page.locator(sel);
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        const arr = [];
        for (let i = 0; i < count; i++) {
          arr.push(loc.nth(i));
        }
        return arr;
      }
    }
    return [];
  }
}
