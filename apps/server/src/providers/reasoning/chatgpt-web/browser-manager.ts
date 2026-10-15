import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium, type BrowserContext, type Page } from "playwright";
import { BrowserStateMachine, type BrowserState } from "./state-machine.js";
import { SettingsManager } from "../../../platform/settings-manager.js";
import { AuthDetector, type AuthStatus } from "./auth-detector.js";

export interface BrowserManagerConfig {
  profileDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  executablePath?: string;
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private stateMachine: BrowserStateMachine;
  private context: BrowserContext | null = null;
  private chatGptPage: Page | null = null;
  private profileDir: string;
  private headless: boolean;
  private timeoutMs: number;
  private executablePath?: string;
  /** A launch in progress; concurrent callers share it instead of opening the profile twice. */
  private launching: Promise<Page> | null = null;

  constructor(config: BrowserManagerConfig = {}) {
    this.stateMachine = new BrowserStateMachine();
    const dataDir = SettingsManager.getDataDir();
    this.profileDir = config.profileDir || path.join(dataDir, "browser", "chatgpt");
    this.headless = config.headless ?? false;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.executablePath = config.executablePath;

    // Register process exit cleanup
    const cleanUp = () => {
      this.closeSync();
    };
    process.once("exit", cleanUp);
    process.once("SIGINT", cleanUp);
    process.once("SIGTERM", cleanUp);
  }

  public static resolveUserDataDir(customDir?: string): string {
    if (customDir) {
      return path.isAbsolute(customDir) ? customDir : path.resolve(process.cwd(), customDir);
    }
    const dataDir = SettingsManager.getDataDir();
    return path.join(dataDir, "browser", "chatgpt");
  }

