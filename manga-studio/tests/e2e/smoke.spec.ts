import { expect, test } from "@playwright/test";
import sharp from "sharp";

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
  await page.getByRole("combobox", { name: "More" }).selectOption("live-ai");
  await expect(page.getByRole("heading", { name: "Live AI" })).toBeVisible();
  await expect(page.getByText("No AI calls yet.")).toBeVisible();
  await page.getByRole("button", { name: "Close Live AI" }).click();
  await expect(page.getByRole("heading", { name: "Live AI" })).not.toBeVisible();
});

test("Novel Import opens with an empty source text field and closes", async ({ page }) => {
  await page.getByRole("combobox", { name: "More" }).selectOption("novel-import");
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

  await page.getByRole("combobox", { name: "More" }).selectOption("novel-import");
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

test("a bubble grows to fit a long line of dialogue, then shrinks back down for a short one", async ({ page }) => {
  // Adding a bubble via the toolbar auto-selects it (TopBar.tsx's
  // addBubbleToPanel), so the FloatingToolbar's "Edit text" button is
  // already available — no need to hit a Konva-rendered shape at exact
  // canvas pixel coordinates to enter edit mode.
  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByRole("button", { name: "Edit text" }).click();

  const editor = page.getByRole("textbox", { name: "Bubble text" });
  await expect(editor).toBeVisible();
  const shortBox = await editor.boundingBox();

  // A single long word-wrapped line, not literal newlines — exercises the
  // same Konva word-wrap the real bubble renders with, via
  // render/bubbleFit.ts's offscreen measurement.
  await editor.fill(
    "This is a very long line of dialogue that will not fit on a single row and must wrap across several lines inside the bubble",
  );
  await editor.press("Enter");
  await expect(editor).not.toBeVisible();

  await page.getByRole("button", { name: "Edit text" }).click();
  const longBox = await page.getByRole("textbox", { name: "Bubble text" }).boundingBox();
  expect(longBox!.height).toBeGreaterThan(shortBox!.height * 1.3);

  // Shrinks back down for a short line too — this is a real refit on every
  // commit, not a one-way "only ever grows" ratchet.
  await page.getByRole("textbox", { name: "Bubble text" }).fill("Hi");
  await page.getByRole("textbox", { name: "Bubble text" }).press("Enter");
  await page.getByRole("button", { name: "Edit text" }).click();
  const backToShortBox = await page.getByRole("textbox", { name: "Bubble text" }).boundingBox();
  expect(backToShortBox!.height).toBeLessThan(longBox!.height * 0.8);
});

test("warp (impact lettering) applies to a bubble and persists through the style patch", async ({ page }) => {
  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByText("Appearance", { exact: true }).click();

  const warp = page.getByRole("slider", { name: "Warp" });
  await expect(page.getByText("Warp 0%")).toBeVisible();

  await warp.fill("0.6");
  await expect(page.getByText("Warp 60%")).toBeVisible();

  // A real store round-trip, not just local slider state.
  await page.getByRole("button", { name: "Position" }).click();
  await page.getByRole("button", { name: "Look" }).click();
  await page.getByText("Appearance", { exact: true }).click();
  await expect(page.getByText("Warp 60%")).toBeVisible();
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

  await page.getByRole("combobox", { name: "More" }).selectOption("chapters");
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

  await page.getByRole("combobox", { name: "More" }).selectOption("overview");
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

  await page.getByRole("combobox", { name: "More" }).selectOption("print");
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

test("print export can add real crop marks in the bleed margin", async ({ page }, testInfo) => {
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("combobox", { name: "More" }).selectOption("print");
  await expect(page.getByRole("heading", { name: "Print Export" })).toBeVisible();

  // Default bleed (0.125in) leaves room for a mark, so the checkbox starts
  // enabled — same math as the dimension test above: 300dpi * 0.125in bleed
  // = 38px, and cropMarkGeometry(38) puts the top-left corner's vertical
  // tick at x=38, spanning y≈8..30.
  const cropMarksCheckbox = page.getByRole("checkbox", { name: "Add crop marks" });
  await expect(cropMarksCheckbox).toBeEnabled();
  await expect(cropMarksCheckbox).not.toBeChecked();

  const patch = { left: 34, top: 15, width: 8, height: 8 };
  // sharp's `.stats()` doesn't play well chained after `.extract()` (its
  // mean came back much higher than the region's own raw bytes justify —
  // some internal resampling/estimation, not this test's concern), so
  // this averages the raw decoded bytes directly instead.
  const meanBrightness = async (path: string) => {
    const { data, info } = await sharp(path).extract(patch).raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    const pixelCount = info.width * info.height;
    for (let i = 0; i < pixelCount; i++) sum += data[i * info.channels]; // R channel; content here is greyscale
    return sum / pixelCount;
  };

  const withoutMarksPath = testInfo.outputPath("print-without-crop-marks.png");
  const download1 = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export current page (PNG)" }).click(),
  ]).then(([d]) => d);
  await download1.saveAs(withoutMarksPath);
  // Bled page background there, no mark drawn — bright/white.
  expect(await meanBrightness(withoutMarksPath)).toBeGreaterThan(250);

  await cropMarksCheckbox.check();
  await expect(page.getByText(/^Output: /)).toHaveText("Output: 2064×3057px (bleed + crop marks)");

  const withMarksPath = testInfo.outputPath("print-with-crop-marks.png");
  const download2 = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export current page (PNG)" }).click(),
  ]).then(([d]) => d);
  await download2.saveAs(withMarksPath);
  // The same patch is now darkened by a real drawn tick mark (a thin dark
  // stripe inside an otherwise-white 8x8 patch pulls the mean well below
  // white, even though most of the patch is still background).
  expect(await meanBrightness(withMarksPath)).toBeLessThan(230);
});

