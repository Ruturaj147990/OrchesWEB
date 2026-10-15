import type { Page } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { ProjectChatGptRepository } from "../../../storage/repositories/project-chatgpt-repository.js";
import { SourceManifestRepository } from "../../../storage/repositories/source-manifest-repository.js";
import { SELECTORS } from "./selectors.js";
import { PromptSender } from "./prompt-sender.js";

export interface ProjectConversationInfo {
  projectId: string;
  projectName?: string;
}

export class ConversationManager {
  private repo: ProjectChatGptRepository;

  private manifest: SourceManifestRepository;

  constructor(private db: DatabaseSync) {
    this.repo = new ProjectChatGptRepository(db);
    this.manifest = new SourceManifestRepository(db);
  }

  /** Requests that do not belong to a stored project (e.g. the Settings connection test) get no mapping. */
  private projectExists(projectId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId));
  }

  public static extractConversationIdFromUrl(url: string): string | null {
    if (!url) return null;
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  public extractConversationIdFromUrl(url: string): string | null {
    return ConversationManager.extractConversationIdFromUrl(url);
  }

  /**
   * Ensures the browser is navigating and positioned at the dedicated persistent
   * ChatGPT Web conversation mapped to this Orches project.
   */
  public async ensureProjectConversation(
    page: Page,
    project: ProjectConversationInfo,
    options: { signal?: AbortSignal } = {}
  ): Promise<string> {
    const now = new Date().toISOString();
    if (!this.projectExists(project.projectId)) {
      // Not a project (e.g. the Settings connection test): use a fresh, unmapped chat.
      await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!(await this.waitForComposer(page, 30_000))) throw new Error("ChatGPT composer is not ready. Please verify authentication.");
      return page.url();
    }
    const existing = this.repo.getMapping(project.projectId);

    // 1. If an existing mapped conversation URL is stored in SQLite
    // A bare homepage URL (e.g. 'https://chatgpt.com/' or 'https://chatgpt.com') is NEVER valid as a mapped project conversation.
    const isDedicatedConvUrl =
      existing?.conversationUrl &&
      existing.conversationUrl.startsWith("https://chatgpt.com") &&
      Boolean(existing.conversationUrl.match(/\/c\/[a-zA-Z0-9_-]+/));

    if (isDedicatedConvUrl && existing?.conversationUrl) {
      const currentUrl = page.url();
      if (currentUrl !== existing.conversationUrl) {
        console.log(`[ChatGPTWeb] Navigating to mapped project conversation: ${existing.conversationUrl}`);
        try {
          await page.goto(existing.conversationUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        } catch (err) {
          console.warn(`[ChatGPTWeb] Direct navigation to mapped conversation failed: ${(err as Error).message}. Attempting reload.`);
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        }
      }

      // Verify that the conversation loaded and the composer is available
      const composerReady = await this.waitForComposer(page, 15_000);
      if (composerReady) {
        await page.waitForTimeout(1000).catch(() => {});
        this.repo.updateStatus(project.projectId, {
          lastVerifiedAt: now,
          mappingStatus: "active",
          lastError: null,
        });
        return existing.conversationUrl;
      }

      console.warn(`[ChatGPTWeb] Mapped conversation ${existing.conversationUrl} did not load cleanly. Attempting safe recovery.`);
    }

    // 2. No valid dedicated conversation mapping exists, or previous conversation was deleted/unavailable.
    // Create a new dedicated project conversation on chatgpt.com.
    console.log(`[ChatGPTWeb] Creating or establishing dedicated ChatGPT conversation for project: ${project.projectId}`);
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });

    const composerReady = await this.waitForComposer(page, 30_000);
    if (!composerReady) {
      throw new Error("ChatGPT composer is not ready. Please verify authentication.");
    }

    const titleMarker = `[ORCHES PROJECT: ${project.projectName || project.projectId}]`;

    // Sources delivered into a previous conversation are not visible in the new one.
    const reset = this.manifest.markAllUndelivered(project.projectId);
    if (reset > 0) console.log(`[ChatGPTWeb] New project conversation: ${reset} source document(s) will be re-delivered.`);

    // Send initial project marker to establish the conversation with a clean identifiable title
    await this.submitMessage(page, `Initialize reasoning workspace for Orches.\nProject Marker: ${titleMarker}`);

    // Wait boundedly for URL to promote to /c/<conversationId> or find link in sidebar
    let newUrl = page.url();
    let detectedUrl: string | null = null;
    const startWait = Date.now();
    while (Date.now() - startWait < 15_000) {
      if (options.signal?.aborted) throw new Error("Operation cancelled by user.");
      detectedUrl = await ConversationManager.findConversationUrl(page);
      if (detectedUrl) {
        newUrl = detectedUrl;
        break;
      }
      await page.waitForTimeout(1000).catch(() => {});
    }

    // Ensure initialization reply is fully generated so composer is idle and ready for subsequent prompts
    await PromptSender.waitForThreadIdle(page, 120_000, options.signal).catch(() => false);
    await this.waitForComposer(page, 15_000).catch(() => {});

    if (!newUrl.includes("/c/")) {
      console.warn(
        `[ChatGPTWeb] Notice: Dedicated URL did not promote to /c/<id> within 15s; current URL is ${newUrl}. Conversation active in session; will update mapping when URL promotes.`
      );
    } else {
      console.log(`[ChatGPTWeb] Persisting mapped conversation URL for project ${project.projectId}: ${newUrl}`);
      this.repo.saveMapping({
        projectId: project.projectId,
        conversationUrl: newUrl,
        chatTitle: titleMarker,
        mappingStatus: "active",
        createdAt: now,
        lastVerifiedAt: now,
        lastSuccessfulRequestAt: null,
        lastError: null,
      });
    }

    return newUrl;
  }

  /**
   * Discovers the dedicated conversation URL by checking page.url() and inspecting
   * sidebar / navigation links in the ChatGPT DOM.
   */
  public static async findConversationUrl(page: Page): Promise<string | null> {
    const currentUrl = page.url();
    if (currentUrl.includes("/c/")) return currentUrl;

    // Only the sidebar link marked as the CURRENT page identifies this conversation. Taking the first
    // /c/ link would map the project onto an unrelated chat of the user's.
    const navUrl = await page.evaluate(() => {
      const activeLink = document.querySelector("nav a[href*='/c/'][aria-current='page'], nav a[href*='/c/'][aria-current='true']");
      if (activeLink) {
        const href = activeLink.getAttribute("href");
        if (href && href.includes("/c/")) {
          return href.startsWith("http") ? href : `https://chatgpt.com${href}`;
        }
      }
      return null;
    }).catch(() => null);

    return navUrl;
  }

  /**
   * Records a successful request in the mapped project conversation.
   * Strictly ignores bare homepage URLs to prevent corrupting project conversation mappings.
   */
  public recordSuccess(projectId: string, conversationUrl?: string): void {
    if (!this.projectExists(projectId)) return;
    const now = new Date().toISOString();
    const isDedicated = Boolean(conversationUrl && conversationUrl.includes("/c/"));
    this.repo.updateStatus(projectId, {
      lastSuccessfulRequestAt: now,
      lastVerifiedAt: now,
      ...(isDedicated ? { conversationUrl } : {}),
      mappingStatus: "active",
      lastError: null,
    });
  }

  /**
   * Records an error in the mapped project conversation.
   */
  public recordError(projectId: string, error: string): void {
    if (!this.projectExists(projectId)) return;
    this.repo.updateStatus(projectId, {
      lastError: error,
      mappingStatus: "error",
    });
  }

  public getMapping(projectId: string) {
    return this.repo.getMapping(projectId);
  }

  private async waitForComposer(page: Page, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const sel of SELECTORS.composer) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const visible = await page.locator(sel).first().isVisible().catch(() => false);
          if (visible) return true;
        }
      }
      await page.waitForTimeout(500).catch(() => {});
    }
    return false;
  }

  private async submitMessage(page: Page, text: string): Promise<void> {
    let composerLocator = null;
    for (const sel of SELECTORS.composer) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        composerLocator = loc;
        break;
      }
    }
    if (!composerLocator) throw new Error("Could not find prompt composer.");

    await composerLocator.click();
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});

    try {
      await page.evaluate((val) => {
        return navigator.clipboard.writeText(val);
      }, text);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(300);
    } catch {
      await composerLocator.fill(text).catch(() => {});
    }

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

    // Brief stabilization pause
    await page.waitForTimeout(3000).catch(() => {});
  }
}
