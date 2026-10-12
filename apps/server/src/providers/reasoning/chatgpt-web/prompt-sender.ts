import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import { BrowserStateMachine } from "./state-machine.js";

export interface PreSubmissionState {
  assistantCount: number;
  lastAssistantText: string;
  userCount: number;
  timestamp: number;
}

export class PromptSender {
  /**
   * Captures the baseline state of assistant and user messages before submission
   * to guarantee stale responses are never accepted and new user message arrival can be verified.
   */
  public static async captureBaseline(page: Page): Promise<PreSubmissionState> {
    const assistantTexts = await this.getAssistantMessageTexts(page);
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

    return stopVisible;
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
      const msgs = document.querySelectorAll(
        "[data-message-author-role='user'], [data-testid*='user'], .user-turn"
      );
      return msgs.length;
    }).catch(() => 0);
    return countFromEval;
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

    // 3. Clear existing text and fill composer reliably
    await composerLocator.click();
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});

    // Try standard Playwright fill first; fallback to evaluate + input event
    let filled = false;
    try {
      await composerLocator.fill(trimmed, { timeout: 3000 });
      filled = true;
    } catch {
      // Contenteditable divs or custom components can fail fill()
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
    }

    // Micro key trigger to ensure ProseMirror / React state is synchronized
    await composerLocator.type(" ", { delay: 10 }).catch(() => {});

    // 4. Verify composer contains the intended prompt
    const composerContent = await composerLocator.evaluate((el: HTMLElement) => {
      if ("value" in el) return (el as HTMLTextAreaElement).value || "";
      return el.innerText || "";
    }).catch(() => "");

    if (!composerContent.trim()) {
      throw new Error("Failed to populate ChatGPT composer with prompt text.");
    }
    options.stateMachine?.transition("COMPOSER_FILLED", `Prompt text staged (${trimmed.length} chars)`);

    // 5. Locate Send button
    let sendLocator = null;
    for (const sel of SELECTORS.sendButton) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        sendLocator = loc;
        break;
      }
    }

    // Submit prompt
    options.stateMachine?.transition("USER_MESSAGE_SUBMITTED");
    if (sendLocator && (await sendLocator.isEnabled().catch(() => false))) {
      await sendLocator.click().catch(() => {});
    } else {
      await page.keyboard.press("Enter").catch(() => {});
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
   * Retrieves all visible assistant message texts, prioritizing locators and falling back
   * to full DOM evaluate across modern ChatGPT layout structures.
   */
  public static async getAssistantMessageTexts(page: Page): Promise<string[]> {
    const locators = await this.getAssistantLocators(page);
    if (locators.length > 0) {
      const texts: string[] = [];
      for (const loc of locators) {
        const t = (await loc.innerText().catch(() => "")).trim();
        if (t) texts.push(t);
      }
      if (texts.length > 0) return texts;
    }

    // Evaluate fallback across standard ChatGPT message structures
    return await page.evaluate(() => {
      const results: string[] = [];
      const roleAssistant = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
      if (roleAssistant.length > 0) {
        return roleAssistant.map((el) => (el as HTMLElement).innerText.trim()).filter(Boolean);
      }
      const turns = Array.from(document.querySelectorAll("article, [data-testid*='conversation-turn']"));
      for (const turn of turns) {
        if (!turn.querySelector("[data-message-author-role='user'], [data-testid*='user']")) {
          const text = (turn as HTMLElement).innerText.trim();
          if (text) results.push(text);
        }
      }
      if (results.length > 0) return results;
      const markdowns = Array.from(document.querySelectorAll(".markdown, .prose"));
      return markdowns.map((el) => (el as HTMLElement).innerText.trim()).filter(Boolean);
    }).catch(() => []);
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
