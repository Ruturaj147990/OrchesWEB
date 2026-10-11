import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test.describe("Visible Antigravity IDE Integration E2E", () => {
  test("renders IDE integration deck, steps through connection pipeline, tests probe, and toggles execution modes", async ({ page }) => {
    await page.goto("/");

    // 1. Open the IDE Connection Drawer from the top header status control
    await page.locator("#badge-agent").click();
    await page.waitForTimeout(300);

    const deck = page.locator("#ide-connection-deck");
    await expect(deck.locator("h2:has-text('Antigravity IDE Integration')")).toBeVisible();

    // 2. Validate all 6 stages of the pipeline stepper
    await expect(deck.locator("span:has-text('IDE Detected')")).toBeVisible();
    await expect(deck.locator("span:has-text('Workspace Identified')")).toBeVisible();
    await expect(deck.locator("span:has-text('Connection Established')")).toBeVisible();
    await expect(deck.locator("span:has-text('Workspace Confirmed')")).toBeVisible();
    await expect(deck.locator("span:has-text('Agent Tested')")).toBeVisible();
    await expect(deck.getByText("Ready", { exact: true })).toBeVisible();

    // 3. Validate control buttons
    const detectBtn = deck.locator("button:has-text('Detect IDE')");
    const connectBtn = deck.locator("button:has-text('Connect & Verify')");
    const testBtn = deck.locator("button:has-text('Test Connection')");
    const disconnectBtn = deck.locator("button:has-text('Disconnect')");

    await expect(detectBtn).toBeVisible();
    await expect(connectBtn).toBeVisible();
    await expect(testBtn).toBeVisible();
    await expect(disconnectBtn).toBeVisible();

    // 4. Test Detect IDE click
    await detectBtn.click();
    await page.waitForTimeout(500);

    // 5. Test Connect & Verify click
    await connectBtn.click();
    await page.waitForTimeout(1000);

    // 6. Test Connection Probe click
    await testBtn.click();
    await page.waitForTimeout(1000);

    // 7. Test Mode toggle to Headless CLI and back
    const headlessBtn = page.locator("button:has-text('Headless CLI (agy)')");
    await headlessBtn.click();
    await page.waitForTimeout(500);

    const visibleBtn = page.locator("button:has-text('Visible Antigravity IDE (Native Editor)')");
    await visibleBtn.click();
    await page.waitForTimeout(500);

    // 8. Capture screenshot artifact of the live deck
    const artifactsDir = path.resolve(process.cwd(), "artifacts");
    const finalDir = path.resolve(process.cwd(), "artifacts", "ui-audit", "final");
    if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
    if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

    const screenshotPath = path.join(artifactsDir, "visible-ide-deck.png");
    const finalShotPath = path.join(finalDir, "visible-ide-deck.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.screenshot({ path: finalShotPath, fullPage: true });
    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.existsSync(finalShotPath)).toBe(true);
  });
});