  public static getShared(config?: BrowserManagerConfig): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config);
    } else if (config) {
      BrowserManager.instance.applyConfig(config);
    }
    return BrowserManager.instance;
  }

  /**
   * Settings changes (headless, profile folder, timeout) take effect the next time the browser is
   * launched; an already-open browser keeps running with its current options.
   */
  private applyConfig(config: BrowserManagerConfig): void {
    if (this.context || this.launching) return;
    if (config.profileDir) this.profileDir = config.profileDir;
    if (typeof config.headless === "boolean") this.headless = config.headless;
    if (config.timeoutMs) this.timeoutMs = config.timeoutMs;
    if (config.executablePath) this.executablePath = config.executablePath;
  }

  public getStateMachine(): BrowserStateMachine {
    return this.stateMachine;
  }

  public getState(): BrowserState {
    return this.stateMachine.getState();
  }

  public getProfileDir(): string {
    return this.profileDir;
  }

  /**
   * Ensures the persistent browser context and dedicated ChatGPT page are open and ready.
   */
  public async ensureChatGPTPage(options: { signal?: AbortSignal } = {}): Promise<Page> {
    if (this.context && this.chatGptPage && !this.chatGptPage.isClosed()) {
      return this.chatGptPage;
    }
    if (this.launching) return this.launching;
    this.launching = this.launch(options).finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  /**
   * Launches or reconnects the persistent browser profile.
   */
  public async launch(options: { signal?: AbortSignal } = {}): Promise<Page> {
    if (options.signal?.aborted) throw new Error("Launch cancelled by user.");

    // The browser is still open but the ChatGPT tab was closed: open a new tab in the same context
    // instead of launching the profile a second time (which fails while the profile is in use).
    if (this.context) {
      try {
        const page = await this.context.newPage();
        await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 45_000 });
        this.chatGptPage = page;
        const status = await AuthDetector.detect(page);
        this.stateMachine.transition(status === "authenticated" ? "READY" : "AUTH_REQUIRED");
        return page;
      } catch (err) {
        console.warn(`[ChatGPTWeb] Existing browser context is unusable (${(err as Error).message}); relaunching.`);
        await this.close();
      }
    }

    this.stateMachine.transition("STARTING");
    fs.mkdirSync(this.profileDir, { recursive: true });

    // Detect profile lock if possible
    this.checkProfileLock();

    try {
      console.log(`[ChatGPTWeb] Launching persistent browser profile at: ${this.profileDir} (headless: ${this.headless})`);

      const launchArgs = [
        "--disable-blink-features=AutomationControlled",
        "--no-default-browser-check",
        "--no-first-run",
      ];

      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        viewport: { width: 1280, height: 900 },
        args: launchArgs,
        timeout: this.timeoutMs,
        executablePath: this.executablePath || undefined,
        permissions: ["clipboard-read", "clipboard-write"],
      });

      // Find an existing tab or open a dedicated tab
      const pages = this.context.pages();
      let targetPage: Page | null = null;

      for (const p of pages) {
        if (!p.isClosed() && p.url().includes("chatgpt.com")) {
          targetPage = p;
          break;
        }
      }

      if (!targetPage) {
        targetPage = pages.length > 0 && pages[0].url() === "about:blank"
          ? pages[0]
          : await this.context.newPage();
      }

      this.chatGptPage = targetPage;
      this.stateMachine.transition("CHATGPT_LOADING");

      const currentUrl = targetPage.url();
      if (!currentUrl.includes("chatgpt.com")) {
        console.log("[ChatGPTWeb] Navigating dedicated tab to https://chatgpt.com");
        await targetPage.goto("https://chatgpt.com", {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
      }

      // Check authentication status
      const authStatus = await AuthDetector.detect(targetPage);
      if (authStatus === "authenticated") {
        this.stateMachine.transition("READY");
      } else {
        this.stateMachine.transition("AUTH_REQUIRED", "ChatGPT login required in browser.");
      }

      return targetPage;
    } catch (err) {
      let errorMsg = (err as Error).message;
      if (process.platform === "linux") {
        if (/X server|\$DISPLAY|ozone|wayland/i.test(errorMsg)) {
          errorMsg += " — No graphical session: start Orches from the Ubuntu desktop so the ChatGPT window can open.";
        } else if (/shared librar|libnss|libatk|libgbm|libasound|error while loading/i.test(errorMsg)) {
          errorMsg += " — Chromium is missing system libraries: run 'sudo npx playwright install-deps chromium'.";
        }
        (err as Error).message = errorMsg;
      }
      this.stateMachine.transition("FAILED", errorMsg);
      console.error("[ChatGPTWeb] Failed to launch browser context:", errorMsg);
      throw err;
    }
  }

  /**
   * Ensures the user is authenticated in ChatGPT, prompting the user if manual login is required.
   */
  public async ensureAuthenticated(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
    const page = await this.ensureChatGPTPage(options);
    const initialStatus = await AuthDetector.detect(page);

    if (initialStatus === "authenticated") {
      this.stateMachine.transition("READY");
      return true;
    }

    this.stateMachine.transition("AUTH_REQUIRED");

    const authed = await AuthDetector.waitForAuth(page, {
      timeoutMs: options.timeoutMs || 300_000,
      signal: options.signal,
      onStatus: (st, msg) => {
        if (st === "login_required" || st === "challenge_required") {
          console.log(`[ChatGPTWeb] ${msg}`);
        }
      },
    });

    if (authed) {
      this.stateMachine.transition("READY");
    }
    return authed;
  }

  /**
   * Bounded recovery after a crash, disconnect, or unexpected page navigation error.
   */
  public async recover(options: { signal?: AbortSignal } = {}): Promise<Page> {
    this.stateMachine.transition("RECOVERING");
    console.log("[ChatGPTWeb] Performing bounded browser recovery...");

    try {
      if (this.chatGptPage && !this.chatGptPage.isClosed()) {
        await this.chatGptPage.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        const ready = await AuthDetector.detect(this.chatGptPage);
        if (ready === "authenticated") {
          this.stateMachine.transition("READY");
          return this.chatGptPage;
        }
      }
    } catch {}

    // Hard restart of context
    await this.close();
    return this.launch(options);
  }

  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close().catch(() => {});
      } catch {}
      this.context = null;
      this.chatGptPage = null;
      this.stateMachine.transition("CLOSED");
    }
  }

  private closeSync(): void {
    if (this.context) {
      try {
        this.context.close().catch(() => {});
      } catch {}
      this.context = null;
      this.chatGptPage = null;
    }
  }

  private checkProfileLock(): void {
    const lockFiles = [
      path.join(this.profileDir, "SingletonLock"),
      path.join(this.profileDir, "lockfile"),
    ];
    for (const lf of lockFiles) {
      if (fs.existsSync(lf)) {
        try {
          const stats = fs.statSync(lf);
          const ageMs = Date.now() - stats.mtimeMs;
          // If lock is older than 5 minutes and no active browser instance in this process, remove stale lock
          if (ageMs > 300_000 && !this.context) {
            fs.unlinkSync(lf);
          }
        } catch {}
      }
    }
  }
}
