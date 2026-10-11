import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const auditDir = path.resolve(process.cwd(), "artifacts", "ui-audit", "iteration-1");
const finalDir = path.resolve(process.cwd(), "artifacts", "ui-audit", "final");
if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

async function saveScreenshot(page: any, filename: string) {
  const p1 = path.join(auditDir, filename);
  const p2 = path.join(finalDir, filename);
  await page.screenshot({ path: p1, fullPage: true });
  await page.screenshot({ path: p2, fullPage: true });
  expect(fs.existsSync(p1)).toBe(true);
  expect(fs.existsSync(p2)).toBe(true);
}

test.describe("Reasoning Engine Provider & Autonomous Lifecycle UI Audit", () => {
  test("captures provider selection, config drawers, validation, and active execution", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(600);

    // 1. Capture Default Provider State (Local Ollama active)
    await saveScreenshot(page, "provider-ollama-selected.png");

    // 2. Open Reasoning Configuration Drawer (Clicking status pill)
    const statusPill = page.locator("#btn-provider-status");
    await statusPill.click();
    await page.waitForTimeout(400);

    // Capture Ollama Config Tab
    await saveScreenshot(page, "ollama-config-drawer.png");

    // Switch to OpenAI Cloud Tab inside Config Drawer
    const openAiTab = page.locator("button:has-text('☁️ OpenAI API')");
    await openAiTab.click();
    await page.waitForTimeout(400);

    // Capture OpenAI Config Tab
    await saveScreenshot(page, "openai-config-drawer.png");

    // Close config drawer
    await page.locator("button[aria-label='Close configuration']").click();
    await page.waitForTimeout(300);

    // 3. Switch Provider to OpenAI API directly from top bar segmented toggle
    const openAiToggleBtn = page.locator("#btn-provider-openai");
    await openAiToggleBtn.click();
    await page.waitForTimeout(500);

    // If key required prompt opens or drawer opens, capture OpenAI selected state
    await saveScreenshot(page, "provider-openai-selected.png");

    // Close any open drawer with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 4. Open IDE Connection Drawer via Header Agent Button
    const ideAgentBtn = page.locator("#badge-agent");
    await ideAgentBtn.click();
    await page.waitForTimeout(400);

    await saveScreenshot(page, "ide-connection-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 5. Open Artifacts Drawer via Footer
    const artifactsBtn = page.locator("button:has-text('📁 Artifacts')");
    await artifactsBtn.click();
    await page.waitForTimeout(400);

    await saveScreenshot(page, "artifacts-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. Start an Autonomous Run to capture Active Execution state
    const startBtn = page.locator("#btn-start");
    if (await startBtn.isEnabled()) {
      await startBtn.click();
      await page.waitForTimeout(800);

      await saveScreenshot(page, "active-execution.png");

      // Stop the run to cleanly leave state
      const stopBtn = page.locator("#btn-stop");
      if (await stopBtn.isEnabled()) {
        await stopBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });
});
