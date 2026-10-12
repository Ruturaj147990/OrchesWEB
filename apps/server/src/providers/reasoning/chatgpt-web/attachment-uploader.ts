import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { Page } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { SourceManifestRepository } from "../../../storage/repositories/source-manifest-repository.js";
import { SecretRedactor } from "../../../platform/secret-redactor.js";
import type { ImportedDocument } from "../../../domain/blueprints/importer.js";
import { SELECTORS } from "./selectors.js";
import { PromptSender } from "./prompt-sender.js";

export interface DeliveryResult {
  sourceId: string;
  filename: string;
  status: "SENT_IN_MAPPED_CONVERSATION" | "DELIVERY_FAILED" | "UNSUPPORTED" | "NEEDS_USER_ACTION";
  method: "browser_upload" | "chunked_text";
  error?: string;
}

export class AttachmentUploader {
  private repo: SourceManifestRepository;

  constructor(db: DatabaseSync) {
    this.repo = new SourceManifestRepository(db);
  }

  /**
   * Ensures that all user-supplied project attachments and blueprints are inspected,
   * secret-scanned, and delivered into the mapped ChatGPT Web conversation.
   */
  public async ensureSourcesDelivered(
    page: Page,
    projectId: string,
    documents: ImportedDocument[],
    options: { signal?: AbortSignal } = {}
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];

