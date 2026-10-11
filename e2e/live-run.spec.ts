import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real end-to-end runs through the UI: real server, real local model (Ollama), real files.
 * Skipped when no local model server is reachable. Model output varies, so assertions
 * check what the orchestrator guarantees (truthful outcome, files only in the workspace,
 * evidence shown) rather than exact code.
 */
const OLLAMA = process.env.LOCAL_REASONING_BASE_URL || "http://127.0.0.1:11434";
test.describe.configure({ mode: "serial", timeout: 600_000 });

let ollamaUp = false;
test.beforeAll(async () => {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaUp = res.ok;
  } catch {
    ollamaUp = false;
  }
});

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "orches-e2e-live-"));
test.afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

async function addProject(page: import("@playwright/test").Page, folder: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Add (a )?project/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByLabel("Workspace folder").fill(folder);
  await dialog.getByLabel("Create the folder if it does not exist").check();
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog).toBeHidden();
}

test("creates a Node module with tests from an empty folder, verified by the project's own test run", async ({ page }) => {
  test.skip(!ollamaUp, "Ollama is not reachable");
  const folder = path.join(parent, "calc");
  await addProject(page, folder);

  await page.getByRole("textbox", { name: "Task" }).fill(
    "Create a Node.js module math.js exporting add(a, b) and multiply(a, b), with tests in math.test.js using the built-in node:test runner, and a package.json whose test script is \"node --test\"."
  );
  await page.getByRole("button", { name: "Run task" }).click();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result.locator(".badge").first()).toHaveText("Running");
  await expect(result.locator(".badge").first()).not.toHaveText("Running", { timeout: 540_000 });

  const label = await result.locator(".badge").first().textContent();
  console.log(`[live-run] node module task outcome: ${label}`);
  const files = fs.readdirSync(folder);
  if (label === "Verified" || label?.startsWith("Done")) {
    // Accepted: the files exist and the project's own test run passed after the change.
    // ("Done — not fully verified" means tests passed but the reviewer did not fully endorse it.)
    expect(files).toEqual(expect.arrayContaining(["math.js", "package.json"]));
    await expect(result).toContainText("npm test");
    await expect(result).toContainText("passed");
  } else {
    // A rejected run must leave the folder exactly as it was (empty).
    expect(label).toMatch(/Rejected|Failed/);
    expect(files).toEqual([]);
  }
  await expect(page.getByRole("log")).toContainText(/Run started/);
  // Nothing outside the workspace folder was created.
  expect(fs.readdirSync(parent)).toEqual(["calc"]);
});

test("edits an existing file in a Git repository and commits only that change on the current branch", async ({ page }) => {
  test.skip(!ollamaUp, "Ollama is not reachable");
  const folder = path.join(parent, "docs");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "README.md"), "# Docs demo\n\nA tiny project.\n");
  const { execFileSync } = await import("node:child_process");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@example.com");
  git("config", "user.name", "E2E");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  await page.goto("/");
  await page.getByRole("button", { name: "+ Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByLabel("Workspace folder").fill(folder);
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Workspace" })).toContainText("Git · main · clean");

  await page.getByRole("textbox", { name: "Task" }).fill("In README.md add a section titled '## Usage' explaining that the project has no runtime code yet. Keep the existing content.");
  await page.getByRole("button", { name: "Run task" }).click();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result.locator(".badge").first()).not.toHaveText("Running", { timeout: 540_000 });
  const label = await result.locator(".badge").first().textContent();
  console.log(`[live-run] README edit outcome: ${label}; last commit: ${git("log", "-1", "--format=%s")}`);

  expect(git("branch", "--show-current")).toBe("main");
  expect(git("branch", "--list").split("\n")).toHaveLength(1);
  if (label?.startsWith("Done") || label === "Verified") {
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toMatch(/## Usage/);
    expect(git("log", "-1", "--format=%s")).toMatch(/^orches: /);
    expect(git("status", "--porcelain")).toBe("");
  } else {
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toBe("# Docs demo\n\nA tiny project.\n");
    expect(git("log", "--format=%s")).toBe("init");
  }
});
