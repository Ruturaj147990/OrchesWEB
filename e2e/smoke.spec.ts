import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test.describe("Orchestrator Control Dashboard Smoke Test", () => {
  test("loads dashboard shell, validates controls and captures baseline screenshot", async ({ page }) => {
    page.on("console", (msg) => console.log("PAGE CONSOLE:", msg.text()));
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

    const response = await page.goto("/");
    console.log("PAGE STATUS:", response?.status());
    console.log("PAGE CONTENT:", (await page.content()).slice(0, 500));

    // 1. Validate Header and Title
    await expect(page.locator(".brand-title")).toHaveText("Autonomous Development Orchestrator");

    // 2. Validate Privacy & Provider Badges
    await expect(page.locator("#badge-reasoning")).toContainText(/Reasoning: (Local|OpenAI)/);
    await expect(page.locator("#badge-agent")).toContainText("Agent: Antigravity");

    // 3. Validate Controls
    const startBtn = page.locator("#btn-start");
    const pauseBtn = page.locator("#btn-pause");
    const stopBtn = page.locator("#btn-stop");

    await expect(startBtn).toBeEnabled();
    await expect(pauseBtn).toBeDisabled(); // Initially disabled before start
    await expect(stopBtn).toBeDisabled();

    // 4. Test Starting Run
    await startBtn.click();
    await expect(startBtn).toBeDisabled();
    await expect(pauseBtn).toBeEnabled();
    await expect(stopBtn).toBeEnabled();

    // 5. Test Event Stream updates
    await expect(page.locator("#event-stream-container")).toContainText("run.started");

    // 6. Capture Baseline Screenshot Artifact
    const artifactsDir = path.resolve(process.cwd(), "artifacts");
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    const screenshotPath = path.join(artifactsDir, "baseline-dashboard.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    expect(fs.existsSync(screenshotPath)).toBe(true);
  });
});