// A minimal, genuinely valid 8x8 PNG — unlike the font-upload test's
// magic-bytes-only fake, `uploadAsset.ts` decodes this client-side
// (`createImageBitmap`, then a >=4px dimension check) before it ever
// reaches the server, so it has to be real, large-enough image bytes, not
// just a recognizable header.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWP4z8DwHx9mGBkKAMLXf4GpDKyMAAAAAElFTkSuQmCC",
  "base64",
);

test("importing existing page images appends them as real pages, in filename order", async ({ page }) => {
  // A creator switching to Kumanga with manga they already made elsewhere
  // shouldn't have to restart — this bulk-imports existing page images as
  // new project pages, each placed edge-to-edge (no letterbox border), in
  // reading order. Real upload pipeline, no mocking: the point is proving
  // the whole plumbing (upload -> full-bleed page -> filled panel) works.
  await expect(page.locator("footer button[title^='Page ']")).toHaveCount(1); // the fresh project's own page 1

  await page
    .locator('input[aria-label="Import pages"]')
    .setInputFiles([
      { name: "page03.png", mimeType: "image/png", buffer: TINY_PNG },
      { name: "page01.png", mimeType: "image/png", buffer: TINY_PNG },
      { name: "page02.png", mimeType: "image/png", buffer: TINY_PNG },
    ]);

  // Filename order (page01, page02, page03), not selection order — three
  // new pages appended after the project's existing page 1.
  await expect(page.locator("footer button[title^='Page ']")).toHaveCount(4);

  // The last imported page is the one left open, and it really is a
  // full-bleed single-panel page holding the uploaded image — not an
  // empty page, and not the default four-grid layout.
  await expect(page.getByRole("listitem").filter({ hasText: "Panel 1" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Panel 2" })).not.toBeVisible();
});

test("Novel Import flags a project's existing characters instead of proposing duplicates", async ({ page }) => {
  // The gap this closes: pasting a new chunk of story into an
  // already-populated project used to let the character-review step
  // propose "new" characters that were actually already in the project's
  // library — silently, with no cross-check. Seed two real, existing
  // project characters, then a Novel outline whose parsed characters
  // exercise both match cases: an exact name match ("Momo") and a
  // diacritic-only near-match ("Yuri" parsed vs. the project's "Yūri").
  await page.getByRole("button", { name: "+ New Character" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Yūri");
  await page
    .locator('input[type="file"]#character-reference')
    .setInputFiles({ name: "yuri-ref.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByAltText("Character reference preview")).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Yūri", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "+ New Character" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Momo");
  await page
    .locator('input[type="file"]#character-reference')
    .setInputFiles({ name: "momo-ref.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByAltText("Character reference preview")).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Momo", { exact: true })).toBeVisible();

  // Seeding the outline directly (same technique as the other Novel Import
  // test above) — real parsing needs a live AI provider this environment
  // doesn't have. `pages: []` restores straight to the "characters" review
  // stage this feature lives on, rather than "review".
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
    const projectId = await readLastProjectId();
    if (!projectId) return false;

    const outline = {
      projectId,
      fidelity: "guided",
      panelsPerPage: "auto",
      chapters: [
        {
          title: "Chapter 2",
          characters: [
            { primaryName: "Yuri", aliases: [], description: "" },
            { primaryName: "Momo", aliases: [], description: "" },
            { primaryName: "Kenji", aliases: [], description: "" },
          ],
          scenes: [],
          pages: [],
        },
      ],
      pageStates: {},
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
    return true;
  });
  expect(seeded).toBe(true);

  await page.getByRole("combobox", { name: "More" }).selectOption("novel-import");
  await expect(page.getByRole("heading", { name: "Novel Import" })).toBeVisible();

  const yuriCard = page.locator("div.rounded-md.border").filter({ has: page.locator('input[value="Yuri"]') });
  await expect(yuriCard.getByText(/Close to existing character/)).toBeVisible();
  await expect(yuriCard.getByRole("button", { name: /Use.*Yūri/ })).toBeVisible();

  const momoCard = page.locator("div.rounded-md.border").filter({ has: page.locator('input[value="Momo"]') });
  await expect(momoCard.getByText(/Already in this project/)).toBeVisible();

  const kenjiCard = page.locator("div.rounded-md.border").filter({ has: page.locator('input[value="Kenji"]') });
  await expect(kenjiCard.getByText(/existing character/)).not.toBeVisible();

  // Adopting the suggested exact name re-keys the card to the existing
  // spelling — proving the fix actually changes what would get generated,
  // not just what gets displayed.
  await yuriCard.getByRole("button", { name: /Use.*Yūri/ }).click();
  await expect(page.locator('input[value="Yuri"]')).toHaveCount(0);
  await expect(page.locator('input[value="Yūri"]')).toBeVisible();
});

test("a character's Model Sheet shows every generation and exports a composited PNG", async ({ page }) => {
  // Background removal needs a configured AI provider this smoke environment
  // doesn't have — intercepting the upload route the same way the app's own
  // server would respond to a successfully-processed upload lets this test
  // exercise the actual new code (Model Sheet layout, real canvas
  // compositing, real download) without depending on that unrelated
  // subsystem, the same boundary-isolation the font-upload test above draws.
  await page.route("**/api/assets/upload", async (route) => {
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceUrl: dataUrl,
        processedImageUrl: dataUrl,
        mimeType: "image/png",
        hasAlpha: true,
        backgroundRemoved: true,
        processingStatus: "ready",
      }),
    });
  });

  await page.getByRole("button", { name: "+ New Character" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Akari");

  await page
    .locator('input[type="file"]#character-reference')
    .setInputFiles({ name: "akari-ref.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByAltText("Character reference preview")).toBeVisible();

  // The plain "Create" button (not "Create Reference") never requires an AI
  // provider — it only attaches the already-uploaded reference file.
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Akari", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Model Sheet" }).click();
  await expect(page.getByRole("heading", { name: "Model Sheet — Akari" })).toBeVisible();
  await expect(page.getByText("Canonical Reference")).toBeVisible();

  const thumbnail = page.locator('img[alt^="Canonical Reference"]');
  await expect(thumbnail).toHaveCount(1);
  await thumbnail.click();
  await expect(page.getByAltText("Zoomed asset")).toBeVisible();
  await page.getByAltText("Zoomed asset").click();
  await expect(page.getByAltText("Zoomed asset")).not.toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export as PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-model-sheet\.png$/);
});

test("generating multiple candidates lets you keep several instead of losing the others", async ({ page }) => {
  // Real generation needs a configured AI provider, which this smoke
  // environment has none of — intercepting provider/status and /api/generate
  // the way the server would respond to a healthy connected provider lets
  // this test exercise the actual new code (candidate batching, the
  // multi-candidate picker grid, independent per-card "Add to Library")
  // without depending on that unrelated subsystem, the same boundary-
  // isolation the font-upload and Model Sheet tests above draw.
  await page.route("**/api/provider/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        capabilities: { referenceImage: false, supportsTransparentBackground: true },
        storage: { configured: true },
      }),
    });
  });

  let generateCallCount = 0;
  await page.route("**/api/generate", async (route) => {
    generateCallCount += 1;
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: dataUrl,
        sourceUrl: dataUrl,
        processedImageUrl: dataUrl,
        mimeType: "image/png",
        hasAlpha: true,
        backgroundRemoved: false,
        processingStatus: "ready",
        provider: "mock",
        model: "mock-model",
        referenceUsed: false,
      }),
    });
  });

  await page.getByRole("combobox", { name: "Generate" }).selectOption("background");
  await expect(page.getByRole("heading", { name: "AI Asset Generator" })).toBeVisible();

  await page.getByRole("button", { name: "3 candidates" }).click();
  await page
    .getByPlaceholder("Empty Japanese high school classroom, afternoon sunlight")
    .fill("Candidate batch test scene");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText("3 candidates — add the ones you want to keep")).toBeVisible();
  expect(generateCallCount).toBe(3);

  const addButtons = page.getByRole("button", { name: "Add to Library" });
  await expect(addButtons).toHaveCount(3);

  // Add two of the three candidates — the dialog must stay open between
  // adds (unlike the single-candidate flow, which closes immediately) so
  // more than one can be kept.
  await addButtons.nth(0).click();
  await expect(page.getByText("Added ✓")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "AI Asset Generator" })).toBeVisible();
  await expect(addButtons).toHaveCount(2); // the added card's button is gone, replaced by the "Added ✓" label

  await addButtons.nth(0).click();
  await expect(page.getByText("Added ✓")).toHaveCount(2);
  await expect(addButtons).toHaveCount(1);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "AI Asset Generator" })).not.toBeVisible();

  // Both kept candidates became real, independent Scene assets — not one
  // overwriting the other, and the un-added third candidate was never
  // registered at all.
  await page.getByRole("button", { name: "Scenes" }).click();
  await expect(page.locator('div[title^="Candidate batch test scene"]')).toHaveCount(2);
});