    for (const doc of documents) {
      if (options.signal?.aborted) {
        throw new Error("Source material delivery interrupted by user.");
      }

      // 1. Check if already delivered and unchanged
      const existing = this.repo.findBySha256(projectId, doc.sha256);
      if (existing && existing.deliveryStatus === "SENT_IN_MAPPED_CONVERSATION") {
        results.push({
          sourceId: existing.id,
          filename: existing.originalFilename,
          status: "SENT_IN_MAPPED_CONVERSATION",
          method: existing.deliveryMethod,
        });
        continue;
      }

      // Register or update in source manifest
      const sourceId = doc.id;
      const now = new Date().toISOString();

      this.repo.addItem({
        id: sourceId,
        projectId,
        originalFilename: doc.filename,
        extension: doc.extension,
        byteSize: doc.byteSize,
        sha256: doc.sha256,
        extractionStatus: "EXTRACTED",
        deliveryStatus: "INSPECTING",
        deliveryMethod: "browser_upload",
        redactionCompleted: true,
        sanitizedPath: null,
        supersededById: null,
        errorMessage: null,
        createdAt: doc.importedAt || now,
        updatedAt: now,
        deliveredAt: null,
      });

      // 2. Secret Redaction on attachment content
      const redactedText = SecretRedactor.redactString(doc.extractedText);
      const hadSecrets = redactedText !== doc.extractedText;

      let tempFilePath: string | null = null;
      try {
        // Create sanitized temporary file for delivery
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orches-sanitize-"));
        tempFilePath = path.join(tempDir, doc.filename);
        fs.writeFileSync(tempFilePath, redactedText, "utf8");

        this.repo.updateStatus(sourceId, {
          deliveryStatus: "READY_TO_DELIVER",
          redactionCompleted: true,
          sanitizedPath: tempFilePath,
        });

        // 3. Attempt direct UI attachment
        let directUploadSuccess = false;
        try {
          directUploadSuccess = await this.uploadViaFileInput(page, tempFilePath, doc.filename);
        } catch (err) {
          console.warn(`[AttachmentUploader] Direct UI upload failed for ${doc.filename}: ${(err as Error).message}`);
        }

        if (directUploadSuccess) {
          this.repo.updateStatus(sourceId, {
            deliveryStatus: "SENT_IN_MAPPED_CONVERSATION",
            deliveryMethod: "browser_upload",
            deliveredAt: new Date().toISOString(),
          });
          results.push({
            sourceId,
            filename: doc.filename,
            status: "SENT_IN_MAPPED_CONVERSATION",
            method: "browser_upload",
          });
        } else {
          // 4. Faithful fallback: Chunked text delivery
          console.log(`[AttachmentUploader] Delivering ${doc.filename} via structured text chunks.`);
          const chunkSuccess = await this.deliverAsChunkedText(page, doc, redactedText);

          if (chunkSuccess) {
            this.repo.updateStatus(sourceId, {
              deliveryStatus: "SENT_IN_MAPPED_CONVERSATION",
              deliveryMethod: "chunked_text",
              deliveredAt: new Date().toISOString(),
            });
            results.push({
              sourceId,
              filename: doc.filename,
              status: "SENT_IN_MAPPED_CONVERSATION",
              method: "chunked_text",
            });
          } else {
            this.repo.updateStatus(sourceId, {
              deliveryStatus: "DELIVERY_FAILED",
              errorMessage: "Failed to deliver content via UI or chunking",
            });
            results.push({
              sourceId,
              filename: doc.filename,
              status: "DELIVERY_FAILED",
              method: "chunked_text",
              error: "Failed to deliver content via UI or chunking",
            });
          }
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        this.repo.updateStatus(sourceId, {
          deliveryStatus: "DELIVERY_FAILED",
          errorMessage: errorMsg,
        });
        results.push({
          sourceId,
          filename: doc.filename,
          status: "DELIVERY_FAILED",
          method: "browser_upload",
          error: errorMsg,
        });
      } finally {
        // Clean up temporary file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
            const parent = path.dirname(tempFilePath);
            if (fs.existsSync(parent)) fs.rmdirSync(parent);
          } catch {}
        }
      }
    }

    return results;
  }

  private async uploadViaFileInput(page: Page, filePath: string, filename: string): Promise<boolean> {
    for (const sel of SELECTORS.fileInput) {
      const input = page.locator(sel).first();
      const count = await input.count().catch(() => 0);
      if (count > 0) {
        await input.setInputFiles(filePath).catch(() => {});
        // Wait for attachment chip to appear
        const start = Date.now();
        while (Date.now() - start < 8000) {
          for (const chipSel of SELECTORS.attachmentChip) {
            const chipCount = await page.locator(chipSel).count().catch(() => 0);
            if (chipCount > 0) {
              // Send an accompanying note
              await this.submitText(
                page,
                `[ORCHES SOURCE ATTACHMENT: ${filename}]\nPlease inspect the attached source file. Do not start implementation yet.`
              );
              // Wait for ChatGPT to finish acknowledging attachment before proceeding
              await PromptSender.waitForGenerationToFinish(page, 30_000).catch(() => {});
              return true;
            }
          }
          await page.waitForTimeout(500).catch(() => {});
        }
      }
    }
    return false;
  }

  public static chunkContent(
    content: string,
    filename: string,
    chunkSize = 4000
  ): string[] {
    const totalChunks = Math.ceil(content.length / chunkSize) || 1;
    const chunks: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const part = i + 1;
      const slice = content.slice(i * chunkSize, (i + 1) * chunkSize);
      chunks.push(`[SOURCE: ${filename} | PART ${part} OF ${totalChunks}]\n\`\`\`\n${slice}\n\`\`\``);
    }
    return chunks;
  }

  private async deliverAsChunkedText(page: Page, doc: ImportedDocument, content: string): Promise<boolean> {
    const chunks = AttachmentUploader.chunkContent(content, `${doc.id} | ${doc.filename}`, 4000);
    for (const chunkMsg of chunks) {
      // Ensure previous generation has stopped before sending next chunk
      await PromptSender.waitForGenerationToFinish(page, 30_000).catch(() => {});
      await this.submitText(page, chunkMsg);
      // Wait for ChatGPT to finish generating its chunk receipt/acknowledgement
      await PromptSender.waitForGenerationToFinish(page, 30_000).catch(() => {});
      await page.waitForTimeout(1000).catch(() => {});
    }
    return true;
  }

  private async submitText(page: Page, text: string): Promise<void> {
    let composerLocator = null;
    for (const sel of SELECTORS.composer) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        composerLocator = loc;
        break;
      }
    }
    if (!composerLocator) throw new Error("Prompt composer not found.");

    await composerLocator.click();
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
    if (sendLocator && (await sendLocator.isEnabled().catch(() => false))) {
      await sendLocator.click().catch(() => {});
    } else {
      await page.keyboard.press("Enter").catch(() => {});
    }

    await page.waitForTimeout(1500).catch(() => {});
  }
}
