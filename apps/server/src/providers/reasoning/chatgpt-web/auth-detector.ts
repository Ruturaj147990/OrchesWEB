import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";

export type AuthStatus =
  | "authenticated"
  | "login_required"
  | "challenge_required"
  | "loading"
  | "unknown";

export class AuthDetector {
  /**
   * Inspects the page to determine current authentication and readiness state.
   */
  public static async detect(page: Page): Promise<AuthStatus> {
    try {
      const url = page.url();

      if (url.includes("/auth/login") || url.includes("/login")) {
        return "login_required";
      }

      // Check for Cloudflare / Turnstile challenge
      for (const sel of SELECTORS.challenge) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return "challenge_required";
        }
      }

      // Check for prompt composer (definitive sign of authenticated & ready)
      for (const sel of SELECTORS.composer) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return "authenticated";
        }
      }

      // Check for login button
      for (const sel of SELECTORS.loginButton) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return "login_required";
        }
      }

      // Check for user profile or navigation bar
      for (const sel of SELECTORS.userProfile) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return "authenticated";
        }
      }

      return "loading";
    } catch {
      return "unknown";
    }
  }

  /**
   * Waits for the user to complete login or verification in the visible browser.
   * Never asks for credentials in Orches. Fully human-assisted.
   */
  public static async waitForAuth(
    page: Page,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      onStatus?: (status: AuthStatus, message: string) => void;
    } = {}
  ): Promise<boolean> {
    const timeoutMs = options.timeoutMs || 300_000; // 5 minute default
    const startTime = Date.now();
    let lastNotifiedStatus: AuthStatus | null = null;

    while (Date.now() - startTime < timeoutMs) {
      if (options.signal?.aborted) {
        throw new Error("Authentication check cancelled by user.");
      }

      const status = await this.detect(page);

      if (status === "authenticated") {
        options.onStatus?.("authenticated", "ChatGPT is authenticated and ready.");
        return true;
      }

      if (status !== lastNotifiedStatus) {
        lastNotifiedStatus = status;
        if (status === "login_required") {
          options.onStatus?.(
            "login_required",
            "ChatGPT browser session is not authenticated. The browser is open. Please sign in to chatgpt.com. Orches will continue automatically after login."
          );
        } else if (status === "challenge_required") {
          options.onStatus?.(
            "challenge_required",
            "A verification challenge or CAPTCHA was detected in ChatGPT. Please complete it manually in the browser window. Orches will resume automatically."
          );
        }
      }

      await page.waitForTimeout(1500).catch(() => {});
    }

    throw new Error(`ChatGPT authentication was not completed within ${Math.round(timeoutMs / 1000)} seconds.`);
  }
}
