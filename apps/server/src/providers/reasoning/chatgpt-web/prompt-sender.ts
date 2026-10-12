import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";

export interface PreSubmissionState {
  assistantCount: number;
  lastAssistantText: string;
  timestamp: number;
}

export class PromptSender {
  /**
   * Captures the baseline state of assistant messages before submission
   * to guarantee stale responses are never accepted.
   */
  public static async captureBaseline(page: Page): Promise<PreSubmissionState> {
    const locators = await this.getAssistantLocators(page);
    const assistantCount = locators.length;
    let lastAssistantText = "";

    if (assistantCount > 0) {
      lastAssistantText = (await locators[assistantCount - 1].innerText().catch(() => "")).trim();
    }

    return {
      assistantCount,
      lastAssistantText,
      timestamp: Date.now(),
    };
  }

  /**
   * Checks whether ChatGPT is currently in the middle of generating a response.
   * Prevents duplicate prompt submissions.
   */
  public static async isGenerating(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.stopButton) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        if (visible) return true;
      }
    }
    return false;
  }

  /**
   * Submits a prompt into ChatGPT Web.
   */
  public static async submitPrompt(
    page: Page,
    promptText: string,
    baseline: PreSubmissionState,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<void> {
    if (options.signal?.aborted) throw new Error("Submission cancelled by user.");

    // Prevent duplicate prompt submission if already generating
    const alreadyGenerating = await this.isGenerating(page);
    if (alreadyGenerating) {
      console.warn("[PromptSender] ChatGPT is already generating. Waiting for current generation to finish.");
      await this.waitForGenerationToFinish(page, 60_000, options.signal);
    }

    // Locate composer
    let composerLocator = null;
    for (const sel of SELECTORS.composer) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        composerLocator = loc;
        break;
      }
    }
    if (!composerLocator) throw new Error("Prompt composer not found on ChatGPT page.");

    await composerLocator.click();
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});

    // Fill via evaluate + input event for fast, reliable paste of large engineering briefs
    await page.evaluate(
      ({ selector, val }) => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
          if ("value" in el) (el as HTMLTextAreaElement).value = val;
          else el.innerText = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { selector: SELECTORS.composer[0], val: promptText }
    );
    // Add small space trigger to ensure React state synchronizes
    await composerLocator.type(" ", { delay: 10 }).catch(() => {});

    // Click Send
    let sendLocator = null;
    for (const sel of SELECTORS.sendButton) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        sendLocator = loc;
        break;
      }
    }

    if (sendLocator && (await sendLocator.isEnabled().catch(() => false))) {
      await sendLocator.click().catch(() => {});
    } else {
      await page.keyboard.press("Enter").catch(() => {});
    }

    // Confirm that generation started (either Stop button appears, composer clears, or timeout)
    const started = await this.confirmSubmissionStarted(page, baseline, 15_000);
    if (!started) {
      console.warn("[PromptSender] Did not detect generation start immediately; inspecting page.");
    }
  }

  private static async confirmSubmissionStarted(
    page: Page,
    baseline: PreSubmissionState,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isGenerating(page)) return true;
      const currentLocators = await this.getAssistantLocators(page);
      if (currentLocators.length > baseline.assistantCount) return true;
      await page.waitForTimeout(500).catch(() => {});
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
