import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import type { PreSubmissionState } from "./prompt-sender.js";
import { PromptSender } from "./prompt-sender.js";
import { BrowserStateMachine } from "./state-machine.js";
import { AuthDetector } from "./auth-detector.js";
import { extractJsonFromText } from "../../../prompts/json-extractor.js";
import { isTaskDescriptor, isThoughtOrStatusFragment } from "../../../prompts/instruction-validator.js";
import { analyzeRefusal, extractAlternative } from "../../../prompts/refusal-detector.js";
import {
  parseReviewProtocol,
  type ParsedReview,
  type ReviewVerdict,
  type ParsedReviewCriterion,
  type ParsedReviewFinding,
  REVIEW_STATUS_PREFIX,
  REVIEW_MARKER_START,
  REVIEW_MARKER_END,
} from "../../../prompts/review-validator.js";

export {
  parseReviewProtocol,
  type ParsedReview,
  type ReviewVerdict,
  type ParsedReviewCriterion,
  type ParsedReviewFinding,
};

export type ProtocolStatus = "INSTRUCT" | "STOP" | "INVALID";

export interface ExtractedInstruction {
  action: "instruct" | "stop";
  instructionText: string;
  rationale: string;
  stopReason?: string;
  isMarkerExtracted: boolean;
  rawText: string;
  durationMs: number;
  status: ProtocolStatus;
  validationError?: string;
  isLegacyJson?: boolean;
  /** True when the model declined the request (with or without the STOP protocol line). */
  isRefusal?: boolean;
  /** What the model offered to do instead, when it declined but proposed an alternative. */
  alternativeOffered?: string | null;
}

export interface ProtocolParseOptions {
  startTime?: number;
  allowLegacyJson?: boolean;
  requireProtocolStatus?: boolean;
}

export class ResponseReader {
  public static readonly STATUS_LINE_PREFIX = "ORCHES_STATUS:";
  public static readonly STATUS_INSTRUCT = "INSTRUCT";
  public static readonly STATUS_STOP = "STOP";
  public static readonly MARKER_START = "[ORCHES_ANTIGRAVITY_INSTRUCTION]";
  public static readonly MARKER_END = "[/ORCHES_ANTIGRAVITY_INSTRUCTION]";

