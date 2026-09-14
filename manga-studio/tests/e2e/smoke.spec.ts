import { expect, test } from "@playwright/test";

/**
 * A real browser smoke test — the thing no vitest component test can
 * verify: does the app actually boot in a browser, with no AI provider
 * configured (the README's own claim: "the editor works with no AI key at
 * all"), and can each of the top-level dialogs added this session actually
 * open and close without throwing. Not exhaustive UI coverage; that
 * belongs in the (much faster, much more numerous) vitest suite.
 */

test.beforeEach(async ({ page }) => {
  // IndexedDB persists between tests in the same browser context otherwise
  // (Playwright reuses storage per worker) — a project from a previous run
  // would make "the app boots and shows a fresh project" nondeterministic.
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("manga-studio"));
  await page.reload();
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Smoke Test Project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
});

test("the studio boots with no AI provider configured", async ({ page }) => {
  await expect(page.getByText("Kumanga", { exact: true })).toBeVisible();
  // The default project ships with panels ready to work on, not a blank
  // "create a project" screen — the Generate control being present is
  // proof the whole store/render pipeline actually came up. It's a
  // Dropdown (ARIA role "combobox"), not a plain button.
  await expect(page.getByRole("combobox", { name: "Generate" })).toBeVisible();
});

test("AI Settings opens and closes", async ({ page }) => {
  await page.getByRole("button", { name: "AI Settings" }).click();
  await expect(page.getByRole("heading", { name: "AI Providers" })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "AI Providers" })).not.toBeVisible();
});

test("Live AI opens, shows the empty state, and closes", async ({ page }) => {
  await page.getByRole("button", { name: "Live AI" }).click();
  await expect(page.getByRole("heading", { name: "Live AI" })).toBeVisible();
  await expect(page.getByText("No AI calls yet.")).toBeVisible();
  await page.getByRole("button", { name: "Close Live AI" }).click();
  await expect(page.getByRole("heading", { name: "Live AI" })).not.toBeVisible();
});

test("Novel Import opens with an empty source text field and closes", async ({ page }) => {
  await page.getByRole("button", { name: "Novel Import" }).click();
  await expect(page.getByRole("heading", { name: "Novel Import" })).toBeVisible();
  const parseButton = page.getByRole("button", { name: "Parse into script" });
  await expect(parseButton).toBeDisabled(); // no text pasted yet
  await page.getByRole("button", { name: "Close Novel Import" }).click();
  await expect(page.getByRole("heading", { name: "Novel Import" })).not.toBeVisible();
});

test("AI Settings disables Test Connection until a provider is actually saved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.getByRole("button", { name: "AI Settings" }).click();
  const testButton = page.getByRole("button", { name: "Test Connection" }).first();
  await expect(testButton).toBeDisabled();
  await expect(testButton).toHaveAttribute("title", "Save first, then test");
  expect(errors).toEqual([]);
});

test("renaming a project uses a real dialog, not the browser's native prompt", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => dialogs.push(dialog.type()));

  // The "⋯" button is `display:none` until its parent list item is
  // hovered (group-hover:block) — a display:none element has no
  // accessible role at all, so it must not be queried until AFTER
  // hovering the item that reveals it.
  await page.getByRole("button", { name: /Smoke Test Project/ }).hover();
  await page.getByRole("button", { name: /Project options for/ }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { name: "Rename project" })).toBeVisible();

  await page.getByRole("textbox").fill("Renamed Project");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Renamed Project").first()).toBeVisible();
  // A native window.prompt()/confirm() would show up here as a "dialog"
  // event Playwright must auto-dismiss or the test hangs — none fired.
  expect(dialogs).toEqual([]);
});
