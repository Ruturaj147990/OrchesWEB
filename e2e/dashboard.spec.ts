import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// UI behaviour that does not need a language model.
test.describe.configure({ mode: "serial" });

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "orches-e2e-ui-"));
const folder = path.join(parent, "demo app");

test.afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

test("first launch guides the user to add a project, and the form validates paths", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Point Orches at a project folder" })).toBeVisible();
  await page.getByRole("button", { name: "Add a project" }).click();

  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByLabel("Workspace folder").fill("relative/path");
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog.getByRole("alert")).toContainText("must be absolute");

  await dialog.getByLabel("Workspace folder").fill(folder);
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog.getByRole("alert")).toContainText("does not exist");

  await dialog.getByLabel("Create the folder if it does not exist").check();
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog).toBeHidden();
  expect(fs.existsSync(folder)).toBe(true);

  await expect(page.getByLabel("Project")).toHaveValue(/proj-/);
  await expect(page.getByRole("region", { name: "Workspace" })).toContainText("Empty folder");
  await expect(page.getByRole("region", { name: "Workspace" })).toContainText(folder);
});

test("Run is disabled until a task is described; dialogs are keyboard accessible", async ({ page }) => {
  await page.goto("/");
  const run = page.getByRole("button", { name: "Run task" });
  await expect(run).toBeDisabled();
  await page.getByRole("textbox", { name: "Task" }).fill("Create README.md describing the project");
  // Enabled only when the reasoning model is reachable; otherwise the reason is shown.
  const reason = page.getByText("Reasoning model not ready");
  if (await reason.isVisible()) {
    await expect(run).toBeDisabled();
  } else {
    await expect(run).toBeEnabled();
  }

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Antigravity Agent");
  await expect(settings).toContainText("Built-in coder");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("selecting OpenAI without a key is refused with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByText("OpenAI API").click();
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(settings.getByRole("alert")).toContainText("Add an OpenAI API key");
  await settings.getByText("Local (Ollama)").click();
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
});

test("the dashboard works at phone width without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Workspace" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
