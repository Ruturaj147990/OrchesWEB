import type { Page } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { ProjectChatGptRepository } from "../../../storage/repositories/project-chatgpt-repository.js";
import { SELECTORS } from "./selectors.js";

export interface ProjectConversationInfo {
  projectId: string;
  projectName?: string;
}

export class ConversationManager {
  private repo: ProjectChatGptRepository;

  constructor(db: DatabaseSync) {
    this.repo = new ProjectChatGptRepository(db);
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
    const existing = this.repo.getMapping(project.projectId);
    const now = new Date().toISOString();

    // 1. If an existing mapped conversation URL is stored in SQLite
    if (existing?.conversationUrl && existing.conversationUrl.startsWith("https://chatgpt.com")) {
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
        this.repo.updateStatus(project.projectId, {
          lastVerifiedAt: now,
          mappingStatus: "active",
          lastError: null,
        });
        return existing.conversationUrl;
      }

      console.warn(`[ChatGPTWeb] Mapped conversation ${existing.conversationUrl} did not load cleanly. Attempting safe recovery.`);
    }

    // 2. No valid mapping exists, or previous conversation was deleted/unavailable.
    // Create a new dedicated project conversation on chatgpt.com.
    console.log(`[ChatGPTWeb] Creating or establishing dedicated ChatGPT conversation for project: ${project.projectId}`);
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });

    const composerReady = await this.waitForComposer(page, 30_000);
    if (!composerReady) {
      throw new Error("ChatGPT composer is not ready. Please verify authentication.");
    }

    const titleMarker = `[ORCHES PROJECT: ${project.projectName || project.projectId}]`;

    // Send initial project marker to establish the conversation with a clean identifiable title
    await this.submitMessage(page, `Initialize reasoning workspace for Orches.\nProject Marker: ${titleMarker}`);

    // Wait for URL to update from / to /c/<conversationId>
    let newUrl = page.url();
    const startWait = Date.now();
    while (Date.now() - startWait < 20_000) {
      if (options.signal?.aborted) throw new Error("Operation cancelled by user.");
      newUrl = page.url();
      if (newUrl.includes("/c/")) {
        break;
      }
      await page.waitForTimeout(1000).catch(() => {});
    }

    const mappedUrl = newUrl.includes("/c/") ? newUrl : "https://chatgpt.com/";
    console.log(`[ChatGPTWeb] Persisting mapped conversation URL for project ${project.projectId}: ${mappedUrl}`);

    this.repo.saveMapping({
      projectId: project.projectId,
      conversationUrl: mappedUrl,
      chatTitle: titleMarker,
      mappingStatus: "active",
      createdAt: now,
      lastVerifiedAt: now,
      lastSuccessfulRequestAt: null,
      lastError: null,
    });

    return mappedUrl;
  }

  /**
   * Records a successful request in the mapped project conversation.
   */
  public recordSuccess(projectId: string, conversationUrl?: string): void {
    const now = new Date().toISOString();
    this.repo.updateStatus(projectId, {
      lastSuccessfulRequestAt: now,
      lastVerifiedAt: now,
      ...(conversationUrl ? { conversationUrl } : {}),
      mappingStatus: "active",
      lastError: null,
    });
  }

  /**
   * Records an error in the mapped project conversation.
   */
  public recordError(projectId: string, error: string): void {
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
    await page.evaluate(
      ({ selector, val }) => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
          if ("value" in el) (el as HTMLTextAreaElement).value = val;
          else el.innerText = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { selector: SELECTORS.composer[0], val: text }
    );
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
    if (sendLocator) {
      await sendLocator.click().catch(() => {});
    } else {
      await page.keyboard.press("Enter").catch(() => {});
    }

    // Brief stabilization pause
    await page.waitForTimeout(3000).catch(() => {});
  }
}