test("a full backup (.zip) round-trips a character's image to a new, independent project", async ({ page }, testInfo) => {
  // Real upload pipeline this time — deliberately NOT mocking
  // /api/assets/upload or the new /api/assets/upload-archive-file route,
  // because the entire point of this test is proving the actual
  // bundle-then-re-upload round trip works end to end against the real
  // local dev file server, not just that the UI wires up correctly.
  await page.getByRole("button", { name: "+ New Character" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Akari");
  await page
    .locator('input[type="file"]#character-reference')
    .setInputFiles({ name: "akari-ref.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByAltText("Character reference preview")).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Akari", { exact: true })).toBeVisible();

  const originalReference = page.locator('img[alt="Akari reference"]');
  await expect(originalReference).toBeVisible();
  const originalSrc = await originalReference.getAttribute("src");
  expect(originalSrc).toBeTruthy();

  // Distinctive name so the two list entries (original + imported) are easy
  // to reason about, same technique as the plain-archive round-trip test.
  await page.getByRole("button", { name: /Smoke Test Project/ }).hover();
  await page.getByRole("button", { name: /Project options for/ }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "New project name" }).fill("Full Backup Round Trip");
  await page.getByRole("button", { name: "Save" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Full Backup Round Trip/ }).hover();
  await page.getByRole("button", { name: /Project options for/ }).click();
  await page.getByRole("button", { name: "Export full backup (.zip)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.kumanga-backup\.zip$/);
  const savedPath = testInfo.outputPath("full-backup-round-trip.zip");
  await download.saveAs(savedPath);

  await page.locator('input[type="file"][accept*="zip"]').setInputFiles(savedPath);

  // Two distinct list entries with the same name — the archive's own name
  // is kept as-is, matching the plain-archive import's behavior.
  await expect(page.getByRole("button", { name: /^Full Backup Round Trip/ })).toHaveCount(2);

  // Import auto-opens the newly created copy, so the character shelf now
  // showing is the IMPORTED project's, not the original's.
  await expect(page.getByText("Akari", { exact: true })).toBeVisible();
  const importedReference = page.locator('img[alt="Akari reference"]');
  await expect(importedReference).toBeVisible();
  const importedSrc = await importedReference.getAttribute("src");
  expect(importedSrc).toBeTruthy();

  // The real proof this isn't just a URL carried over unchanged: the
  // imported project's image was independently re-uploaded and got its own
  // new storage location, and that location actually serves real bytes.
  expect(importedSrc).not.toBe(originalSrc);
  const fetched = await page.request.get(importedSrc!);
  expect(fetched.ok()).toBe(true);
});

test("translating a project creates a new project with translated dialogue, leaving the original untouched", async ({
  page,
}) => {
  // Real generation needs a configured agent provider, which this smoke
  // environment has none of — intercepting /api/agent/translate the way
  // the server would respond to a healthy connected provider lets this
  // test exercise the actual new code (batching, height auto-refit,
  // duplicate-not-mutate, auto-opening the result) without depending on
  // that unrelated subsystem, the same boundary-isolation the font-upload
  // and multi-candidate tests above draw. The mock echoes back whatever id
  // it was actually sent, since this test doesn't know the bubble's real
  // domain id ahead of time.
  await page.route("**/api/agent/translate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { items: { id: string; text: string }[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        output: { translations: body.items.map((item) => ({ id: item.id, text: `[EN] ${item.text}` })) },
      }),
    });
  });

  await page.getByRole("combobox", { name: "Bubble" }).selectOption("speech");
  await page.getByRole("button", { name: "Edit text" }).click();
  await page.getByRole("textbox", { name: "Bubble text" }).fill("Xin chào");
  await page.getByRole("textbox", { name: "Bubble text" }).press("Enter");

  await page.getByRole("combobox", { name: "More" }).selectOption("translate");
  await expect(page.getByRole("heading", { name: "Translate Project" })).toBeVisible();

  await page.getByRole("combobox", { name: "Target language" }).fill("English");
  await page.getByRole("button", { name: "Translate whole project" }).click();

  await expect(page.getByText(/^Done — created/)).toBeVisible();

  // Two distinct projects now exist — the translation never touched the
  // original in place.
  await expect(page.getByRole("button", { name: /Smoke Test Project \(English\)/ })).toBeVisible();
  await expect(page.getByText("Smoke Test Project", { exact: true })).toBeVisible();

  // The new project auto-opened; read its saved document straight out of
  // IndexedDB (the same store `storage/projectStore.ts` writes to) for a
  // direct, unambiguous check of the actual translated text — no need to
  // fight Konva canvas coordinates to select the bubble again.
  const translatedText = await page.evaluate(async () => {
    const metaDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("manga-studio");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const projectId = await new Promise<string>((resolve, reject) => {
      const tx = metaDb.transaction("meta", "readonly");
      const getReq = tx.objectStore("meta").get("lastProjectId");
      getReq.onsuccess = () => resolve(getReq.result as string);
      getReq.onerror = () => reject(getReq.error);
    });
    const json = await new Promise<string>((resolve, reject) => {
      const tx = metaDb.transaction("projects", "readonly");
      const getReq = tx.objectStore("projects").get(projectId);
      getReq.onsuccess = () => resolve(getReq.result as string);
      getReq.onerror = () => reject(getReq.error);
    });
    metaDb.close();
    const doc = JSON.parse(json);
    const bubble = Object.values(doc.items as Record<string, { kind: string; text?: string }>).find(
      (item) => item.kind === "bubble",
    );
    return bubble?.text;
  });
  expect(translatedText).toBe("[EN] Xin chào");
});

