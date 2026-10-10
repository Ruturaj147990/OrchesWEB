import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BrowserVerificationEvidence } from "@orchestrator/shared-types";
import { config } from "../config/env.js";

export interface BrowserCheckOptions {
  url: string;
  taskId: string;
  attemptId: string;
  expectedSelector?: string;
  viewports?: Array<{ name: string; width: number; height: number }>;
}

export class BrowserVerifier {
  private artifactsDir: string;

  constructor(artifactsDir?: string) {
    this.artifactsDir = artifactsDir || path.join(config.dataDir, "artifacts");
    if (!fs.existsSync(this.artifactsDir)) {
      fs.mkdirSync(this.artifactsDir, { recursive: true });
    }
  }

  public async verifyUi(options: BrowserCheckOptions): Promise<BrowserVerificationEvidence[]> {
    const viewports = options.viewports || [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ];

    const results: BrowserVerificationEvidence[] = [];
    const browser = await chromium.launch({ headless: true });

    try {
      for (const vp of viewports) {
        const start = Date.now();
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();

        const consoleErrors: string[] = [];
        const networkFailures: string[] = [];

        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push(msg.text());
          }
        });

        page.on("requestfailed", (req) => {
          networkFailures.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText || "Failed"}`);
        });

        let assertionsPassed = 0;
        let assertionsFailed = 0;

        try {
          const res = await page.goto(options.url, { timeout: 15000, waitUntil: "domcontentloaded" });
          if (res && res.status() >= 200 && res.status() < 400) {
            assertionsPassed += 1; // Route loaded
          } else {
            assertionsFailed += 1;
          }

          if (options.expectedSelector) {
            const el = await page.waitForSelector(options.expectedSelector, { timeout: 5000 });
            if (el) assertionsPassed += 1;
            else assertionsFailed += 1;
          }
        } catch (err: unknown) {
          assertionsFailed += 1;
          consoleErrors.push((err as Error).message);
        }

        // Capture screenshot artifact
        const screenshotFilename = `${options.taskId}_${vp.name}_${Date.now()}.png`;
        const screenshotPath = path.join(this.artifactsDir, screenshotFilename);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const durationMs = Date.now() - start;
        const passed = assertionsFailed === 0 && consoleErrors.length === 0;

        results.push({
          id: `bve-${crypto.randomUUID()}`,
          taskId: options.taskId,
          attemptId: options.attemptId,
          url: options.url,
          viewport: { width: vp.width, height: vp.height },
          assertionsPassed,
          assertionsFailed,
          consoleErrors,
          networkFailures,
          screenshotArtifactId: screenshotFilename,
          durationMs,
          passed,
          timestamp: new Date().toISOString(),
        });

        await context.close();
      }
    } finally {
      await browser.close();
    }

    return results;
  }
}
