import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import { BrowserStateMachine } from "./state-machine.js";

export interface PreSubmissionState {
  assistantCount: number;
  lastAssistantText: string;
  userCount: number;
  timestamp: number;
}

export interface AssistantDiscoveryResult {
  texts: string[];
  status:
    | "discovered"
    | "awaiting_response"
    | "empty_conversation"
    | "dom_extraction_failed"
    | "auth_required"
    | "challenge_required"
    | "page_error";
  diagnostic?: string;
}

export class PromptSender {
  /**
   * Captures the baseline state of assistant and user messages before submission
   * to guarantee stale responses are never accepted and new user message arrival can be verified.
   */
  public static async captureBaseline(page: Page): Promise<PreSubmissionState> {
    let assistantTexts = await this.getAssistantMessageTexts(page);
    // If on a dedicated conversation thread and texts are not yet rendered, allow brief hydration
    if (assistantTexts.length === 0 && page.url().includes("/c/")) {
      await page.waitForTimeout(1000).catch(() => {});
      assistantTexts = await this.getAssistantMessageTexts(page);
    }
    const assistantCount = assistantTexts.length;
    const lastAssistantText = assistantCount > 0 ? assistantTexts[assistantCount - 1] : "";
    const userCount = await this.getUserMessageCount(page);

    return {
      assistantCount,
      lastAssistantText,
      userCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Checks whether ChatGPT is currently in the middle of generating a response.
   * Prevents duplicate prompt submissions.
   */
  public static async isGenerating(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.stopButton) {
      const loc = page.locator(sel);
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        const visible = await loc.first().isVisible().catch(() => false);
        if (visible) return true;
      }
    }

    // Secondary DOM check to reliably detect visible stop button
    const stopVisible = await page.evaluate(() => {
      const stopBtn = document.querySelector(
        "button[data-testid='stop-button'], button[aria-label='Stop streaming'], button[aria-label='Stop generating'], button[aria-label='Stop generation']"
      );
      if (!stopBtn) return false;
      const rect = stopBtn.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(stopBtn).display !== "none";
    }).catch(() => false);

    return stopVisible === true;
  }

