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

test("History lets you jump several steps at once, not just one Undo at a time", async ({ page }) => {
  const pageButtons = page.getByRole("button", { name: /^\d+$/ });
  await expect(pageButtons).toHaveCount(1); // a fresh project starts with one page

  const history = page.getByRole("button", { name: "History" });
  await expect(history).toBeDisabled(); // nothing to jump to yet

  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(pageButtons).toHaveCount(3);
  await expect(history).toBeEnabled();

  await history.click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

  const rows = page.getByRole("list", { name: "History entries" }).getByRole("button");
  await expect(rows).toHaveCount(3);
  // Most recent first: the current position is on top and marked as such.
  await expect(rows.first()).toContainText("Add page");
  await expect(rows.first()).toContainText("Current");
  await expect(rows.first()).toBeDisabled();

  // Jump straight back to the very first state — two steps in one click,
  // not two separate Undo clicks.
  await rows.last().click();
  await expect(page.getByRole("heading", { name: "History" })).not.toBeVisible();
  await expect(pageButtons).toHaveCount(1);

  // The jumped-past steps are still reachable — Redo, not gone.
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
});

test("the project's dialogue language can be set and shows up as a real, undoable edit", async ({ page }) => {
  // The `list` attribute (native suggestion dropdown) changes this input's
  // exposed accessibility role from "textbox" to "combobox" in Chromium —
  // it's still a plain free-text field otherwise.
  const language = page.getByRole("combobox", { name: "Language" });
  await expect(language).toHaveValue("");

  // Free text is still the source of truth, but common languages are one
  // click away via the field's native suggestion dropdown.
  await expect(language).toHaveAttribute("list", "dialogue-language-options");
  const presetValues = await page.locator("#dialogue-language-options option").evaluateAll((options) => options.map((o) => o.getAttribute("value")));
  expect(presetValues).toEqual(expect.arrayContaining(["English", "Vietnamese", "Japanese"]));

  await language.fill("Vietnamese");
  await language.blur();
  await expect(language).toHaveValue("Vietnamese"); // committed, not reverted

  await page.getByRole("button", { name: "History" }).click();
  const rows = page.getByRole("list", { name: "History entries" }).getByRole("button");
  await expect(rows.first()).toContainText("Set dialogue language");
  await expect(rows.first()).toContainText("Current");
  await page.getByRole("button", { name: "Close History" }).click();

  // Clearing it back to blank is the "match my own prompt's language" state.
  await language.fill("");
  await language.blur();
  await expect(language).toHaveValue("");
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

  await page.getByRole("textbox", { name: "New project name" }).fill("Renamed Project");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Renamed Project").first()).toBeVisible();
  // A native window.prompt()/confirm() would show up here as a "dialog"
  // event Playwright must auto-dismiss or the test hangs — none fired.
  expect(dialogs).toEqual([]);
});

