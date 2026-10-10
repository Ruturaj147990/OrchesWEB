import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const auditDir = path.resolve(process.cwd(), "artifacts", "ui-audit", "iteration-1");
if (!fs.existsSync(auditDir)) {
  fs.mkdirSync(auditDir, { recursive: true });
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

      const shotPath = path.join(auditDir, vp.name);
      await page.screenshot({ path: shotPath, fullPage: true });
      expect(fs.existsSync(shotPath)).toBe(true);
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
    const settingsShot = path.join(auditDir, "settings-drawer.png");
    await page.screenshot({ path: settingsShot, fullPage: true });
    expect(fs.existsSync(settingsShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 2. Git & Diff Drawer
    await page.locator("button:has-text('🌿 Git & Diff')").click();
    await page.waitForTimeout(400);
    const gitShot = path.join(auditDir, "git-diff-drawer.png");
    await page.screenshot({ path: gitShot, fullPage: true });
    expect(fs.existsSync(gitShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 3. Diagnostics Drawer
    await page.locator("button:has-text('🩺 Diagnostics')").click();
    await page.waitForTimeout(400);
    const diagShot = path.join(auditDir, "diagnostics-drawer.png");
    await page.screenshot({ path: diagShot, fullPage: true });
    expect(fs.existsSync(diagShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 4. Policies Drawer
    await page.locator("button:has-text('🛡️ Policies')").click();
    await page.waitForTimeout(400);
    const polShot = path.join(auditDir, "policies-drawer.png");
    await page.screenshot({ path: polShot, fullPage: true });
    expect(fs.existsSync(polShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 5. History Drawer
    await page.locator("button:has-text('📜 History')").click();
    await page.waitForTimeout(400);
    const histShot = path.join(auditDir, "history-drawer.png");
    await page.screenshot({ path: histShot, fullPage: true });
    expect(fs.existsSync(histShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. Project Wizard Modal
    await page.locator("button:has-text('+ Add')").click();
    await page.waitForTimeout(400);
    const wizardShot = path.join(auditDir, "new-project-wizard.png");
    await page.screenshot({ path: wizardShot, fullPage: true });
    expect(fs.existsSync(wizardShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 7. Task Inspector Modal
    await page.locator("#btn-inspect-task").click();
    await page.waitForTimeout(400);
    const taskShot = path.join(auditDir, "task-inspector-modal.png");
    await page.screenshot({ path: taskShot, fullPage: true });
    expect(fs.existsSync(taskShot)).toBe(true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 8. Export Modal
    await page.locator("button:has-text('📦 Export')").click();
    await page.waitForTimeout(400);
    const exportShot = path.join(auditDir, "export-modal.png");
    await page.screenshot({ path: exportShot, fullPage: true });
    expect(fs.existsSync(exportShot)).toBe(true);
    await page.keyboard.press("Escape");
  });
});