  /**
   * Counts the number of visible user messages in the active conversation.
   */
  public static async getUserMessageCount(page: Page): Promise<number> {
    for (const sel of SELECTORS.userMessage) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) return count;
    }
    const countFromEval = await page.evaluate(() => {
      const userHeaders = Array.from(document.querySelectorAll("h4, h5, h6, [data-conversation-role]")).filter(
        (h) => h.getAttribute("data-conversation-role") === "user" || (h.textContent || "").includes("You said:")
      );
      if (userHeaders.length > 0) return userHeaders.length;

      const msgs = document.querySelectorAll(
        "[data-markdown-text-style='user-message'], [data-chatgpt-search-unit-key*='user'], [data-message-author-role='user'], [data-testid*='user'], .user-turn, div[class*='user-message']"
      );
      return msgs.length;
    }).catch(() => 0);
    return countFromEval;
  }

  /**
   * Retrieves all visible user message texts from the active conversation.
   */
  /**
   * Retrieves all visible user message texts from the active conversation.
   */
  public static async getUserMessageTexts(page: Page): Promise<string[]> {
    const res = await page.evaluate(() => {
      const texts: string[] = [];

      // Strategy 1: Elements with user markdown attribute
      const userNodes = Array.from(
        document.querySelectorAll("[data-markdown-text-style='user-message'], div.group\\/user-message, [data-chatgpt-search-unit-key*='user'], [data-message-author-role='user']")
      );
      if (userNodes.length > 0) {
        for (const el of userNodes) {
          const t = (el as HTMLElement).innerText?.trim();
          if (t) texts.push(t);
        }
        if (texts.length > 0) return texts;
      }

      // Strategy 2: User semantic headers ("You said:")
      const userHeaders = Array.from(document.querySelectorAll("h4, h5, h6, [data-conversation-role='user']")).filter(
        (h) => h.getAttribute("data-conversation-role") === "user" || (h.textContent || "").includes("You said:")
      );
      for (const h of userHeaders) {
        let container: HTMLElement | null = h.parentElement;
        while (container && container !== document.body) {
          if (container.classList.contains("block-BQZwFn") || Array.from(container.classList).some((c) => c.startsWith("block-"))) {
            break;
          }
          container = container.parentElement;
        }
        if (!container) container = h.parentElement;
        if (container) {
          const clone = container.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("h4, h5, h6, button, svg").forEach((n) => n.remove());
          const t = clone.innerText?.trim();
          if (t) texts.push(t);
        }
      }
      return texts;
    }).catch(() => []);

    return Array.isArray(res) ? res.filter((t): t is string => typeof t === "string") : [];
  }

  /**
   * Reconciles whether the current prompt was already submitted into ChatGPT Web prior to a crash.
   * Compares prompt prefix / signature against existing user messages and generation state.
   */
  public static async reconcileExistingUserSubmission(
    page: Page,
    promptText: string
  ): Promise<{ alreadySubmitted: boolean; isGenerating: boolean; diagnostic?: string }> {
    const trimmedPrompt = (promptText || "").trim();
    if (!trimmedPrompt) {
      return { alreadySubmitted: false, isGenerating: false };
    }

    const isGenerating = await this.isGenerating(page);
    const userTexts = await this.getUserMessageTexts(page);

    if (Array.isArray(userTexts) && userTexts.length > 0) {
      const latestUserText = (userTexts[userTexts.length - 1] || "").trim();

      // Normalized comparison: compare first 300 chars or prefix signature
      const promptSnippet = trimmedPrompt.slice(0, 300).replace(/\s+/g, " ").trim();
      const userSnippet = latestUserText.slice(0, 300).replace(/\s+/g, " ").trim();

      const exactOrPrefixMatch =
        latestUserText === trimmedPrompt ||
        latestUserText.startsWith(promptSnippet) ||
        trimmedPrompt.startsWith(userSnippet) ||
        (userSnippet.length > 40 && promptSnippet.includes(userSnippet)) ||
        (promptSnippet.length > 40 && userSnippet.includes(promptSnippet));

      if (exactOrPrefixMatch) {
        return {
          alreadySubmitted: true,
          isGenerating,
          diagnostic: `Matched existing user message in thread (user turns=${userTexts.length}, generating=${isGenerating})`,
        };
      }
    }

    return { alreadySubmitted: false, isGenerating };
  }

  /**
   * Submits a reasoning prompt into ChatGPT Web with multi-signal verification:
   * 1. Idle generation check
   * 2. Composer targeting & content insertion (textarea & contenteditable)
   * 3. Composer content verification (non-empty & fingerprinted)
   * 4. Send action invocation
   * 5. Multi-signal submission confirmation (composer cleared, user turn incremented, or generation started)
   */
  public static async submitPrompt(
    page: Page,
    promptText: string,
    baseline: PreSubmissionState,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      stateMachine?: BrowserStateMachine;
    } = {}
  ): Promise<void> {
    if (options.signal?.aborted) throw new Error("Submission cancelled by user.");

    const trimmed = (promptText || "").trim();
    if (!trimmed) {
      throw new Error("Refusing to submit empty prompt to ChatGPT Web.");
    }

    // 1. Prevent duplicate prompt submission if already generating
    const alreadyGenerating = await this.isGenerating(page);
    if (alreadyGenerating) {
      console.warn("[PromptSender] ChatGPT is already generating. Waiting for in-flight generation to complete.");
      await this.waitForGenerationToFinish(page, 60_000, options.signal);
    }

    // 2. Locate composer locator
    let composerLocator = null;
    let matchedSelector = SELECTORS.composer[0];
    for (const sel of SELECTORS.composer) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        composerLocator = loc;
        matchedSelector = sel;
        break;
      }
    }
    if (!composerLocator) {
      throw new Error("Prompt composer not found on ChatGPT page.");
    }

    // 3. Clear existing text and fill composer reliably via clipboard paste or keyboard input
    await composerLocator.click();
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});

    let filled = false;
    // Clipboard paste triggers native input/paste events which ProseMirror monitors to update internal state and enable the Send button
    try {
      await page.evaluate((val) => {
        return navigator.clipboard.writeText(val);
      }, trimmed);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(300);
      filled = true;
    } catch {
      // Fallback if clipboard API is restricted
    }

    if (!filled) {
      try {
        await composerLocator.fill(trimmed, { timeout: 3000 });
        filled = true;
      } catch {
        // Contenteditable divs or custom components can fail fill()
      }
    }

    if (!filled) {
      await page.evaluate(
        ({ selector, val }) => {
          const el = document.querySelector(selector) as HTMLElement;
          if (el) {
            if ("value" in el) {
              (el as HTMLTextAreaElement).value = val;
            } else {
              el.innerText = val;
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        },
        { selector: matchedSelector, val: trimmed }
      );
      // Keyboard space + backspace to ensure ProseMirror event fires
      await page.keyboard.type(" ", { delay: 10 }).catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
    }

    // 4. Wait for ChatGPT to process the pasted text, generate any attachment pill card, and enable the Send button
    let composerStaged = false;
    let sendBtnActive = false;
    const stagingStart = Date.now();
    const maxStagingWaitMs = 20_000; // Allow ample time for ChatGPT to digest large multi-kilobyte text and render pills

    while (Date.now() - stagingStart < maxStagingWaitMs) {
      if (options.signal?.aborted) throw new Error("Submission cancelled by user.");

      const status = await page.evaluate(({ selector }) => {
        const composerEl = document.querySelector(selector) as HTMLElement | null;
        const text = composerEl ? (("value" in composerEl ? (composerEl as HTMLTextAreaElement).value : composerEl.innerText) || "") : "";
        
        // 1. Check for standard attachment chip / card attributes
        const hasAttachmentAttr = !!document.querySelector(
          "[data-testid*='attachment'], [data-testid*='file'], [aria-label*='Remove'], [class*='pill'], [class*='chip'], div[data-testid*='card']"
        );

        // 2. Check for pills via button / text content (e.g. "Show in text field", "SYSTEM INSTRUC")
        let hasPillText = false;
        try {
          const elements = Array.from(document.querySelectorAll("button, div, span"));
          for (const el of elements) {
            const t = el.textContent || "";
            if (t.includes("Show in text field") || t.includes("SYSTEM INSTRUC") || t.includes("ATTACHMENT")) {
              hasPillText = true;
              break;
            }
          }
        } catch {
          // ignore DOM inspection errors
        }

        // 3. Check Send button status
        const sendBtn = document.querySelector(
          "button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Submit']"
        ) as HTMLButtonElement | null;
        const sendExists = !!sendBtn;
        const sendDisabled = sendBtn
          ? sendBtn.disabled || sendBtn.hasAttribute("disabled") || sendBtn.getAttribute("aria-disabled") === "true"
          : true;
        const sendEnabled = sendExists && !sendDisabled;

        return {
          hasText: text.trim().length > 0,
          textLen: text.trim().length,
          hasPill: hasAttachmentAttr || hasPillText,
          sendExists,
          sendEnabled,
        };
      }, { selector: matchedSelector }).catch((err) => ({
        hasText: false,
        textLen: 0,
        hasPill: false,
        sendExists: false,
        sendEnabled: false,
        error: String(err),
      }));

      if (status.sendEnabled || status.hasPill || status.hasText) {
        composerStaged = true;
        if (status.sendEnabled) {
          sendBtnActive = true;
          break; // Optimal: Send button is fully enabled and ready
        }
      }

      await page.waitForTimeout(500).catch(() => {});
    }

    if (!composerStaged) {
      // If clipboard paste was triggered earlier, give one final check before failing
      const finalSendCheck = await page.evaluate(() => {
        const sendBtn = document.querySelector("button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Submit']") as HTMLButtonElement | null;
        return sendBtn ? (!sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true") : false;
      }).catch(() => false);

      if (finalSendCheck || filled) {
        composerStaged = true;
        sendBtnActive = finalSendCheck;
      } else {
        throw new Error("Failed to populate ChatGPT composer with prompt text within timeout.");
      }
    }
    options.stateMachine?.transition("COMPOSER_FILLED", `Prompt text staged (${trimmed.length} chars)`);

    // 5. Locate Send button with dedicated polling wait for enablement (pasting/pill generation can take a few seconds before Send becomes clickable)
    let sendLocator = null;
    let isSendEnabled = sendBtnActive;
    const sendWaitStart = Date.now();
    const maxSendWaitMs = 15_000;

    while (Date.now() - sendWaitStart < maxSendWaitMs) {
      if (options.signal?.aborted) throw new Error("Submission cancelled by user.");

      // Check via Playwright locators
      for (const sel of SELECTORS.sendButton) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          sendLocator = loc;
          const enabled = await loc.isEnabled().catch(() => false);
          if (enabled) {
            isSendEnabled = true;
            break;
          }
        }
      }

      if (isSendEnabled && sendLocator) break;

      // Also check DOM directly
      const domSendReady = await page.evaluate(() => {
        const btn = document.querySelector("button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Submit']") as HTMLButtonElement | null;
        if (!btn) return false;
        return !btn.disabled && !btn.hasAttribute("disabled") && btn.getAttribute("aria-disabled") !== "true";
      }).catch(() => false);

      if (domSendReady) {
        isSendEnabled = true;
        break;
      }

      await page.waitForTimeout(400).catch(() => {});
    }

    // Submit prompt
    options.stateMachine?.transition("USER_MESSAGE_SUBMITTED");
    if (sendLocator && isSendEnabled) {
      try {
        await sendLocator.click({ timeout: 5000 });
      } catch (err) {
        // If Playwright click fails (e.g. element detached or overlaid), try DOM dispatch
        await page.evaluate(() => {
          const btn = document.querySelector("button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Submit']") as HTMLElement | null;
          if (btn) btn.click();
        }).catch(() => {});
      }
    } else {
      // Fallback: try DOM click first, then Enter key
      const clickedViaDom = await page.evaluate(() => {
        const btn = document.querySelector("button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Submit']") as HTMLElement | null;
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (!clickedViaDom) {
        await composerLocator.press("Enter").catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
      }
    }

    // 6. Fast, robust multi-signal submission confirmation
    const confirmation = await this.confirmSubmissionState(
      page,
      composerLocator,
      baseline,
      12_000,
      options.signal
    );

    if (confirmation.confirmed) {
      options.stateMachine?.transition("USER_MESSAGE_CONFIRMED");
      if (confirmation.alreadyCompleted) {
        options.stateMachine?.transition("RESPONSE_COMPLETE");
      } else if (confirmation.isGenerating) {
        options.stateMachine?.transition("ASSISTANT_GENERATING");
      }
    } else {
      console.warn(
        "[PromptSender] Turn count did not increment immediately; proceeding to response reader to inspect active generation state."
      );
    }
  }

  /**
   * Fast, multi-signal check confirming that the prompt was submitted:
   * - Composer content cleared/emptied
   * - User message turn count incremented
   * - Stop button appeared (generation started)
   * - Assistant container count incremented or latest assistant text started streaming/completing
   */
  public static async confirmSubmissionState(
    page: Page,
    composerLocator: any,
    baseline: PreSubmissionState,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ confirmed: boolean; isGenerating: boolean; alreadyCompleted: boolean }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("Submission cancelled by user.");

      // Check 1: Composer cleared (content reduced to empty/whitespace)
      const currentComposerContent = await composerLocator.evaluate((el: HTMLElement) => {
        if ("value" in el) return (el as HTMLTextAreaElement).value || "";
        return el.innerText || "";
      }).catch(() => "");
      const composerCleared = currentComposerContent.trim().length === 0;

      // Check 2: User turn appeared in DOM
      const userCount = await this.getUserMessageCount(page);
      const userTurnAppeared = userCount > baseline.userCount;

      // Check 3: Generation started (stop button visible)
      const generating = await this.isGenerating(page);

      // Check 4: Assistant message appeared or text changed
      const assistantTexts = await this.getAssistantMessageTexts(page);
      const assistantCountIncreased = assistantTexts.length > baseline.assistantCount;
      let assistantTextChanged = false;
      if (assistantTexts.length > 0) {
        const latestText = assistantTexts[assistantTexts.length - 1];
        assistantTextChanged = latestText.length > 0 && latestText !== baseline.lastAssistantText;
      }

      if (composerCleared || userTurnAppeared || generating || assistantCountIncreased || assistantTextChanged) {
        return {
          confirmed: true,
          isGenerating: generating,
          alreadyCompleted: !generating && (assistantCountIncreased || assistantTextChanged),
        };
      }

      await page.waitForTimeout(300).catch(() => {});
    }

    return { confirmed: false, isGenerating: false, alreadyCompleted: false };
  }

  /**
   * Retrieves structured discovery information for assistant messages, distinguishing
   * genuinely empty threads, actively generating responses, authentication/challenge walls,
   * DOM extraction failures, and successfully discovered responses.
   */
  public static async getAssistantDiscovery(page: Page): Promise<AssistantDiscoveryResult> {
    if (typeof page?.isClosed === "function" && page.isClosed()) {
      return { texts: [], status: "page_error", diagnostic: "Target page is closed" };
    }

    // 1. Check for challenge indicators
    for (const sel of SELECTORS.challenge) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        if (visible) {
          return { texts: [], status: "challenge_required", diagnostic: `Verification challenge active (${sel})` };
        }
      }
    }

    // 2. Check for login indicators
    for (const sel of SELECTORS.loginButton) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        if (visible) {
          let profileFound = false;
          for (const profSel of SELECTORS.userProfile) {
            if ((await page.locator(profSel).count().catch(() => 0)) > 0) {
              profileFound = true;
              break;
            }
          }
          if (!profileFound) {
            return { texts: [], status: "auth_required", diagnostic: "ChatGPT login required" };
          }
        }
      }
    }

    // 3. Check for page error banners
    for (const sel of SELECTORS.errorBanner) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        if (visible) {
          const errText = await page.locator(sel).first().innerText().catch(() => "Unknown page error");
          return { texts: [], status: "page_error", diagnostic: errText };
        }
      }
    }

    // 4. Primary extraction via Playwright Locators
    const locators = await this.getAssistantLocators(page);
    if (locators.length > 0) {
      const texts: string[] = [];
      for (const loc of locators) {
        const isUser = await loc.evaluate((node: HTMLElement) => {
          return (
            !!node.closest("[data-markdown-text-style='user-message'], [class*='user-message'], [data-chatgpt-search-unit-key*='user']") ||
            node.querySelector("[data-markdown-text-style='user-message'], [class*='user-message']") !== null
          );
        }).catch(() => false);
        if (!isUser) {
          const t = (await loc.innerText().catch(() => "")).trim();
          if (t) texts.push(t);
        }
      }
      if (texts.length > 0) {
        return { texts, status: "discovered" };
      }
    }

    // 5. Bounded, validated DOM-evaluation fallback across modern and classic ChatGPT layouts
    const evalResult = await page.evaluate(() => {
      try {
        const isChallenge = !!document.querySelector(
          "iframe[src*='challenges.cloudflare.com'], iframe[src*='turnstile'], #challenge-running, #cf-turnstile, .cf-turnstile, div[class*='turnstile']"
        );
        if (isChallenge) return { texts: [], status: "challenge_required" as const, diagnostic: "Cloudflare challenge detected" };

        const isLogin = !!document.querySelector("a[href*='/auth/login'], button[data-testid='login-button']");
        const hasProfile = !!document.querySelector("button[data-testid='profile-button'], nav[aria-label*='Chat history']");
        if (isLogin && !hasProfile) return { texts: [], status: "auth_required" as const, diagnostic: "Login required" };

        const errorEl = document.querySelector("[role='alert'], .text-token-text-error");
        if (errorEl) {
          const errText = (errorEl as HTMLElement).innerText?.trim();
          if (errText) return { texts: [], status: "page_error" as const, diagnostic: errText };
        }

        const texts: string[] = [];

        // Path A: Modern [data-markdown-text-style="assistant-message"]
        const modernNodes = Array.from(document.querySelectorAll("[data-markdown-text-style='assistant-message']"));
        if (modernNodes.length > 0) {
          for (const el of modernNodes) {
            const t = (el as HTMLElement).innerText?.trim() || "";
            if (t) texts.push(t);
          }
          if (texts.length > 0) return { texts, status: "discovered" as const };
        }

        // Path B: Semantic assistant headers (ChatGPT said:)
        const assistantHeaders = Array.from(document.querySelectorAll("h4, h5, h6, [data-conversation-role='assistant']")).filter(
          (h) => h.getAttribute("data-conversation-role") === "assistant" || (h.textContent || "").includes("ChatGPT said:")
        );
        if (assistantHeaders.length > 0) {
          for (const h of assistantHeaders) {
            let container: HTMLElement | null = h.parentElement;
            while (container && container !== document.body) {
              if (container.classList.contains("block-BQZwFn") || Array.from(container.classList).some((c) => c.startsWith("block-"))) {
                break;
              }
              container = container.parentElement;
            }
            if (!container) container = h.parentElement;
            if (container) {
              const clone = container.cloneNode(true) as HTMLElement;
              clone.querySelectorAll("h4, h5, h6, button, svg, form").forEach((n) => n.remove());
              const t = clone.innerText?.trim() || "";
              if (t) texts.push(t);
            }
          }
          if (texts.length > 0) return { texts, status: "discovered" as const };
        }

        // Path C: Deeply inline message ID containers [data-dil-message-id]
        const dilNodes = Array.from(document.querySelectorAll("[data-dil-message-id]"));
        if (dilNodes.length > 0) {
          for (const el of dilNodes) {
            const t = (el as HTMLElement).innerText?.trim() || "";
            if (t) texts.push(t);
          }
          if (texts.length > 0) return { texts, status: "discovered" as const };
        }

        // Path D: Writing block / Canvas
        const writingBlocks = Array.from(document.querySelectorAll("[data-testid='chatgpt-writing-block'], .writing-block-editor, .ProseMirror[contenteditable='true']:not([data-composer-markdown])"));
        if (writingBlocks.length > 0) {
          for (const el of writingBlocks) {
            const t = (el as HTMLElement).innerText?.trim() || "";
            if (t) texts.push(t);
          }
          if (texts.length > 0) return { texts, status: "discovered" as const };
        }

        // Path E: Classic role="assistant"
        const classicAssistant = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
        if (classicAssistant.length > 0) {
          for (const el of classicAssistant) {
            const t = (el as HTMLElement).innerText?.trim() || "";
            if (t) texts.push(t);
          }
          if (texts.length > 0) return { texts, status: "discovered" as const };
        }

        // Path F: Generic conversation turns filtering out user turns
        const turns = Array.from(document.querySelectorAll("article, [data-testid*='conversation-turn'], div[class*='block-']"));
        for (const turn of turns) {
          const hasUser = !!turn.querySelector("[data-markdown-text-style='user-message'], [class*='user-message'], [data-message-author-role='user'], [data-chatgpt-search-unit-key*='user']");
          const hasUserHeader = Array.from(turn.querySelectorAll("h4, h5, h6")).some((h) => (h.textContent || "").includes("You said:"));
          if (!hasUser && !hasUserHeader) {
            const clone = turn.cloneNode(true) as HTMLElement;
            clone.querySelectorAll("h4, h5, h6, button, svg, form").forEach((n) => n.remove());
            const t = clone.innerText?.trim() || "";
            if (t && t.length > 20) texts.push(t);
          }
        }
        if (texts.length > 0) return { texts, status: "discovered" as const };

        // Path G: Markdown / prose containers
        const markdowns = Array.from(document.querySelectorAll(".markdown, .prose"));
        for (const md of markdowns) {
          const t = (md as HTMLElement).innerText?.trim() || "";
          if (t) texts.push(t);
        }
        if (texts.length > 0) return { texts, status: "discovered" as const };

        // 3. No assistant message found. Distinguish empty conversation vs extraction failure
        const userElements = document.querySelectorAll(
          "[data-markdown-text-style='user-message'], div.group\\/user-message, [class*='user-message'], [data-message-author-role='user'], [data-chatgpt-search-unit-key*='user']"
        );
        const userHeaders = Array.from(document.querySelectorAll("h4, h5, h6")).filter((h) => (h.textContent || "").includes("You said:"));
        const totalUserIndicators = userElements.length + userHeaders.length;


        if (totalUserIndicators > 0) {
          return {
            texts: [],
            status: "dom_extraction_failed" as const,
            diagnostic: `Conversation contains ${totalUserIndicators} user turn indicator(s), but assistant containers could not be matched by any selector`,
          };
        }

        return {
          texts: [],
          status: "empty_conversation" as const,
          diagnostic: "Genuinely empty conversation thread (no user or assistant turns)",
        };
      } catch (err: any) {
        return {
          texts: [],
          status: "dom_extraction_failed" as const,
          diagnostic: `DOM evaluation threw exception: ${err?.message || String(err)}`,
        };
      }
    }).catch((evalErr: any) => ({
      texts: [],
      status: "dom_extraction_failed" as const,
      diagnostic: `Page evaluate failed: ${evalErr?.message || String(evalErr)}`,
    }));

    if (Array.isArray(evalResult)) {
      const stringTexts = evalResult.filter((t): t is string => typeof t === "string" && Boolean(t.trim()));
      return {
        texts: stringTexts,
        status: stringTexts.length > 0 ? "discovered" : "empty_conversation",
      };
    }

    if (evalResult && typeof evalResult === "object" && "texts" in evalResult && Array.isArray((evalResult as any).texts)) {
      if ((evalResult as any).status === "dom_extraction_failed") {
        const generating = await this.isGenerating(page).catch(() => false);
        if (generating) {
          return {
            texts: (evalResult as any).texts,
            status: "awaiting_response",
            diagnostic: "Generation is actively streaming in ChatGPT",
          };
        }
      }
      return evalResult as AssistantDiscoveryResult;
    }

    return {
      texts: [],
      status: "empty_conversation",
      diagnostic: "Unknown evaluation response structure",
    };
  }

  /**
   * Retrieves all visible assistant message texts, prioritizing locators and falling back
   * to full DOM evaluate across modern and classic ChatGPT layout structures.
   */
  public static async getAssistantMessageTexts(page: Page): Promise<string[]> {
    const discovery = await this.getAssistantDiscovery(page);
    return Array.isArray(discovery?.texts) ? discovery.texts : [];
  }

  /**
   * Confirms that the newly submitted user prompt appeared in the conversation turn history.
   */
  public static async confirmUserMessageSubmitted(
    page: Page,
    baselineUserCount: number,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const currentCount = await this.getUserMessageCount(page);
      if (currentCount > baselineUserCount) return true;
      await page.waitForTimeout(300).catch(() => {});
    }
    return false;
  }

  /**
   * Confirms that ChatGPT has begun generating the response to the newly submitted prompt.
   */
  public static async confirmSubmissionStarted(
    page: Page,
    baseline: PreSubmissionState,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isGenerating(page)) return true;
      const currentLocators = await this.getAssistantLocators(page);
      if (currentLocators.length > baseline.assistantCount) return true;
      await page.waitForTimeout(300).catch(() => {});
    }
    return false;
  }

  public static async waitForGenerationToFinish(
    page: Page,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("Cancelled by user.");
      if (!(await this.isGenerating(page))) return;
      await page.waitForTimeout(1000).catch(() => {});
    }
  }

  public static async getAssistantLocators(page: Page) {
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
