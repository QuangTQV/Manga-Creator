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

test("Novel Import lets you edit a planned page's prompt before generating", async ({ page }) => {
  // Reaching the "review" stage for real means parsing prose through a live
  // AI provider, which this smoke environment has none of. Seeding the
  // outline directly into IndexedDB — the same store NovelImportDialog
  // restores from on open — reaches the same UI state deterministically,
  // the same way the beforeEach above seeds a fresh project.
  const seeded = await page.evaluate(async () => {
    function readLastProjectId(): Promise<string | undefined> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("manga-studio");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("meta", "readonly");
          const getReq = tx.objectStore("meta").get("lastProjectId");
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result as string | undefined);
          };
          getReq.onerror = () => {
            db.close();
            reject(getReq.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    }

    // Project creation autosaves on a debounce (2.5s) — poll rather than
    // assume it has landed yet.
    const deadline = Date.now() + 8_000;
    let projectId: string | undefined;
    while (Date.now() < deadline) {
      projectId = await readLastProjectId();
      if (projectId) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!projectId) throw new Error("Project was never autosaved");

    const outline = {
      projectId,
      fidelity: "guided",
      panelsPerPage: "auto",
      chapters: [
        {
          title: "Chapter 1",
          characters: [],
          scenes: [],
          pages: [
            {
              id: "planned-page-1",
              chapterTitle: "Chapter 1",
              sceneOrdinal: 0,
              sceneLocation: "a quiet street",
              beats: [],
              panelCount: 1,
              prompt: "Panel 1: Akari stands at the crossing, looking up at the sky.",
            },
          ],
        },
      ],
      pageStates: { "planned-page-1": "planned" },
      generatedPageIds: {},
      savedAt: new Date().toISOString(),
    };

    const outlineDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("manga-studio");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = outlineDb.transaction("novelOutlines", "readwrite");
      tx.objectStore("novelOutlines").put(outline, projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    outlineDb.close();
    return Boolean(projectId);
  });
  expect(seeded).toBe(true);

  await page.getByRole("button", { name: "Novel Import" }).click();
  await expect(page.getByRole("heading", { name: "Novel Import" })).toBeVisible();

  const prompt = page.getByRole("textbox", { name: "Prompt for page 1" });
  await expect(prompt).toHaveValue("Panel 1: Akari stands at the crossing, looking up at the sky.");
  await expect(page.getByRole("button", { name: "Generate this page" })).toBeVisible();

  await prompt.fill("Panel 1: Akari stands at the crossing, then breaks into a run.");
  await expect(prompt).toHaveValue("Panel 1: Akari stands at the crossing, then breaks into a run.");
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

test("the Manga Agent lets you target a page other than the one open in the canvas", async ({ page }) => {
  // The picker only appears once there is a page to switch TO.
  await page.getByRole("button", { name: "Add page" }).click();

  await page.getByRole("button", { name: "Manga Agent" }).click();
  const picker = page.getByRole("combobox", { name: "Target page" });
  await expect(picker).toBeVisible();

  const optionEls = picker.locator("option");
  await expect(optionEls).toHaveCount(2);
  const labels = await optionEls.allTextContents();
  expect(labels.some((label) => label.includes("(open)"))).toBe(true);

  // Pick whichever page ISN'T the one currently open in the canvas.
  const notOpenIndex = labels.findIndex((label) => !label.includes("(open)"));
  const otherValue = await optionEls.nth(notOpenIndex).getAttribute("value");

  // Picking a different page doesn't touch the canvas until Run is pressed.
  await picker.selectOption(otherValue!);
  await expect(picker).toHaveValue(otherValue!);
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