  public static readonly REVIEW_STATUS_PREFIX = REVIEW_STATUS_PREFIX;
  public static readonly REVIEW_MARKER_START = REVIEW_MARKER_START;
  public static readonly REVIEW_MARKER_END = REVIEW_MARKER_END;

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
   * Checks whether the given text is an Orches project workspace initialization acknowledgment or echo.
   */
  public static isWorkspaceInitializationEcho(text: string): boolean {
    const trimmed = (text || "").trim();
    if (!trimmed) return false;
    return (
      trimmed.includes("[ORCHES PROJECT:") ||
      trimmed.includes("Reasoning workspace initialized") ||
      trimmed.includes("Initialize reasoning workspace")
    );
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

    // Preferred: the assistant message after our own (untagged) prompt — immune to ChatGPT unmounting
    // older turns and to the previous reply still finishing. Message counting is only a fallback.
    const turn = await PromptSender.getNewTurnResponse(page);
    let latestText: string;
    if (turn.supported) {
      if (!turn.userPosted || !turn.text) return null;
      latestText = turn.text;
    } else {
      const assistantTexts = await PromptSender.getAssistantMessageTexts(page);
      if (assistantTexts.length <= baseline.assistantCount) return null;
      latestText = assistantTexts[assistantTexts.length - 1];
    }
    if (!latestText || latestText.length < 20) return null;

    // Reject attachment-only clarification inquiries, workspace initialization echoes, and thought fragments
    if (this.isAttachmentClarification(latestText)) return null;
    if (this.isWorkspaceInitializationEcho(latestText)) return null;
    if (isThoughtOrStatusFragment(latestText)) return null;

    // Short text (< 30 chars) without protocol markers is almost certainly an interim status or header
    if (latestText.length < 30 && !latestText.includes(this.STATUS_LINE_PREFIX) && !latestText.includes(this.MARKER_START)) {
      return null;
    }

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
    let domExtractionFailureCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (options.signal?.aborted) throw new Error("Cancelled by user.");

      // Check assistant discovery status across modern & classic DOM
      const discovery = await PromptSender.getAssistantDiscovery(page);

      // Handle critical page states immediately
      if (discovery.status === "auth_required") {
        options.stateMachine?.transition("FAILED_TERMINAL", discovery.diagnostic);
        throw new Error(`ChatGPT Web requires authentication: ${discovery.diagnostic}`);
      }
      if (discovery.status === "challenge_required") {
        options.stateMachine?.transition("FAILED_RECOVERABLE", discovery.diagnostic);
        console.warn(`[ResponseReader] Verification challenge detected (${discovery.diagnostic}). Waiting up to 60s for human/browser resolution...`);
        const resolved = await AuthDetector.waitForAuth(page, {
          timeoutMs: 60_000,
          signal: options.signal,
          onStatus: (st, msg) => console.log(`[ResponseReader] Challenge status: ${st} - ${msg}`),
        }).catch(() => false);
        if (!resolved) {
          options.stateMachine?.transition("FAILED_TERMINAL", discovery.diagnostic);
          throw new Error(`ChatGPT Web verification challenge detected: ${discovery.diagnostic}`);
        }
      }
      if (discovery.status === "page_error") {
        options.stateMachine?.transition("FAILED_RECOVERABLE", discovery.diagnostic);
        throw new Error(`ChatGPT Web returned an error: ${discovery.diagnostic}`);
      }

      const generating = await PromptSender.isGenerating(page);
      if (generating) {
        options.stateMachine?.transition("ASSISTANT_GENERATING");
        domExtractionFailureCount = 0;
      }

      // Locate the reply: the assistant message after our own (untagged) prompt. Falls back to message
      // counting only when the page has no recognizable turn markers.
      const currentTexts = discovery.texts;
      const turn = await PromptSender.getNewTurnResponse(page);
      if (currentTexts.length > 0 || (turn.supported && turn.text)) {
        domExtractionFailureCount = 0;
        const latestText = turn.supported ? turn.text ?? "" : currentTexts[currentTexts.length - 1];

        // 1. If this message is an Orches workspace initialization greeting, it belongs to thread setup,
        // NOT to the new user prompt. Filter it out so we never treat it as the prompt's answer!
        if (this.isWorkspaceInitializationEcho(latestText)) {
          // If the only message is the workspace init echo, then no new response has started yet
          await page.waitForTimeout(stabilizationInterval).catch(() => {});
          continue;
        }

        // Ensure this is the reply to OUR prompt, not an older message
        const isNewMessage = turn.supported ? turn.userPosted && latestText.length > 0 : currentTexts.length > baseline.assistantCount;

        // When the reply is anchored to our own prompt, even a very short answer ("READY") is real; it still
        // has to stay unchanged for several polls (the short-text wait below). Without anchoring, keep the
        // old 20-character floor that skips interim status text.
        if (isNewMessage && latestText.length > (turn.supported ? 0 : 20)) {
          options.stateMachine?.transition("READING_RESPONSE");
          const isAttachmentQuery = this.isAttachmentClarification(latestText);
          const isThoughtFragment = isThoughtOrStatusFragment(latestText);
          const isShortWithoutProtocol =
            latestText.length < 80 &&
            !latestText.includes(this.STATUS_LINE_PREFIX) &&
            !latestText.includes(this.MARKER_START);

          if (!generating) {
            if (latestText === lastObservedText) {
              stableCount++;
              if (stableCount >= 2) {
                if (isAttachmentQuery) {
                  console.warn(
                    "[ResponseReader] Detected attachment query rather than task response; waiting for task answer."
                  );
                } else if ((isThoughtFragment || isShortWithoutProtocol) && stableCount < 6) {
                  // Give ChatGPT up to 6 seconds in case it paused mid-stream before outputting more tokens
                  console.log(
                    `[ResponseReader] Observed stabilized interim text (${latestText.length} chars: "${latestText.slice(0, 40)}…"); waiting briefly for full protocol response (${stableCount}/6).`
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
      } else {
        // No assistant messages discovered in this poll
        if (discovery.status === "dom_extraction_failed" && !generating) {
          domExtractionFailureCount++;
          // Bounded waiting: allow up to 10 seconds of DOM settling before terminating with diagnostic
          if (domExtractionFailureCount >= 10) {
            options.stateMachine?.transition("FAILED_RECOVERABLE", "DOM extraction failure");
            throw new Error(
              `ChatGPT assistant response could not be discovered due to DOM extraction failure: ${discovery.diagnostic}`
            );
          }
        } else {
          domExtractionFailureCount = 0;
        }
      }

      // If generation hasn't started and no new message has appeared after 35 seconds of submission:
      if (!generating && !lastObservedText && Date.now() - startTime > 35_000) {
        const pageError = await page.evaluate(() => {
          const banner = document.querySelector("[role='alert'], .text-token-text-error, div[class*='error']");
          return banner ? (banner as HTMLElement).innerText?.trim() : null;
        }).catch(() => null);
        if (pageError) {
          options.stateMachine?.transition("FAILED_RECOVERABLE", pageError);
          throw new Error(`ChatGPT Web returned an error after submission: ${pageError}`);
        }
      }

      // Periodic logging every 10 seconds to provide visibility into polling
      if (Date.now() - lastLogTime >= 10_000) {
        lastLogTime = Date.now();
        console.log(
          `[ResponseReader] Polling for response completion (${Math.round((Date.now() - startTime) / 1000)}s elapsed). Generating: ${generating}, messages: ${currentTexts.length}, status: ${discovery.status}${discovery.diagnostic ? ` (${discovery.diagnostic})` : ""}.`
        );
      }

      await page.waitForTimeout(stabilizationInterval).catch(() => {});
    }

    // Check if we captured substantive text that is not an attachment query or workspace initialization echo.
    // A reply that is still streaming is incomplete and must not be used.
    const stillGenerating = await PromptSender.isGenerating(page).catch(() => false);
    if (
      !stillGenerating &&
      lastObservedText &&
      lastObservedText.length > 20 &&
      lastObservedText !== baseline.lastAssistantText &&
      !this.isAttachmentClarification(lastObservedText) &&
      !this.isWorkspaceInitializationEcho(lastObservedText)
    ) {
      console.warn("[ResponseReader] Generation timeout reached, but captured substantive response text.");
      options.stateMachine?.transition("RESPONSE_COMPLETE");
      return lastObservedText;
    }

    options.stateMachine?.transition("FAILED_RECOVERABLE", "Response timeout");
    throw new Error(`ChatGPT response did not complete within ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  /**
   * Deterministically parses and extracts instruction text from the assistant's response.
   * Adheres strictly to the natural-language routing protocol:
   *
   *   ORCHES_STATUS: INSTRUCT
   *   [ORCHES_ANTIGRAVITY_INSTRUCTION]
   *   # Implementation Mission ...
   *   [/ORCHES_ANTIGRAVITY_INSTRUCTION]
   *
   * or:
   *
   *   ORCHES_STATUS: STOP
   *   Reason: ...
   *
   * Supports backward compatibility with historical legacy JSON records when configured.
   */
  public static extractInstruction(
    rawText: string,
    optionsOrStartTime: number | ProtocolParseOptions = Date.now()
  ): ExtractedInstruction {
    const opts: ProtocolParseOptions =
      typeof optionsOrStartTime === "number"
        ? { startTime: optionsOrStartTime, allowLegacyJson: true }
        : { allowLegacyJson: true, ...optionsOrStartTime };

    return this.parseProtocol(rawText, opts);
  }

  /**
   * Internal deterministic parser enforcing protocol validation, delimiter integrity,
   * and safe rejection of ambiguous, malformed, or task-descriptor payloads.
   */
  /**
   * Parses the routing protocol and then classifies refusals, so a reply such as "I can’t help build
   * that, but I can help you build a simulator" is never treated as an instruction for the agent.
   */
  public static parseProtocol(rawText: string, options: ProtocolParseOptions = {}): ExtractedInstruction {
    const result = this.parseProtocolCore(rawText, options);
    const clean = (rawText || "").trim();

    if (result.action === "stop") {
      const reason = result.stopReason || result.rationale || clean;
      return { ...result, isRefusal: true, alternativeOffered: extractAlternative(reason) ?? extractAlternative(clean) };
    }

    // Text that sits inside the instruction markers must OPEN with the refusal; free text (no markers)
    // may refuse anywhere near its start unless it is clearly a structured brief.
    let refusal = { isRefusal: false, alternative: null as string | null };
    if (result.status === "INSTRUCT" && result.isMarkerExtracted) {
      refusal = analyzeRefusal(result.instructionText, { requireLeading: true });
    } else if (!clean.includes(this.MARKER_START)) {
      const leading = analyzeRefusal(clean, { requireLeading: true });
      const anywhere = analyzeRefusal(clean);
      const looksLikeStructuredBrief = clean.length >= 2500 && /^#{1,3}\s/m.test(clean.slice(0, 700));
      refusal = leading.isRefusal ? leading : anywhere.isRefusal && !looksLikeStructuredBrief ? anywhere : refusal;
    }
    if (refusal.isRefusal) {
      const reason = result.status === "INSTRUCT" && result.isMarkerExtracted ? result.instructionText : clean;
      return {
        action: "stop",
        status: "STOP",
        instructionText: "",
        rationale: reason.slice(0, 4000),
        stopReason: reason.slice(0, 4000),
        isMarkerExtracted: false,
        rawText: clean,
        durationMs: result.durationMs,
        isRefusal: true,
        alternativeOffered: refusal.alternative,
      };
    }
    return result;
  }

  private static parseProtocolCore(rawText: string, options: ProtocolParseOptions = {}): ExtractedInstruction {
    const startTime = options.startTime ?? Date.now();
    const durationMs = Date.now() - startTime;
    const clean = (rawText || "").trim();

    if (!clean) {
      return {
        action: "instruct",
        status: "INVALID",
        instructionText: "",
        rationale: "",
        validationError: "Response text is empty",
        isMarkerExtracted: false,
        rawText: clean,
        durationMs,
      };
    }

    // 1. Check for protocol status line (ORCHES_STATUS: INSTRUCT | STOP)
    const statusMatch = clean.match(/(?:^|\r?\n)\s*ORCHES_STATUS:\s*([A-Za-z0-9_-]+)/i);

    if (statusMatch) {
      const statusValue = statusMatch[1].toUpperCase().trim();

      // Handle ORCHES_STATUS: STOP
      if (statusValue === this.STATUS_STOP) {
        // Inspect for contradictory instruction delimiters containing executable payload
        const markers = this.locateTopLevelDelimiters(clean);
        if (markers.starts.length > 0 && markers.ends.length > 0) {
          const innerContent = clean.slice(markers.starts[0] + this.MARKER_START.length, markers.ends[0]).trim();
          if (innerContent.length > 0) {
            return {
              action: "stop",
              status: "INVALID",
              instructionText: "",
              rationale: "",
              validationError: "Contradictory response: STOP status contains executable instruction payload",
              isMarkerExtracted: false,
              rawText: clean,
              durationMs,
            };
          }
        }

        const reasonMatch = clean.match(/(?:^|\r?\n)\s*Reason:\s*([^\r\n]+(?:\r?\n(?!(?:ORCHES_STATUS|\[ORCHES))[^\r\n]+)*)/i);
        let reason = reasonMatch ? reasonMatch[1].trim() : "";
        if (!reason) {
          // Extract text following status line if Reason label was omitted
          const afterStatus = clean.slice((statusMatch.index || 0) + statusMatch[0].length).trim();
          reason = afterStatus || "Operation stopped by reasoning model.";
        }

        return {
          action: "stop",
          status: "STOP",
          instructionText: "",
          rationale: reason,
          stopReason: reason,
          isMarkerExtracted: false,
          rawText: clean,
          durationMs,
        };
      }

      // Handle ORCHES_STATUS: INSTRUCT
      if (statusValue === this.STATUS_INSTRUCT) {
        const markers = this.locateTopLevelDelimiters(clean);

        if (markers.starts.length === 0) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Missing opening instruction delimiter [ORCHES_ANTIGRAVITY_INSTRUCTION]",
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
          };
        }

        if (markers.ends.length === 0) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Missing closing instruction delimiter [/ORCHES_ANTIGRAVITY_INSTRUCTION] (response may be truncated)",
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
          };
        }

        if (markers.ends[0] < markers.starts[0]) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Reversed delimiters: closing delimiter [/ORCHES_ANTIGRAVITY_INSTRUCTION] appears before opening delimiter",
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
          };
        }

        if (markers.starts.length > 1) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Duplicated opening instruction delimiters detected",
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
          };
        }

        if (markers.ends.length > 1) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Duplicated closing instruction delimiters detected",
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
          };
        }

        const rawBody = clean.slice(markers.starts[0] + this.MARKER_START.length, markers.ends[0]);
        // Strip only leading and trailing newlines, preserving all inner markdown indentation, code blocks, lists
        const instructionText = rawBody.replace(/^\r?\n+/, "").replace(/\r?\n+$/, "");

        if (!instructionText.trim()) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Instruction body between delimiters is empty",
            isMarkerExtracted: true,
            rawText: clean,
            durationMs,
          };
        }

        if (isThoughtOrStatusFragment(instructionText)) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: `Instruction body is an interim thought fragment or status update ("${instructionText.slice(0, 40)}") rather than an engineering brief`,
            isMarkerExtracted: true,
            rawText: clean,
            durationMs,
          };
        }

        if (isTaskDescriptor(instructionText)) {
          return {
            action: "instruct",
            status: "INVALID",
            instructionText: "",
            rationale: "",
            validationError: "Instruction body is an internal task-planning descriptor rather than a substantive engineering brief",
            isMarkerExtracted: true,
            rawText: clean,
            durationMs,
          };
        }

        const rationaleMatch = clean.match(/(?:^|\r?\n)\s*Rationale:\s*([^\r\n]+)/i);
        const rationale = rationaleMatch ? rationaleMatch[1].trim() : "Engineering implementation brief from ChatGPT Web";

        return {
          action: "instruct",
          status: "INSTRUCT",
          instructionText,
          rationale,
          isMarkerExtracted: true,
          rawText: clean,
          durationMs,
        };
      }

      // Invalid status value
      return {
        action: "instruct",
        status: "INVALID",
        instructionText: "",
        rationale: "",
        validationError: `Invalid protocol status '${statusMatch[1]}': expected INSTRUCT or STOP`,
        isMarkerExtracted: false,
        rawText: clean,
        durationMs,
      };
    }

    // 2. No ORCHES_STATUS found — check for explicit model refusal
    const isRefusal =
      /^(i (cannot|can't|am unable to|must decline to)|as an ai language model, i (cannot|can't))\b/i.test(clean) ||
      /i cannot fulfill this request\b/i.test(clean);

    if (isRefusal) {
      return {
        action: "stop",
        status: "STOP",
        instructionText: "",
        rationale: clean,
        stopReason: clean,
        isMarkerExtracted: false,
        rawText: clean,
        durationMs,
      };
    }

    // 3. Backward compatibility for legacy JSON envelopes
    if (options.allowLegacyJson !== false) {
      const parsed = extractJsonFromText(clean) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        const action = String(parsed.action || "").toLowerCase().trim();
        const rationale = String(parsed.rationale || parsed.reason || "Reasoning response from ChatGPT Web").trim();

        if (action === "stop") {
          const stopReason = String(parsed.stop_reason || parsed.stopReason || rationale || "The model stopped the run.").trim();
          return {
            action: "stop",
            status: "STOP",
            instructionText: "",
            rationale,
            stopReason,
            isMarkerExtracted: false,
            rawText: clean,
            durationMs,
            isLegacyJson: true,
          };
        }

        let innerText = "";
        if (typeof parsed.instruction === "string") innerText = parsed.instruction.trim();
        else if (typeof parsed.prompt === "string") innerText = parsed.prompt.trim();

        if (innerText) {
          const markerResult = this.extractFromMarkers(innerText);
          return {
            action: "instruct",
            status: "INSTRUCT",
            instructionText: markerResult || innerText,
            rationale,
            isMarkerExtracted: !!markerResult,
            rawText: clean,
            durationMs,
            isLegacyJson: true,
          };
        }
      }
    } else {
      // Legacy JSON forbidden in strict mode
      if (clean.startsWith("{") || clean.startsWith("```json")) {
        return {
          action: "instruct",
          status: "INVALID",
          instructionText: "",
          rationale: "",
          validationError: "Active response contract requires natural-language protocol (ORCHES_STATUS: INSTRUCT), not JSON envelope",
          isMarkerExtracted: false,
          rawText: clean,
          durationMs,
        };
      }
    }

    // 4. If strict protocol status is enforced, missing status line is an invalid response
    if (options.requireProtocolStatus) {
      return {
        action: "instruct",
        status: "INVALID",
        instructionText: "",
        rationale: "",
        validationError: "Missing protocol status line (ORCHES_STATUS: INSTRUCT or ORCHES_STATUS: STOP)",
        isMarkerExtracted: false,
        rawText: clean,
        durationMs,
      };
    }

    // 5. Permissive fallback for raw text or markers without status line
    const markerResult = this.extractFromMarkers(clean);
    if (markerResult) {
      return {
        action: "instruct",
        status: "INSTRUCT",
        instructionText: markerResult,
        rationale: "Engineering implementation brief from ChatGPT Web",
        isMarkerExtracted: true,
        rawText: clean,
        durationMs,
      };
    }

    let fallbackText = clean;
    fallbackText = fallbackText.replace(
      /^(certainly|sure|here is|here's|below is|i have created)\s+.*?:[\r\n]+/i,
      ""
    );
    fallbackText = fallbackText.replace(
      /[\r\n]+(let me know|hope this helps|feel free to ask).*$/i,
      ""
    );
    const trimmedFallback = fallbackText.trim();

    // Do not allow hollow stubs, thought fragments, or task descriptors as fallback instructions
    if (
      !trimmedFallback ||
      trimmedFallback.length < 30 ||
      isThoughtOrStatusFragment(trimmedFallback) ||
      isTaskDescriptor(trimmedFallback)
    ) {
      return {
        action: "instruct",
        status: "INVALID",
        instructionText: "",
        rationale: "",
        validationError: isThoughtOrStatusFragment(trimmedFallback)
          ? `Response is an interim thought fragment or status update ("${trimmedFallback}") rather than an engineering brief`
          : isTaskDescriptor(trimmedFallback)
            ? "Response is an internal task-planning descriptor rather than an engineering brief"
            : `Response body is too brief (${trimmedFallback.length} chars) to constitute an actionable engineering instruction`,
        isMarkerExtracted: false,
        rawText: clean,
        durationMs,
      };
    }

    return {
      action: "instruct",
      status: "INSTRUCT",
      instructionText: trimmedFallback,
      rationale: "Engineering implementation brief from ChatGPT Web",
      isMarkerExtracted: false,
      rawText: clean,
      durationMs,
    };
  }

  /**
   * Discovers top-level delimiter positions while ignoring incidental markers
   * inside fenced code blocks or inline backticks.
   */
  public static locateTopLevelDelimiters(text: string): { starts: number[]; ends: number[] } {
    const codeRanges: Array<{ start: number; end: number }> = [];

    // Fenced code blocks ```...```
    const fenceRegex = /```[\s\S]*?(?:```|$)/g;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(text)) !== null) {
      codeRanges.push({ start: match.index, end: match.index + match[0].length });
    }

    // Inline code spans `...`
    const inlineRegex = /`[^`\r\n]+`/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      codeRanges.push({ start: match.index, end: match.index + match[0].length });
    }

    const isInsideCode = (idx: number): boolean => {
      return codeRanges.some((r) => idx >= r.start && idx < r.end);
    };

    const upperText = text.toUpperCase();
    const upperStart = this.MARKER_START.toUpperCase();
    const upperEnd = this.MARKER_END.toUpperCase();

    const starts: number[] = [];
    let sIdx = 0;
    while ((sIdx = upperText.indexOf(upperStart, sIdx)) !== -1) {
      if (!isInsideCode(sIdx)) {
        starts.push(sIdx);
      }
      sIdx += upperStart.length;
    }

    const ends: number[] = [];
    let eIdx = 0;
    while ((eIdx = upperText.indexOf(upperEnd, eIdx)) !== -1) {
      if (!isInsideCode(eIdx)) {
        ends.push(eIdx);
      }
      eIdx += upperEnd.length;
    }

    return { starts, ends };
  }

  public static extractFromMarkers(text: string): string | null {
    if (!text) return null;
    const { starts, ends } = this.locateTopLevelDelimiters(text);

    if (starts.length > 0 && ends.length > 0 && ends[0] > starts[0]) {
      return text.slice(starts[0] + this.MARKER_START.length, ends[0]).trim();
    } else if (starts.length > 0) {
      return text.slice(starts[0] + this.MARKER_START.length).trim();
    }
    return null;
  }

  /**
   * Deterministically extracts and validates an independent review response conforming
   * to the natural-language review protocol (ORCHES_REVIEW_STATUS and [ORCHES_REVIEW]).
   */
  public static extractReview(
    rawText: string,
    options: { allowLegacyJson?: boolean } = {}
  ): ParsedReview {
    return parseReviewProtocol(rawText, options);
  }
}