test("exporting a webtoon strip captures the real canvas and downloads a PNG", async ({ page }) => {
  // A real end-to-end exercise of the whole pipeline — page capture off the
  // live Konva stage, image decode, canvas stitching, toBlob — none of
  // which a jsdom-based vitest run can actually do.
  // The Konva stage (and so `Konva.stages`, which capture reads from) only
  // exists once the canvas has actually mounted and painted — not
  // guaranteed yet immediately after project creation.
  await expect(page.locator("canvas").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Export" }).selectOption("webtoon-1");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-webtoon@1x\.png$/);
});

test("dragging a page in the Pages bar reorders it, by identity not just position", async ({ page }) => {
  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("button", { name: "Add page" }).click();

  // Page NAMES are assigned once at creation and never renamed by a
  // reorder — a stable way to tell pages apart even though every slot's
  // visible NUMBER is just its current position (1, 2, 3 either way).
  const pageOrder = () => page.locator("footer button[title^='Page ']").evaluateAll((els) => els.map((el) => el.getAttribute("title")));
  await expect.poll(pageOrder).toEqual(["Page 1 — drag to reorder", "Page 2 — drag to reorder", "Page 3 — drag to reorder"]);

  await page.locator("footer button[title^='Page 1']").dragTo(page.locator("footer button[title^='Page 3']"));

  await expect.poll(pageOrder).toEqual(["Page 2 — drag to reorder", "Page 3 — drag to reorder", "Page 1 — drag to reorder"]);
  // The moved page's visible slot NUMBER follows its new position (3rd).
  await expect(page.locator("footer button[title^='Page 1']")).toHaveText("3");
});

test("bold and italic toggle on a speech bubble and persist through the style patch", async ({ page }) => {
  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByText("Appearance", { exact: true }).click();

  const bold = page.getByRole("button", { name: "Bold" });
  const italic = page.getByRole("button", { name: "Italic" });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await expect(italic).toHaveAttribute("aria-pressed", "false");

  await bold.click();
  await italic.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "true");

  // A real store round-trip, not just local button state: reopening the
  // panel (switch tabs and back) must show the same persisted values.
  await page.getByRole("button", { name: "Position" }).click();
  await page.getByRole("button", { name: "Look" }).click();
  await page.getByText("Appearance", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true");
});

test("a project archive exports and re-imports as a real, independent project", async ({ page }, testInfo) => {
  // Give the project a distinctive name so it's unambiguous in the list
  // after import — "Smoke Test Project" (from beforeEach) would otherwise
  // match the original too.
  await page.getByRole("button", { name: /Smoke Test Project/ }).hover();
  await page.getByRole("button", { name: /Project options for/ }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "New project name" }).fill("Archive Round Trip");
  await page.getByRole("button", { name: "Save" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Export" }).selectOption("archive");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.kumanga\.json$/);
  const savedPath = testInfo.outputPath("archive-round-trip.kumanga.json");
  await download.saveAs(savedPath);

  // The real input is `display:none` (a styled label button triggers it) —
  // setInputFiles works on a hidden file input directly, no picker dialog
  // involved, so there's no visible "Import" element to target here.
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(savedPath);

  // Two distinct list entries with the same name now — the archive's name
  // is kept as-is (not "... copy"), since this is a restore, not a
  // same-session duplicate sitting next to the thing it came from.
  const entries = page.getByRole("button", { name: /^Archive Round Trip/ });
  await expect(entries).toHaveCount(2);
});

test("chapters organize pages into named, exportable sections", async ({ page }) => {
  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("button", { name: "Add page" }).click();

  await page.getByRole("button", { name: "Chapters" }).click();
  await expect(page.getByRole("heading", { name: "Chapters" })).toBeVisible();
  await expect(page.getByText("No chapters yet — Page 1 – Page 3 (3 pages)")).toBeVisible();

  await page.getByRole("combobox", { name: "New chapter start page" }).selectOption({ label: "Page 2" });
  await page.getByPlaceholder("Chapter name").fill("Act Two");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // The boundary split the book: page 1 is now "before the first chapter",
  // pages 2-3 belong to the new chapter.
  await expect(page.getByText("Before the first chapter: Page 1")).toBeVisible();
  await expect(page.getByText("Page 2 – Page 3 (2 pages)")).toBeVisible();

  const chapterName = page.getByRole("textbox", { name: "Chapter name for Act Two" });
  await chapterName.fill("Renamed Chapter");
  await chapterName.blur();
  await expect(page.getByRole("textbox", { name: "Chapter name for Renamed Chapter" })).toHaveValue("Renamed Chapter");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CBZ" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/renamed-chapter\.cbz$/);

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No chapters yet — Page 1 – Page 3 (3 pages)")).toBeVisible();
});

test("splitting and merging a panel round-trips the panel count", async ({ page }) => {
  const panelButtons = page.getByRole("button", { name: /^Panel \d+$/ });
  await expect(panelButtons).toHaveCount(4); // the default four-grid layout

  await page.getByRole("button", { name: "Panel 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Split ↔ side by side" }).click();
  await expect(panelButtons).toHaveCount(5);

  // The split inserted the new panel right after the original, as "Panel 2".
  await page.getByRole("button", { name: "Panel 2", exact: true }).click();
  await page.getByRole("combobox", { name: "Merge with" }).selectOption({ label: "Panel 1" });
  await page.getByRole("button", { name: "Merge", exact: true }).click();

  await expect(panelButtons).toHaveCount(4);
});

test("the Panel button draws a new custom panel and drops straight into reshape mode", async ({ page }) => {
  const panelButtons = page.getByRole("button", { name: /^Panel \d+$/ });
  await expect(panelButtons).toHaveCount(4);

  await page.getByRole("button", { name: "Panel", exact: true }).click();

  // A 5th panel exists, on top of the existing four, and is immediately
  // selected — the Inspector shows its controls without a further click.
  await expect(panelButtons).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeVisible();
  await expect(page.getByText("Split / merge")).toBeVisible();
});

test("blend mode is available and persists on a placed item, not just asset instances", async ({ page }) => {
  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByRole("button", { name: "Position", exact: true }).click();

  const blendMode = page.getByRole("combobox", { name: "Blend mode" });
  await expect(blendMode).toHaveValue("normal");

  await blendMode.selectOption("multiply");
  await expect(blendMode).toHaveValue("multiply");

  // A real store round-trip: switch tabs away and back, same as the
  // bold/italic persistence check.
  await page.getByRole("button", { name: "Look", exact: true }).click();
  await page.getByRole("button", { name: "Position", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Blend mode" })).toHaveValue("multiply");
});

test("Page Overview renders a real thumbnail per page and jumps to the one you click", async ({ page }) => {
  // Real Konva capture, same requirement as the webtoon export test.
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Add page" }).click();

  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Page Overview" })).toBeVisible();

  const thumbnails = page.locator('img[alt^="Page "]');
  await expect(thumbnails).toHaveCount(2);
  // Real page content, not a placeholder: a genuine data URL.
  expect(await thumbnails.first().getAttribute("src")).toMatch(/^data:image\/png;base64,/);

  await thumbnails.nth(1).click();

  await expect(page.getByRole("heading", { name: "Page Overview" })).not.toBeVisible();
  await expect(page.locator('footer button[title^="Page 2"]')).toHaveAttribute("aria-current", "page");
});

test("a custom font uploads and becomes selectable on a bubble", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByText("Appearance", { exact: true }).click();

  const fontSelect = page.getByRole("combobox", { name: "Font" });
  await expect(fontSelect).toHaveValue(""); // "Default (Comic Sans MS)"

  // A minimal fake TTF: the server only checks the sfnt magic bytes (real
  // font parsing happens in the browser, not the upload route) — see
  // storage/fontValidation.ts. Built in-memory; no fixture file needed.
  const fakeTtf = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64)]);
  await page
    .locator('input[type="file"][accept*="ttf"]')
    .setInputFiles({ name: "My Lettering Font.ttf", mimeType: "font/ttf", buffer: fakeTtf });

  // Uploaded, registered, and selected automatically — no error surfaced.
  await expect(page.locator("text=/Font upload failed/")).not.toBeVisible();
  await expect(fontSelect).toHaveValue(/^kumanga-font-/);
  const selectedLabel = await fontSelect.locator("option:checked").textContent();
  expect(selectedLabel).toBe("My Lettering Font");

  // Picking an uploaded font whose bytes aren't a real, parseable font
  // must not crash the app — it just keeps the fallback glyphs on screen.
  expect(pageErrors).toEqual([]);
});

test("print export renders a real page at a DPI-derived size with bleed", async ({ page }) => {
  // Runs the actual canvas pipeline (capture -> Image decode -> the
  // edge-stretching bleed draw in printBleed.ts) in a real browser — the
  // one thing a jsdom-based vitest run can't do (see the webtoon export
  // test above for the same reasoning).
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.getByRole("button", { name: "Print" }).click();
  await expect(page.getByRole("heading", { name: "Print Export" })).toBeVisible();

  // Defaults (6.625in wide, 300dpi, 0.125in bleed) against the project's
  // default 1200x1800px page: scale = 6.625*300/1200 = 1.65625, giving a
  // 1988x2981px page plus a 38px bleed margin (0.125*300, rounded) on
  // every side.
  await expect(page.getByText(/^Output: /)).toHaveText("Output: 2064×3057px (bleed included)");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export current page (PNG)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-print@300dpi\.png$/);
});
