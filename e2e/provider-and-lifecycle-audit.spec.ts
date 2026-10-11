import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const auditDir = path.resolve(process.cwd(), "artifacts", "ui-audit", "iteration-1");
if (!fs.existsSync(auditDir)) {
  fs.mkdirSync(auditDir, { recursive: true });
}

test.describe("Reasoning Engine Provider & Autonomous Lifecycle UI Audit", () => {
  test("captures provider selection, config drawers, validation, and active execution", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(600);

    // 1. Capture Default Provider State (Local Ollama active)
    const ollamaSelectedShot = path.join(auditDir, "provider-ollama-selected.png");
    await page.screenshot({ path: ollamaSelectedShot, fullPage: true });
    expect(fs.existsSync(ollamaSelectedShot)).toBe(true);

    // 2. Open Reasoning Configuration Drawer (Clicking status pill)
    const statusPill = page.locator("#btn-provider-status");
    await statusPill.click();
    await page.waitForTimeout(400);

    // Capture Ollama Config Tab
    const ollamaDrawerShot = path.join(auditDir, "ollama-config-drawer.png");
    await page.screenshot({ path: ollamaDrawerShot, fullPage: true });
    expect(fs.existsSync(ollamaDrawerShot)).toBe(true);

    // Switch to OpenAI Cloud Tab inside Config Drawer
    const openAiTab = page.locator("button:has-text('☁️ OpenAI API')");
    await openAiTab.click();
    await page.waitForTimeout(400);

    // Capture OpenAI Config Tab
    const openAiDrawerShot = path.join(auditDir, "openai-config-drawer.png");
    await page.screenshot({ path: openAiDrawerShot, fullPage: true });
    expect(fs.existsSync(openAiDrawerShot)).toBe(true);

    // Close config drawer
    await page.locator("button[aria-label='Close configuration']").click();
    await page.waitForTimeout(300);

    // 3. Switch Provider to OpenAI API directly from top bar segmented toggle
    const openAiToggleBtn = page.locator("#btn-provider-openai");
    await openAiToggleBtn.click();
    await page.waitForTimeout(500);

    // If key required prompt opens or drawer opens, capture OpenAI selected state
    const openAiSelectedShot = path.join(auditDir, "provider-openai-selected.png");
    await page.screenshot({ path: openAiSelectedShot, fullPage: true });
    expect(fs.existsSync(openAiSelectedShot)).toBe(true);

    // Close any open drawer with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 4. Open IDE Connection Drawer via Header Agent Button
    const ideAgentBtn = page.locator("#badge-agent");
    await ideAgentBtn.click();
    await page.waitForTimeout(400);

    const ideDrawerShot = path.join(auditDir, "ide-connection-drawer.png");
    await page.screenshot({ path: ideDrawerShot, fullPage: true });
    expect(fs.existsSync(ideDrawerShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 5. Open Artifacts Drawer via Footer
    const artifactsBtn = page.locator("button:has-text('📁 Artifacts')");
    await artifactsBtn.click();
    await page.waitForTimeout(400);

    const artifactsShot = path.join(auditDir, "artifacts-drawer.png");
    await page.screenshot({ path: artifactsShot, fullPage: true });
    expect(fs.existsSync(artifactsShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. Start an Autonomous Run to capture Active Execution state
    const startBtn = page.locator("#btn-start");
    if (await startBtn.isEnabled()) {
      await startBtn.click();
      await page.waitForTimeout(800);

      const activeExecShot = path.join(auditDir, "active-execution.png");
      await page.screenshot({ path: activeExecShot, fullPage: true });
      expect(fs.existsSync(activeExecShot)).toBe(true);

      // Stop the run to cleanly leave state
      const stopBtn = page.locator("#btn-stop");
      if (await stopBtn.isEnabled()) {
        await stopBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });
});
