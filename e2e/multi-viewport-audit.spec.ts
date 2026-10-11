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

test.describe("Multi-Viewport Responsive and Contextual Drawer UI Audit", () => {
  test("captures all 4 viewports: desktop, laptop, tablet, mobile", async ({ browser }) => {
    const viewports = [
      { name: "dashboard-desktop.png", width: 1440, height: 900 },
      { name: "dashboard-laptop.png", width: 1280, height: 720 },
      { name: "dashboard-tablet.png", width: 1024, height: 768 },
      { name: "dashboard-mobile.png", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();
      await page.goto("/");
      await page.waitForTimeout(600);

      await saveScreenshot(page, vp.name);
      await context.close();
    }
  });

  test("captures contextual drawers and modal overlays", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(500);

    // 1. Settings Drawer
    await page.locator("button:has-text('⚙️ Settings')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "settings-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 2. Git & Diff Drawer
    await page.locator("button:has-text('🌿 Git & Diff')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "git-diff-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 3. Diagnostics Drawer
    await page.locator("button:has-text('🩺 Diagnostics')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "diagnostics-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 4. Policies Drawer
    await page.locator("button:has-text('🛡️ Policies')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "policies-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 5. History Drawer
    await page.locator("button:has-text('📜 History')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "history-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. Project Wizard Modal
    await page.locator("button:has-text('+ Add')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "new-project-wizard.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 7. Task Inspector Modal
    await page.locator("#btn-inspect-task").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "task-inspector-modal.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 8. Export Modal
    await page.locator("button:has-text('📦 Export')").click();
    await page.waitForTimeout(400);
    await saveScreenshot(page, "export-modal.png");
    await page.keyboard.press("Escape");
  });
});