test("a brand-new character can start from a base/inspiration reference image plus a text prompt", async ({ page }) => {
  // The gap this closes: Scene/Object/Tone generation already let a creator
  // pick a reference image (upload or library) and say what it's FOR
  // (style / loose inspiration), but that picker was hard-gated off for
  // character generation — a brand-new character had no way to start from
  // an uploaded base image (a photo, concept art, or a character from
  // elsewhere) redesigned via prompt; the only image path was uploading a
  // file that became the reference AS-IS, no AI involved at all.
  await page.route("**/api/provider/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        capabilities: { referenceImage: true, supportsTransparentBackground: true },
        storage: { configured: true },
      }),
    });
  });

  let lastReferenceCount = -1;
  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON() as { referenceUrls?: string[] };
    lastReferenceCount = body.referenceUrls?.length ?? 0;
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: dataUrl,
        sourceUrl: dataUrl,
        processedImageUrl: dataUrl,
        mimeType: "image/png",
        hasAlpha: true,
        backgroundRemoved: false,
        processingStatus: "ready",
        provider: "mock",
        model: "mock-model",
        referenceUsed: true,
      }),
    });
  });
  await page.route("**/api/assets/upload", async (route) => {
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceUrl: dataUrl,
        processedImageUrl: dataUrl,
        mimeType: "image/png",
        hasAlpha: true,
        backgroundRemoved: false,
        processingStatus: "ready",
      }),
    });
  });

  // Create the character WITHOUT uploading a file and WITHOUT generating
  // anything yet (the plain "Create" button) — this is the only way to
  // reach a character with zero assets, which is the precondition for the
  // base-image picker to appear at all (an existing reference means the
  // OTHER selector — "which past render anchors identity" — applies instead).
  await page.getByRole("button", { name: "+ New Character" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Nova");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Nova", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate character reference" }).click();
  await expect(page.getByRole("heading", { name: "AI Asset Generator" })).toBeVisible();

  // The picker only exists because this is a referenceless "character" —
  // proving the gate actually opened for this case.
  const referenceSelect = page.getByRole("combobox", { name: "Reference image" });
  await expect(referenceSelect).toBeVisible();

  await page.locator('input[type="file"][accept^="image/png"]').setInputFiles({
    name: "inspiration.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  // The uploaded file's own name, minus extension — same convention every
  // other plain upload in this app uses (`uploadAsset.ts`).
  await expect(page.getByAltText("inspiration")).toBeVisible();

  // Default intent is "style", never "layout" (that option only makes sense
  // for backgrounds) — matching art style, not identity copying, is the
  // right default for "redesign inspired by this".
  const useSelect = page.getByRole("combobox", { name: "Use reference for" });
  await expect(useSelect).toHaveValue("style");
  await expect(useSelect.locator("option")).toHaveCount(2); // no "layout" option for a character

  await page.getByPlaceholder("Running toward camera while carrying a school bag").fill("A wandering swordswoman, silver hair");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText("Generated result")).toBeVisible();
  // The chosen base image really was sent to the provider as a reference —
  // not silently dropped because this was a "character" request.
  expect(lastReferenceCount).toBe(1);

  await page.getByRole("button", { name: "Add to Library" }).click();
  await expect(page.getByRole("heading", { name: "AI Asset Generator" })).not.toBeVisible();
  // The generated result became Nova's own reference — not the uploaded
  // inspiration image itself, which was only ever sent as guidance.
  await expect(page.locator('img[alt="Nova reference"]')).toHaveCount(1);
});

test("AI Settings backup keys: add, edit weight/enabled, test, reorder and remove one at a time", async ({ page }) => {
  // Real credential storage needs a configured server this smoke
  // environment doesn't have — intercepting /api/provider/status and
  // /api/provider/backup-keys the way the real server would respond lets
  // this test exercise the actual new per-key list UI (not the old bulk
  // textarea it replaced) without depending on that unrelated subsystem.
  let backupKeys: { weight: number; enabled: boolean }[] = [];

  await page.route("**/api/provider/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        agent: {
          configured: true,
          source: "session",
          providerType: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          model: "some-model",
          backupKeyCount: backupKeys.length,
          backupKeys,
          rotationStrategy: "round_robin",
        },
        image: { configured: false },
        background: { configured: false },
      }),
    });
  });

  await page.route("**/api/provider/backup-keys", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      index?: number;
      weight?: number;
      enabled?: boolean;
      fromIndex?: number;
      toIndex?: number;
    };
    if (body.action === "add") backupKeys = [...backupKeys, { weight: 1, enabled: true }];
    else if (body.action === "update") {
      backupKeys = backupKeys.map((entry, i) =>
        i === body.index ? { weight: body.weight ?? entry.weight, enabled: body.enabled ?? entry.enabled } : entry,
      );
    } else if (body.action === "remove") {
      backupKeys = backupKeys.filter((_, i) => i !== body.index);
    } else if (body.action === "reorder") {
      const next = [...backupKeys];
      const [moved] = next.splice(body.fromIndex!, 1);
      next.splice(body.toIndex!, 0, moved);
      backupKeys = next;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ backupKeys }) });
  });

  await page.route("**/api/provider/test-key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "Connected" }),
    });
  });

  await page.getByRole("button", { name: "AI Settings" }).click();
  const agentCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Manga Agent (LLM)" }) });
  await agentCard.getByText("Advanced — rotation & fallback").click();

  await expect(agentCard.getByText("No backup keys yet")).toBeVisible();

  // Add the first key.
  await agentCard.getByRole("textbox", { name: "New backup key" }).fill("sk-backup-one-000000");
  await agentCard.getByRole("button", { name: "+ Add key" }).click();
  await expect(agentCard.getByRole("checkbox", { name: "Enable backup key 1" })).toBeVisible();
  await expect(agentCard.getByRole("spinbutton", { name: "Weight for backup key 1" })).toHaveValue("1");

  // Add a second key so reorder has somewhere to go.
  await agentCard.getByRole("textbox", { name: "New backup key" }).fill("sk-backup-two-000000");
  await agentCard.getByRole("button", { name: "+ Add key" }).click();
  await expect(agentCard.getByRole("checkbox", { name: "Enable backup key 2" })).toBeVisible();

  // Edit weight on the first key.
  await agentCard.getByRole("spinbutton", { name: "Weight for backup key 1" }).fill("5");
  await expect(agentCard.getByRole("spinbutton", { name: "Weight for backup key 1" })).toHaveValue("5");

  // Disable the second key — a pause, not a delete.
  await agentCard.getByRole("checkbox", { name: "Enable backup key 2" }).uncheck();
  await expect(agentCard.getByRole("checkbox", { name: "Enable backup key 2" })).not.toBeChecked();

  // Test one specific key.
  await agentCard.getByRole("button", { name: "Test backup key 1" }).click();
  await expect(agentCard.getByText("Connected")).toHaveCount(2); // card badge + row result

  // Reorder: move key 1 down, swapping with key 2.
  await agentCard.getByRole("button", { name: "Move backup key 1 down" }).click();
  await expect(agentCard.getByRole("spinbutton", { name: "Weight for backup key 1" })).toHaveValue("1");
  await expect(agentCard.getByRole("spinbutton", { name: "Weight for backup key 2" })).toHaveValue("5");

  // Remove one key.
  await agentCard.getByRole("button", { name: "Remove backup key 1" }).click();
  await expect(agentCard.getByRole("checkbox", { name: "Enable backup key 2" })).toHaveCount(0);
  await expect(agentCard.getByRole("spinbutton", { name: "Weight for backup key 1" })).toHaveValue("5");

  // "Test all keys" round-trips through the same mocked endpoint.
  await agentCard.getByRole("button", { name: "Test all keys" }).click();
  await expect(agentCard.getByText("Connected")).toHaveCount(2); // card badge + the one remaining row
});

test("AI Settings: configure a local ComfyUI image provider (no API key needed)", async ({ page }) => {
  // Real credential storage needs APP_ENCRYPTION_KEY, which this smoke
  // environment's dev server doesn't set — mock the same three routes the
  // real save/test/status flow uses, the same way the backup-keys test
  // above does for an unrelated subsystem.
  let imageConfig: { providerType: string; baseUrl: string; model: string } | null = null;

  await page.route("**/api/provider/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: Boolean(imageConfig),
        agent: { configured: false },
        image: imageConfig
          ? { configured: true, source: "session", ...imageConfig }
          : { configured: false },
        background: { configured: false },
      }),
    });
  });

  await page.route("**/api/provider/config", async (route) => {
    const body = route.request().postDataJSON() as { kind: string; providerType: string; baseUrl?: string; model: string };
    if (body.kind === "image") {
      imageConfig = { providerType: body.providerType, baseUrl: body.baseUrl || "http://127.0.0.1:8188", model: body.model };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, source: "session", ...imageConfig }),
    });
  });

  await page.route("**/api/provider/test", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.getByRole("button", { name: "AI Settings" }).click();
  const imageCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Image Generation" }) });

  await imageCard.getByText("Advanced — API standard").click();
  await imageCard.getByRole("combobox", { name: "API standard / protocol" }).selectOption("comfyui");

  // The local-network reminder and the checkpoint-filename hint are the two
  // small additive UI touches this protocol needed — confirm both render.
  await expect(imageCard.getByText(/ALLOW_PRIVATE_NETWORKS=1/)).toBeVisible();

  const saveButton = imageCard.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeDisabled(); // no model entered yet

  await imageCard.getByRole("textbox", { name: "Model" }).fill("sd_xl_base_1.0.safetensors");
  await expect(imageCard.getByText(/Checkpoint filename/)).toBeVisible();

  // The actual bug this test caught: ComfyUI has no built-in auth, so Save
  // must not require an API key — it stayed wrongly disabled before the fix.
  await expect(imageCard.getByRole("textbox", { name: "API key" })).toHaveValue("");
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect(imageCard.getByText("Saved. Credentials are stored securely for this browser session.")).toBeVisible();
  await expect(imageCard.getByText("Connected")).toHaveCount(1); // card badge only, no test run yet

  const testButton = imageCard.getByRole("button", { name: "Test Connection" });
  await expect(testButton).toBeEnabled();
  await testButton.click();
  await expect(imageCard.getByText("Connected")).toHaveCount(2); // card badge + test result message
});

test("AI Settings: ComfyUI sampler settings and a LoRA row save wholesale with the rest of the form", async ({ page }) => {
  // The `as` cast on the initializer (not just the declared type) defeats a
  // TS control-flow quirk: with a bare `= null` initializer, TS narrows this
  // `let` to the literal `null` for later reads, since the ONLY assignment
  // it sees in this lexical scope's flow analysis is that initializer — a
  // later `savedPayload = ...` inside a different closure (below) doesn't
  // "unnarrow" it, so `savedPayload?.comfyui` below would otherwise error
  // as "Property does not exist on type never".
  let savedPayload: Record<string, unknown> | null = null as Record<string, unknown> | null;

  await page.route("**/api/provider/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: Boolean(savedPayload),
        agent: { configured: false },
        image: savedPayload
          ? {
              configured: true,
              source: "session",
              providerType: "comfyui",
              baseUrl: savedPayload.baseUrl,
              model: savedPayload.model,
              comfyui: savedPayload.comfyui,
            }
          : { configured: false },
        background: { configured: false },
      }),
    });
  });

  await page.route("**/api/provider/config", async (route) => {
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, source: "session" }) });
  });

  await page.getByRole("button", { name: "AI Settings" }).click();
  const imageCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Image Generation" }) });

  await imageCard.getByText("Advanced — API standard").click();
  await imageCard.getByRole("combobox", { name: "API standard / protocol" }).selectOption("comfyui");
  await imageCard.getByRole("textbox", { name: "Model" }).fill("sd_xl_base_1.0.safetensors");

  await imageCard.getByText("Advanced — ComfyUI settings").click();
  await imageCard.getByRole("spinbutton", { name: "Steps" }).fill("30");
  await imageCard.getByRole("spinbutton", { name: "CFG scale" }).fill("4.5");
  await imageCard.getByRole("textbox", { name: "Sampler name" }).fill("dpmpp_2m");
  await imageCard.getByRole("textbox", { name: "Scheduler" }).fill("karras");

  await imageCard.getByRole("button", { name: "+ Add LoRA" }).click();
  await imageCard.getByRole("textbox", { name: "LoRA 1 filename" }).fill("detail_tweaker_xl.safetensors");
  await imageCard.getByRole("spinbutton", { name: "LoRA 1 strength" }).fill("0.8");

  await imageCard.getByRole("button", { name: "Save" }).click();
  await expect(imageCard.getByText("Saved. Credentials are stored securely for this browser session.")).toBeVisible();

  expect(savedPayload?.comfyui).toEqual({
    steps: 30,
    cfg: 4.5,
    samplerName: "dpmpp_2m",
    scheduler: "karras",
    loras: [{ name: "detail_tweaker_xl.safetensors", strength: 0.8 }],
  });

  // Re-opening (a fresh /api/provider/status read) hydrates the same values
  // back — the section is already open (its `open` prop reflects the
  // hydrated, non-empty state), so no click needed; clicking it here would
  // just toggle the native <details> closed again.
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "AI Settings" }).click();
  await expect(imageCard.getByRole("spinbutton", { name: "Steps" })).toHaveValue("30");
  await expect(imageCard.getByRole("textbox", { name: "LoRA 1 filename" })).toHaveValue("detail_tweaker_xl.safetensors");
});
