# MEMORY.md

A running log of what actually happened in this fork and why, for any AI
coding agent (Claude Code, Codex, or a future session of either) picking up
this repo cold. Read `AGENTS.md`/`CLAUDE.md` first for architecture and
rules — this file is history and context, not rules.

**Keep this updated.** After a meaningful piece of work (a new feature, a
real bug fix, a security patch, a non-obvious decision), add one entry under
"Timeline" — a few lines: what, why, and anything a future session would
otherwise have to re-derive from scratch or re-litigate. Don't log routine
edits, typo fixes, or anything already obvious from `git log`. If this file
disagrees with the code, the code wins — fix this file, don't trust it blindly.

Two older docs, `manga-studio/docs/PROJECT_CONTEXT.md` and
`manga-studio/docs/PROJECT_STATE.md`, served this same purpose for the
*upstream* `BotTony329/mangaharness` project before this fork existed. They
stopped being updated on 2026-08-22 and describe pre-fork state (a project
still called "Manga Studio", branches that never merged to this repo's
`main`). Treat them as historical record only — this file is what's current.

## Where this repo came from

This is `QuangTQV/Manga-Creator`, a fork of `BotTony329/mangaharness`
(`git remote -v`: `origin` = this fork, `upstream` = the original). Before
2026-09-14 the working directory held a *different* project entirely
("manga-studio" by ahmet360) that was deleted and replaced with a clone of
`BotTony329/mangaharness` at the user's request — that's why
`docs/v0.3/`-era commit history (2026-08-24 through 2026-09-04) reads as a
mature, differently-styled codebase: it's upstream's own history, inherited
wholesale, not work done in this fork. Everything from 2026-09-14 onward
(`AGENTS.md`/`CLAUDE.md` added) is this fork's own work.

## Timeline (this fork's own work, most recent first)

- **2026-09-15 — Print crop (trim) marks (backlog #26).** Print Export
  (#16) only ever drew synthetic bleed, never marked where the actual
  trim line is. New `export/printCropMarks.ts`: `cropMarkGeometry(bleedPx)`
  sizes the corner tick marks PROPORTIONALLY to the bleed itself
  (gap = 20% of bleed, length = 60%, so gap+length always stays inside
  the bleed band with margin on both ends) rather than a fixed real-world
  length — this guarantees marks always fit at any DPI/bleed combination
  with no extra configuration, and returns `null` (draw nothing) below a
  4px bleed, since there's no room for a mark without touching either
  the trim line or the canvas edge.

  Drawn INSIDE the bleed margin (`drawCropMarks`, a `ctx.stroke()` call on
  the SAME canvas `printBleed.ts`'s edge-stretch already produced — one
  canvas pass, not a second decode/re-encode round trip per page), not
  just outside it the way real print-prep tooling usually would: adding a
  second margin dimension purely for mark placement would have been a
  bigger, riskier change to the export pipeline than this feature is
  worth, and Kumanga's bleed margin is already synthetic/approximate
  (see #16's own docstring) — a mark sitting inside that same band, clear
  of the trim line and the canvas edge, tells a print shop the same thing.

  New "Add crop marks" checkbox in `PrintExportDialog.tsx`, disabled when
  bleed is 0 (nowhere to put a mark) — default UNCHECKED, so print export
  output is byte-identical to before for anyone who doesn't touch it,
  matching how every other addition this session default off/no-change
  (candidate count, warp, …). `PrintExportOptions.cropMarks` threaded
  through both `exportCurrentPagePrintPng` and `exportBookPrintCbz`.

  Verified with unit tests for the pure sizing math, plus a real-browser
  Playwright test that exports the SAME page once without and once with
  crop marks checked, decodes both real downloaded PNGs with `sharp`, and
  confirms a small patch at the exact predicted tick location is bright/
  white without marks and measurably darkened with them — actual pixel
  proof, not just "the export didn't throw." One thing worth remembering
  for next time: `sharp`'s `.stats()` chained after `.extract()` returned
  a mean inconsistent with the region's own raw decoded bytes on this
  version — averaging `.raw()` bytes directly was reliable and is what
  the test actually does; don't trust `.extract().stats()` blindly if
  this comes up again elsewhere.

- **2026-09-15 — Bubble auto-fit height + warp/impact-lettering (backlog
  #24, #25), from a verified (not guessed) audit of remaining
  professional-tool gaps.** Two small, independent typography features
  shipped together.

  **#24 — auto-fit.** `BubbleTextEditor.tsx`'s textarea was always bound
  directly to `bubble.width`/`height` with no growth logic — typing a
  long line just overflowed the bubble until a creator remembered to drag
  it taller by hand. New `render/bubbleFit.ts`'s `fitBubbleHeight` measures
  with a real, offscreen (never attached to a Stage) `Konva.Text` node —
  the only way to get a number that matches what `BubbleNode.tsx` actually
  renders, rather than reimplementing Konva's word-wrap/line-height math
  by hand. Deliberately HEIGHT-only, never width: growing width too on
  every keystroke would keep reshaping non-rectangular silhouettes
  (cloud, spiky, …) rather than just making room for text — a creator who
  wants a wider bubble still resizes that by hand. Wired into
  `CanvasStage.tsx`'s existing `BubbleTextEditor` `onCommit` handler,
  folded into the SAME `update-bubble` dispatch as the text change itself
  (`updateBubble`'s patch type widened to accept `height` alongside
  `text`/`fontSize`/`bubbleType`/`tail`) — two separate dispatches would
  have meant two separate History entries for what reads as one edit.
  Refits on EVERY commit, shrinking back down for a short line too, not a
  one-way "only ever grows" ratchet. Does not cover Agent-set dialogue
  text (a different code path, not wired to this) — a disclosed, deliberate
  scope cut, not an oversight.

  **#25 — warp.** `BubbleStyle.warp?: number` already existed in the
  schema (clamped 0..1 in `normalizeBubbleStyle`, described as
  "Perspective/scale exaggeration for impact lettering") but nothing ever
  read it — a dead field, presumably started and abandoned in an earlier
  session. Wired up as a Konva `skewX`/`scaleX` transform on a `Group`
  wrapping the bubble's text (`BubbleNode.tsx`'s `BubbleText`) — `warp*0.5`
  shear plus `1+warp*0.25` horizontal stretch, pivoting from the text
  box's own center so it warps in place rather than sliding toward a
  corner. `warp <= 0` (the default, and the untouched case for every
  existing bubble/document) renders through the exact same Group wrapper
  but with a fully inert transform, so nothing visually changes for
  anyone who never touches the new control. New "Warp" slider in the
  Inspector's bubble Appearance section, next to Letter spacing. Extracted
  `fontStyleFor` (bold+italic → Konva's space-separated `fontStyle` string)
  out of `BubbleNode.tsx` into `domain/bubbleStyles.ts` so both the
  renderer and the new `bubbleFit.ts` measurement share one implementation
  instead of two copies drifting apart.

  Verified with unit tests (`fontStyleFor`, `warp` clamping/defaults,
  `update-bubble`'s new `height` field) and two real-browser Playwright
  tests: one typing a long word-wrapped line and confirming the bubble
  measurably grows then shrinks back for a short line, one toggling Warp
  and confirming it persists through a tab-switch round trip (same
  pattern the bold/italic test already used) — plus a manual screenshot
  crop confirming the skew is visibly, correctly a slanted "impact"
  look, not a rendering glitch.

- **2026-09-15 — Bulk page import: bring existing manga images in as real
  project pages, in order (backlog #23).** Follow-up to #22 — the user
  asked whether "import an existing manga, then continue it" was
  supported. Scoped through a real back-and-forth before writing code:
  the full ask ("AI learns from the old pages so new ones stay
  consistent") splits into a cheap, safe half (get the old pages INTO the
  project, in order) and an expensive, risky half (AI visually
  understanding those pages) — this ships only the first half, explicitly
  with the user's sign-off after laying out why automatic character
  extraction or OCR-based plot understanding from bitmaps was rejected as
  disproportionate. The existing character-reference upload
  ("Reference Only" character creation) and Art Style custom reference
  upload ALREADY cover "make new generations match old art" once a
  creator manually points them at a crop from an imported page — nothing
  new needed there, this is genuinely just the missing plumbing to get
  the old pages in.

  New `LayoutPresetId` value `"full-bleed"` (`domain/layouts.ts`) — a
  single panel at `{x:0,y:0,width:1,height:1}`, zero margin, unlike
  `single` (which keeps the normal 3% margin so a panel reads as a panel
  on the page). Zero domain risk: `LayoutPresetId` is never persisted on
  `Page` itself, only consumed once at panel-creation time, so this is a
  pure addition with nothing to migrate. It also just shows up in the
  existing "Layout" TopBar dropdown for free (splash pages are a
  legitimate manual use for it too, independent of import).

  New `services/importPages.ts`: `importPagesFromFiles` uploads each
  selected file (category `"upload"` — same category `ReferencePicker`
  already uses for source material that must NOT go through
  background-removal, since a full page is not a character cutout),
  dispatches the EXISTING `add-page`/`add-instance` commands per file
  (`layout: "full-bleed"`, `cropMode: "fill"` so the image covers the
  page edge-to-edge without a letterbox gap) — no new domain command, no
  new mutation path, purely composing what already existed. Sequential,
  not parallel, matching `generatePack`/`captureAllPages`'s existing
  pacing for other multi-step bulk operations. `sortFilesByName` (numeric-
  aware, unit tested) gives deterministic "page01, page02, …" reading
  order regardless of file-picker selection order, which browsers don't
  reliably preserve. Wired into the TopBar "More" menu as
  "Import pages (existing manga images)", reusing that menu's existing
  progress-in-label pattern (`"Page 3/15…"`) the Export dropdown already
  established.

  One real thing worth knowing for later: the canvas camera does NOT
  auto-pan to a newly imported (or newly added, via the ordinary
  "+ Add page" button — same underlying behavior, not something this
  feature changed) page — `defaultPageWorkspacePosition` places each
  page far to the right of the last, and after a bulk import lands the
  creator on the LAST imported page, the canvas can appear to be looking
  at empty black space until "Fit page" is clicked. Confirmed via a real
  screenshot during manual verification; pre-existing behavior, not a
  regression, not fixed here.

  Verified with a unit test for `sortFilesByName` and a real (unmocked)
  Playwright e2e test that imports 3 files out of filename order and
  confirms 4 total pages (project's original + 3 imported) land in the
  right reading order, with the last one genuinely holding a single
  full-bleed panel (not the default four-grid layout, not empty).

- **2026-09-15 — Novel Import cross-checks a project's EXISTING characters,
  not just duplicates within one parse (backlog #22).** Surfaced by the
  user asking "is continuing an existing manga supported yet" — investigated
  end to end (resume a project: yes; chapters: yes; character reuse via the
  Manga Agent/manual placement: yes) and found one real, previously
  undocumented gap: `dedupeCharacters` (`agent/novelParser/characterEdits.ts`)
  only ever merged duplicates WITHIN the characters just parsed from pasted
  text — pasting chapter 2 into a project that already has chapter 1's
  characters got no cross-check at all against `doc.characters`, so a
  differently-spelled or differently-accented repeat of an existing
  character ("Yuri" vs. the project's own "Yūri") could sail through the
  review stage and end up proposed as a fresh duplicate.

  New `matchExistingCharacters` (same file) compares every freshly parsed
  character's name against the project's existing character names —
  case-insensitive AND diacritic-insensitive (`String.normalize("NFKD")` +
  stripping combining marks, not full fuzzy/edit-distance matching:
  edit-distance risks silently merging two GENUINELY different characters,
  a materially worse failure than an occasional missed near-duplicate that
  a human still has to eyeball). `NovelImportDialog.tsx`'s character-review
  cards now show a green "✓ already in this project" note for an exact
  match (the Creative Director's own resolution layer already reuses this
  case silently — Rule 7, "reuse before create" — this just tells the
  creator that's what's about to happen) or an amber "≈ close to existing
  character" note with a one-click "Use existing name" button for a
  diacritic-only near-match, which just calls the SAME
  `applyCharacterRename` the manual rename/merge flow already used — no new
  mutation path.

  Purely additive: no domain model change, no new command, reads
  `doc.characters` (already loaded) and reuses the existing rename/merge
  machinery. Verified with unit tests for the pure matcher (exact,
  diacritic-near-match, no-match, empty-library cases) and a real-browser
  Playwright test that creates two real project characters, seeds a Novel
  outline whose parsed characters exercise both match cases plus a
  genuinely-unrelated name (no badge), and confirms clicking "Use existing
  name" actually re-keys the card to the adopted spelling.

- **2026-09-15 — Full-backup project archive: .zip with bundled image/font
  bytes (backlog #21, from the MangaGen feature audit).** The plain
  archive (`exportProjectArchive.ts`) only ever exported the JSON document
  — every asset URL still points at THIS deployment's own object storage,
  a deliberate scope cut made explicit in that file's own docstring and in
  this file's 2026-09-15 "Project archive import/export" entry when
  archives first shipped. This is that deferred capability, added
  alongside the existing one rather than replacing it.

  New `export/projectBackup.ts`: `exportFullBackup(doc)` walks every
  URL-bearing field across the WHOLE domain model (not just
  `SourceAsset.storageUrl` — also `processedImageUrl`/`thumbnailUrl`/
  `sourceUrl`, a local-edit's `maskUrl`, `FontAsset.storageUrl`,
  `MangaLanguageAsset.thumbnailUrl`, and a custom `StyleProfile`'s
  `previewImage`), `fetch()`s each distinct URL client-side (already
  proven reliable — canvas export already relies on the exact same
  same-origin/CORS-open fetchability), and zips them alongside
  `project.json` (untouched) and a `manifest.json` (old URL → bundled
  path) via JSZip. New `domain/assetUrls.ts` (`collectAssetUrls`,
  `remapAssetUrls`) is the single source of truth for "every URL-bearing
  field" — both export (what to bundle) and import (what to rewrite) read
  from it, so they can't silently drift apart from each other as new
  entity types gain URL fields later.

  Import (`importFullBackupZip`) deliberately runs `deserializeProject`
  on the extracted `project.json` FIRST, before any URL rewriting — that
  means the rewriting code only ever has to understand the CURRENT schema
  shape, never a historical one; full schema migration already happened
  by the time `remapAssetUrls` runs. Each bundled file is re-uploaded
  through a new, minimal route, `api/assets/upload-archive-file/route.ts`
  — modeled directly on `upload-font/route.ts`'s "raw bytes in, URL out,
  zero processing" pattern (tries image magic-byte detection first, then
  font detection, rejects anything else), deliberately NOT the general
  `assets/upload` pipeline, which would wastefully (and wrongly) re-run
  background removal on bytes that are already a finished derivative.

  Refactored `projectsStore.ts`'s `importProject(json)` to extract its
  "commit as a new project" tail into a new `importDocument(doc)` store
  method, shared by both the plain-JSON path (`deserializeProject` then
  `importDocument`) and the new zip path
  (`importFullBackupZip` then `importDocument`) — no duplicated commit
  logic between the two import flows.

  UI: TopBar's Export dropdown label was ALSO wrong before this — it said
  "Export project archive (.json) — full backup" when it was never a full
  backup (fixed to just "Export project archive (.json)"), with a new
  "Export full backup (.zip) — includes images, portable" entry alongside
  it. Same pairing added to each project's "⋯" menu in `ProjectsPanel.tsx`.
  The single Import file input's `accept` widened to take both `.json` and
  `.zip`; which import path runs is decided by file extension, since
  nothing else about the UI flow differs between them.

  One failure mode handled deliberately, not incidentally: any single
  asset that fails to fetch (export) or fails to re-upload (import) is
  just left out of the manifest / left unmapped — the same broken-link
  fallback the plain document-only export already accepted as its
  baseline, not a new way for the whole backup to fail over one bad URL.

  Verified with unit tests for the pure URL walker
  (`assetUrls.test.ts`) and the new route
  (`upload-archive-file/route.test.ts`, mirroring
  `remove-background/route.test.ts`'s mock-`putObject` pattern), plus a
  real, UNMOCKED Playwright e2e test — the strongest integration test in
  this session — that creates a character with a real uploaded reference
  image, exports a real full-backup zip, imports it back through the real
  local dev file server (no AI provider or route mocking involved
  anywhere in this one), and asserts the imported character's image URL
  is both DIFFERENT from the original (proving genuine re-upload, not a
  carried-over reference) and actually serves real bytes.

- **2026-09-15 — Multi-candidate generation (backlog #18, from the
  MangaFlow feature audit).** `GeneratorDialog.tsx`'s `generate()` fires 1
  (default, unchanged) to 4 independent `generateImage()` calls via
  `Promise.allSettled` — no provider adapter batches multiple images in one
  request, confirmed by tracing the full pipeline (`services/generation.ts`
  → `ai/generate.ts` → every `ImageGenerationProvider` adapter) before
  writing any code, so N sequential/parallel single-image calls from the
  client was the only real option, not a smaller "just thread a `count`
  param through" change. New `ai/candidateBatch.ts` (`summarizeCandidateOutcomes`,
  unit tested) turns the settled outcomes into `{succeeded, partialFailureNote,
  allFailed, firstFailureReason}` — one candidate's provider error never
  hides the others that succeeded; only a 100%-failure batch surfaces the
  old single hard-error UI.

  Deliberately did NOT add a "favorite" flag or a batch/grouping id to
  `SourceAsset` (no domain/schema change at all) after checking whether one
  already existed — instead, when more than one candidate was requested,
  each candidate card gets its OWN independent "Add to Library" button;
  clicking one runs the exact same single-asset registration path
  (`registerGeneratedAsset`) that a single-result generation always has,
  marks that card "Added ✓", and leaves the dialog open so more can be kept.
  Un-added candidates are simply never uploaded/registered — no orphaned
  "rejected candidate" rows cluttering the library. When only 1 candidate
  was requested (the default, unchanged path), "Add to Library" still
  registers-and-closes immediately, byte-for-byte the old behavior — nobody
  who never touches the new count selector can tell anything changed.

  `replaceAssetId`/`targetInstanceId` requests (regenerate-one-asset,
  fill-one-instance) force candidate count back to 1 (`singleTargetOnly`)
  rather than trying to solve "which of N replaces the one target" — those
  are inherently single-target operations, a real scope cut, not an
  oversight.

  Verified with a Playwright test that mocks `/api/provider/status` +
  `/api/generate` (same boundary-isolation as the font-upload and Model
  Sheet tests — this doesn't test AI providers, it tests Kumanga's own
  batching/UI code) confirming 3 requested candidates fire 3 calls, adding
  2 of 3 keeps the dialog open and registers exactly 2 independent Scene
  assets, and the third candidate is never persisted.

- **2026-09-15 — TopBar overflow fixed with a "More" menu, after an
  icon-only first attempt was explicitly rejected by the user.** User
  reported (MacBook Pro 14" screenshot, logical width 1512px) that
  reaching Export/AI Settings required scrolling the toolbar sideways —
  a regression that had crept in one button at a time as features were
  added this session (#13 Overview, #16 Print; #14 and #17 added their
  own controls elsewhere, not here). Measured actual overflow with a
  throwaway Playwright script across common widths
  (`header.scrollWidth - clientWidth`) rather than guessing.

  First attempt: converted `Novel Import`, `Live AI`, `AI Settings`, and
  `+ Panel` from icon+text `Button`s to icon-only `IconButton`s
  (`aria-label` kept the same accessible name, so no test rewrites were
  needed for that part) plus assorted spacing trims. This DID eliminate
  the overflow at ≥1440px — but the user pushed back immediately:
  "khó mà biết nó dùng để làm gì" (hard to tell what it's for). Fair:
  several of the newly-bare icons (a book for Novel Import, a wave for
  Live AI, a plain "+") aren't universally self-explanatory the way
  Undo/Redo/History's arrows and clock are, and a tooltip only helps
  someone already hovering.

  Revised fix (the one that shipped): restored `+ Panel` and
  `AI Settings` to icon+text, and instead of converting more buttons to
  icons, moved five lower-frequency actions — Novel Import, Chapters,
  Page Overview, Print Export, Live AI — into ONE clearly-labeled
  "••• More" `Dropdown` (the same native-`<select>`-based component
  `Bubble`/`Effect`/`Layout` already use). Nothing lost its name: opening
  More shows each item's full text label, same as any other dropdown —
  the information the user was missing is one click away instead of
  gone. This DOES require an extra click for those five vs. before, a
  real tradeoff, but the user's stated priority (clarity over maximum
  compactness) settles it. `Art Style`'s `max-w` was given back some
  room too (100px→140px) now that five whole buttons collapsed into one.

  Every e2e test that used to click these five buttons directly now
  does `page.getByRole("combobox", { name: "More" }).selectOption(key)`
  instead (`novel-import` / `chapters` / `overview` / `print` /
  `live-ai`) — six call sites across the Live AI, Novel Import ×2,
  Chapters, and Page Overview tests. `Panel` and `AI Settings` kept
  their original `getByRole("button", ...)` locators since they're back
  to being real buttons.

  Result, same measurement script: **zero overflow at 1440px and
  wider** (including the user's own reported 1512px); ~87px left at
  1366px, ~173px at 1280px. Slightly worse numbers on small screens than
  the icon-only attempt, in exchange for every visible control except
  Undo/Redo/History (always icon-only, always was, never the complaint)
  having a readable label. If TopBar keeps growing, the next lever is
  moving MORE items into the More menu — not converting remaining
  labeled buttons to icons, which is the exact thing that was just
  reverted.

- **2026-09-15 — Character Model Sheet, V1 (backlog #17).** New "Model
  Sheet" button on each `CharacterCard` (`CharactersTab.tsx`), enabled
  whenever a character has a reference or any rendered state (not gated
  to "has pose/expression states" only — a reference-only character
  should still be able to open it). Opens `ModelSheetDialog.tsx`: every
  row is a state (canonical reference first, then one row per distinct
  pose/expression/outfit/view), and — the actual point of this feature —
  shows EVERY generation of that state, not just the latest, in a
  zoomable grid, so a creator can visually judge whether generation #3
  drifted off-design from generation #1 or the reference. "Export as
  PNG" composites the same rows onto one canvas via
  `export/exportModelSheet.ts`, reusing the "stitch images onto one
  canvas" technique already used by `exportWebtoon.ts` — no new
  compositing approach, just a different layout (a labeled grid instead
  of a vertical stack).

  Deliberately scoped down from the full backlog idea per the user's own
  choice after being shown the tradeoff: automatic DRIFT DETECTION
  (flagging when a generation visually diverges, rather than a human
  eyeballing the grid) was explicitly cut — it needs either an AI vision
  call or an image-similarity pipeline, a materially different and
  riskier feature than compositing existing renders, and was not
  attempted here. This ships only the comparison SURFACE.

  Extracted `groupCharacterStates`/`titleCaseWords` out of
  `CharactersTab.tsx` into `characters/state.ts` (now exported,
  `characters/state.ts` already owned `stateFromAsset` and friends) so
  the dialog, the exporter, and the existing "Rendered states" shelf
  share one grouping implementation instead of three copies silently
  drifting apart. No domain model changes — this reads
  `character.assetIds` and existing asset metadata exactly the way the
  shelf already did.

  One real edge case worth knowing: `libraryOps.addAsset` auto-promotes
  a character's very FIRST asset to `referenceAssetId`/
  `canonicalReferenceAssetId` regardless of its own `characterAssetRole`
  — so a character whose first-ever generation was a "state" (not
  generated via the canonical-reference flow) still gets a "Canonical
  Reference" row containing that asset. This is existing domain
  behavior, not something this feature introduced; the Model Sheet just
  surfaces it (see `exportModelSheet.test.ts`'s test for this exact
  case).

  Verified with pure-math unit tests (`computeModelSheetLayout`,
  `modelSheetRows`) plus a real-browser Playwright test that creates a
  character via the "Reference Only" + uploaded-image path (the ONE
  character-creation path that needs no AI provider — the plain
  "Create" button, not "Create Reference", attaches an already-selected
  file unconditionally before the provider-configured gate is even
  checked), intercepting `/api/assets/upload` to skip the unrelated
  background-removal subsystem while still exercising the real
  dialog render, real canvas compositing, and a real PNG download.

- **2026-09-15 — Print-ready export: DPI + synthetic bleed (backlog #16).**
  New `export/exportPrint.ts` (`exportCurrentPagePrintPng`,
  `exportBookPrintCbz`) and `export/printBleed.ts`, wired into a new
  `PrintExportDialog.tsx` (opened from a new "Print" TopBar button).
  Deliberately added ZERO new `ProjectSettings` fields — physical page
  width (inches), target DPI, and bleed (inches) are asked FRESH at
  export time and used only to compute
  `scale = (physicalWidthInches * dpi) / doc.project.settings.pageWidth`,
  fed into the existing `capturePageDataUrl`/`captureAllPages` capture
  pipeline. Rejected persisting them on the project: page pixel
  dimensions have no physical unit today, and per the #13/#14 precedent
  a new persisted field means a schema migration for a value that, once
  set, panels' normalized coordinates would implicitly depend on —
  keeping it export-only avoids that risk entirely, at the cost of
  re-entering the numbers each export (acceptable; they default
  sensibly — 6.625in/300dpi/0.125in bleed — and are remembered for the
  session in the dialog's own state).

  `capturePageDataUrl`/`captureAllPages`'s `scale` parameter was widened
  from the literal union `1 | 2` to `number` — that restriction was only
  ever a UI convenience for the quick-export dropdown (`TopBar.tsx`
  still passes just 1 or 2 there); the underlying math
  (`pixelRatio: scale / stageScale`) already worked for any positive
  scale, so DPI-derived fractional/large scales needed no changes below
  the type signature.

  Bleed is SYNTHETIC, not real: nothing in the domain model lets a
  panel's art actually extend past the page edge (panels are hard-
  clamped to normalized 0..1 page coordinates), so there is nothing to
  "bleed" in the traditional print sense. `printBleed.ts` approximates
  it the standard "poor man's bleed" way instead — after capture, draw
  the page onto a larger canvas and stretch the outermost 1px edge
  strips/corner pixels outward via `ctx.drawImage()` with a mismatched
  source/destination rectangle size, no image-processing library
  needed. This was explicitly flagged to the user as a real
  architectural tradeoff (real bleed would require letting panels
  overhang the page, a much bigger domain change) before implementing —
  user approved proceeding with "whatever is optimal".

  Pure math (`computePrintScale`, `computeBleedPx`) is unit tested;
  the actual canvas drawing isn't (this codebase's vitest environment is
  `"node"`, no real canvas — same reasoning `checkWebtoonCanvasLimit`
  was already split out for). Verified instead by a new Playwright e2e
  test that opens the dialog, checks the live pixel-dimension preview
  matches the DPI math by hand, and exports a real page through the
  actual bleed-drawing code in a real browser.

- **2026-09-15 — Custom font upload for lettering (backlog #14).** New
  `FontAsset` (`domain/types.ts`, schema v14→v15) — deliberately its own
  `doc.fonts` collection, not shoehorned into `SourceAsset` (which is
  heavily image-shaped: dimensions, alpha, background-removal provenance,
  none of it meaningful for a font file). New, ISOLATED upload route
  `app/api/assets/upload-font/route.ts` — NOT reusing `assets/upload`,
  which is deeply image-specific (dimension reading via
  `createImageBitmap`, the whole AI background-removal pipeline); mixing
  the two would mean threading "this might not be an image at all"
  through code that assumes it always is. Same untrusted-input discipline
  as the image route: a font's actual TYPE is decided by its own magic
  bytes (`storage/fontValidation.ts`'s `detectFontType`, unit tested —
  TTF/OTF/WOFF/WOFF2 signatures), never a filename or client-claimed MIME
  type. Reuses the SAME underlying `objectStore.putObject` (already
  format-agnostic). Also fixed the local dev file server
  (`api/files/[...path]/route.ts`) to recognize font magic bytes too —
  it was falling back to `application/octet-stream` for anything that
  wasn't a known image, and FontFace loading is stricter about a correct
  Content-Type than `<img>` tends to be.

  Render side (`render/customFonts.ts`): `BubbleStyle.fontFamily` stores
  a derived family name (`kumanga-font-<fontId>`) once a custom font is
  selected — no new field, it's just another value in the same string.
  The real subtlety: a freshly-uploaded font isn't in the browser yet, so
  the FIRST draw uses a fallback until `FontFace.load()` resolves, and
  Konva has no idea that happened (canvas draws are imperative, not tied
  to React reconciliation for text metrics) — so loading nudges every
  `Konva.stages` entry to `batchDraw()` once the font is ready.
  `PanelRenderer.tsx` preloads every font the project owns (idempotent,
  cached after first load) rather than only the ones currently in use, so
  picking an already-uploaded font on a NEW bubble never has to wait.
  `exportPages.ts`'s pre-warm step now awaits font loads the same way it
  already awaited image loads, for the identical reason: a page captured
  mid-load would bake in the wrong font.

  A broken/fake font upload (passes the server's magic-byte check but
  isn't real font data) must never crash rendering — `ensureCustomFontLoaded`
  swallows a failed `FontFace.load()` and just keeps the fallback font;
  this exact path is what the e2e test actually exercises (a real font
  binary wasn't available in this environment to test successful glyph
  rendering — see the test's own comment).
- **2026-09-15 — Page Overview / storyboard grid (backlog #13).** New
  `PageOverviewDialog.tsx` (TopBar, "Overview") shows every page as a real
  rendered thumbnail (not the 44px strip in `PagesBar.tsx`, which is for
  navigation, not reviewing pacing) — click one to jump straight to that
  page. Deliberately reuses `captureAllPages` (the same walk-every-page
  capture the CBZ/webtoon exporters already use) instead of a second
  rendering path, regenerated fresh every time the dialog opens rather
  than cached — simpler than invalidation, and cheap enough for a
  manually-opened dialog at the page counts a manga chapter actually has.
  Added `aria-current="page"` to `PagesBar.tsx`'s page buttons as a side
  effect of needing a reliable e2e signal for "which page is now open" —
  a real accessibility improvement, not just a test hook.
- **2026-09-15 — Blend modes: a generic layer-effects system (backlog
  #8).** New `blendMode?: BlendMode` on `PanelItemBase` (`domain/types.ts`)
  — applies uniformly to every item kind (asset, bubble, effect, tone)
  because it's a property of BEING a layer, not of what the layer
  contains; `EffectKind`'s fixed enum (speed-lines/screentone/etc.) is
  untouched, this is additive alongside it, not a replacement. 12 common
  blend modes (multiply, screen, overlay, darken, lighten, color-dodge,
  color-burn, hard-light, soft-light, difference, exclusion, plus
  "normal") — real `GlobalCompositeOperation` canvas strings, no
  translation layer except the "normal" sentinel (`render/blendMode.ts`'s
  `blendModeToCanvas`, unit tested). Applied ONCE, centrally, in
  `render/PanelRenderer.tsx`'s `renderItem` by wrapping a rendered node in
  a `<Group globalCompositeOperation={...}>` — not threaded into each of
  the 5 node components (AssetNode/BubbleNode/EffectNode/ToneNode/
  PuppetNode) individually. The default (no blendMode set) skips the
  wrapping Group entirely, so the overwhelmingly common case renders
  byte-identical to before this existed. New shared `BlendModeSelect.tsx`
  dropdown, used from both `InspectorPanel.tsx` (asset/bubble/effect) and
  `ToneControls.tsx` (tone has its own patch path, `update-tone`).
  **Known test gap, stated plainly**: covered by domain tests (state
  persistence, the canvas-string mapping) and an e2e test that the
  dropdown works and persists through the store — NOT independently
  pixel-verified that Konva's Group-level `globalCompositeOperation`
  actually composites correctly on screen (building that proof turned out
  to need either exposing internal app state to `window` for Playwright,
  or Node-side PNG pixel decoding neither of which existed in this repo
  already — judged not worth adding for this). The implementation follows
  Konva's own documented, standard pattern for per-node blend modes
  (`.cache()` isn't required for simple compositing operations like
  multiply/screen — only for masking-style ones, which is why the
  UNRELATED existing tone-mask code manually manages its own offscreen
  buffer instead of using this). If a rendered blend mode is ever reported
  as visually wrong, start here.
- **2026-09-15 — Draw a custom panel (backlog #7).** New `addCustomPanel`
  in `domain/panelOps.ts` (`add-custom-panel` command) — a rectangular
  panel dropped on top of a page at a given rect, reusing
  `factory.ts`'s existing `createPanelFromRect` (the exact function
  `applyLayout`/preset layouts already use, so there's no second panel-
  construction code path). Deliberately did NOT build a full click-to-
  plot-an-arbitrary-polygon canvas tool — `CanvasStage.tsx` is a large,
  intricate pointer-event state machine (pan/select/shape-edit/pose-edit
  all coexisting) and adding a new drag-gesture mode there directly was
  judged too risky for the value versus the alternative actually shipped:
  a "Panel" button in TopBar drops a new 40%-sized starter panel onto the
  page and immediately enters the SAME vertex-handle reshape mode a
  double-click already opens for any panel (`ShapeEditOverlay.tsx`,
  unchanged) — so shaping/positioning the new panel reuses existing,
  tested interaction code instead of a second, parallel one. Overlapping
  an existing panel is allowed on purpose (a bleeding/breakout panel is a
  legitimate manga staging choice, not a mistake to prevent) — no overlap
  check.
- **2026-09-15 — Split/merge panels (backlog #6).** New `splitPanel`/
  `mergePanels` in `domain/panelOps.ts`, working on ANY panel shape, not
  just rectangles: split is a real polygon clip (`clipPolygonHalfPlane`,
  Sutherland-Hodgman, new in `geometry.ts`) along a straight line, not a
  bounding-box trick. Merge deliberately does NOT attempt true polygon
  union (hard to get right for concave results) — it takes the convex
  hull of both panels' points instead (`convexHull`, Andrew's monotone
  chain, also new in `geometry.ts`), which can include a sliver of extra
  area between two panels that weren't already touching; documented as a
  tradeoff on `mergePanels` itself, not silently swept under the rug.
  The one property that had to hold and is what the tests actually check:
  an item's PAGE-SPACE (visual) position survives split/merge exactly,
  even though its panel-local `cx`/`cy` numbers change underneath it —
  every resulting panel gets its own new bounding box, so leaving
  panel-local coordinates untouched would have meant items silently
  jumping on screen. Both operations also re-run `applyAttachments` (§11
  — "sweat drop follows Yuri") for every panel they touch, called directly
  inside the ops functions rather than through `commands.ts`'s generic
  single-panel `ATTACHMENT_AFFECTING` mechanism, which isn't shaped for an
  operation that touches two panels at once. New Split/Merge controls in
  the Inspector's Panel section (`PanelSplitMergeControls.tsx`).
- **2026-09-15 — Chapters (backlog #5).** New `Chapter` entity
  (`domain/types.ts`), schema v13→v14. Deliberate design choice worth
  remembering: a chapter is a BOUNDARY MARKER (`{id, name, startPageId}`),
  not a `chapterId` tag on every page — its extent (`chaptersInOrder` in
  `domain/chapterOps.ts`) is derived by walking pages in order and
  bucketing between consecutive chapters' start pages, pages before the
  first chapter being an implicit unnamed prologue. This means dragging a
  page across a chapter boundary (backlog #2, done earlier today) just
  works with zero sync code — there is nothing stored per-page that could
  go stale. The one real edge case: deleting a chapter's start page. Fixed
  in `reassignChapterStartsAfterPageRemoval`, wired into `pageOps.ts`'s
  `removePage` — the chapter moves to the next surviving page still inside
  its OWN original range (never steals a page already claimed by the next
  chapter after it), or is deleted if nothing's left. New commands
  (`add-chapter`, `rename-chapter`, `remove-chapter`, `move-chapter-start`),
  new `ChaptersDialog.tsx` (TopBar), and `exportBookCbz`/`exportWebtoonStrip`
  both gained an optional `scope: {pageIds, label}` param (threaded through
  the shared `captureAllPages` in `exportPages.ts`) so a chapter can be
  exported on its own.
  **Deliberately NOT done in this pass**: Agent targeting a whole chapter
  by name. The domain model and per-page picker (backlog item from
  2026-09-14) now both exist, so this is genuinely just a wiring task next
  time it's wanted — but it wasn't asked for here and picking a chapter
  from the Agent's page-target dropdown needs its own small UI decision
  (a chapter resolves to N pages, and the Agent still only targets one
  page per run — see the 2026-09-14 agent-page-targeting entry's own
  "did not add cross-page batch generation" note, which still holds).
- **2026-09-15 — Project archive import/export.** A project only ever lived
  in one browser's IndexedDB — clearing site data or losing the profile
  loses it outright. Turned out to need almost no new machinery:
  `domain/serialization.ts`'s `serializeProject`/`deserializeProject`
  (already the exact JSON `projectStore.ts` writes to IndexedDB, full
  schema migration and shape validation included) plus
  `duplicateProjectDocument` (already does the "assign a fresh id, re-parent
  every owned entity" work, reused here purely for that, passing the
  archive's own name through so it doesn't get a "... copy" suffix) covered
  the whole thing. New `useProjectsStore.importProject(json)`; export lives
  in TopBar's Export menu (current project) and each project's "⋯" menu in
  ProjectsPanel (any project, even one not open). Scope, stated in
  `export/exportProjectArchive.ts`'s docstring: the document only, not
  image bytes — asset URLs still point at this deployment's own object
  storage (Vercel Blob in prod, local `.data/` in dev), matching exactly
  how `duplicateProject` already behaves for a same-browser copy. A true
  self-contained archive (embedded image bytes, re-uploaded on import)
  would be a much bigger feature; this solves the actual stated risk
  (losing the document to a wiped browser) without inventing that. Backlog #4.
- **2026-09-15 — Bubble typography: bold/italic/letter spacing.** Added to
  `BubbleStyle` (`domain/types.ts`) and `normalizeBubbleStyle`
  (`bubbleStyles.ts` — that function reconstructs the object field-by-field,
  so a new field silently vanishes if only added to the type, not there
  too). SFX's forced-bold impact-lettering look, previously hard-coded in
  the renderer (`fontStyle="bold"`), is now **materialized into
  `defaultBubbleStyle("sfx")`** instead — consistent with how SFX's other
  defaults (`outlineWidth`, `outlineColor`) already worked, makes an
  explicit `bold: false` override actually stick, and a pre-existing saved
  SFX bubble with no `bold` key still resolves to bold through
  `normalizeBubbleStyle`'s own fallback-to-type-default chain (verified in
  `bubbleStyles.test.ts`). New Bold/Italic toggle buttons + a letter-spacing
  slider in the Inspector's bubble "Appearance" section. Backlog #3 — all
  3 Tier-1 backlog items now done.
- **2026-09-15 — Drag-to-reorder pages.** New `reorderPage` in
  `domain/pageOps.ts` (`reorder-page` command): moves a page to a new
  reading-order position, clamped into range, a true no-op (same `doc`
  reference, no history entry) when dropped at its current spot. Also
  recomputes every affected page's `workspace.x` via
  `defaultPageWorkspacePosition` — that function is the *only* place that
  ever sets `workspace` (at creation), so without this the infinite
  workspace canvas's left-to-right spatial layout would go stale and no
  longer match reading order after a reorder. `PagesBar.tsx` got native
  HTML5 drag-and-drop (no library); a page's visible slot NUMBER always
  reflects its current index, but its `name` never changes on reorder — the
  Playwright test uses that distinction (`title` attribute) to verify
  identity moved, not just that *some* reshuffling happened. Backlog #2.
- **2026-09-15 — Webtoon-strip export.** New `export/exportWebtoon.ts`:
  stitches every page into one continuous vertical PNG (page concatenation,
  not a true panel-reflow webtoon layout — see its own docstring for that
  scope boundary). Shares page-walking/pre-warm logic with CBZ export via
  a new `export/exportPages.ts` (extracted from `exportBook.ts`, no
  behavior change there). Guards against exceeding a conservative
  cross-browser canvas-dimension ceiling (16384px) with an actionable
  error instead of silently producing a blank/truncated image — the pure
  check is `checkWebtoonCanvasLimit`, unit tested directly. New TopBar
  Export menu entries; a Playwright test drives the whole real pipeline
  (canvas capture → decode → stitch → download) since none of it is
  jsdom-testable. Backlog item #1 (see below) — first item worked
  top-down from the user-confirmed prioritized list.
- **2026-09-15 — Dialogue language setting.** `ProjectSettings.dialogueLanguage`
  (free text, e.g. "Vietnamese") + a compact TopBar input. Wired into the
  Creative Director via the existing `contextLine()` in `agent-v3/run.ts`
  (not the static system prompt), plus a new numbered rule making explicit
  that it governs only text the director *composes* — exact quoted dialogue
  (literal-lock Rule 5) is never translated. Also fixed a pre-existing
  duplicate "Rule 10" in `systemPrompt.ts` while renumbering.
- **2026-09-15 — Multi-step History dialog.** `editor/store.ts`'s
  `past`/`future` now carry a label + timestamp per entry (not bare
  snapshots); new `jumpTo(index)` moves directly to any point instead of
  looping `undo()`/`redo()`. New TopBar "History" dialog lists every entry.
  **Exposed a real bug**: adding one more TopBar icon button overflowed the
  toolbar by ~14px at the 1280px default width, and because the project-name
  breadcrumb span has `overflow-hidden` (via the `truncate` class), flexbox's
  `min-width: auto → 0` rule let it get shrunk to *zero width and vanish*
  rather than just truncate. Fixed with a `min-w-[60px]` floor + made the
  toolbar `overflow-x-auto` as the real fallback. Worth remembering:
  **any future TopBar addition risks the same squeeze** — check the
  breadcrumb stays visible after adding a control.
- **2026-09-14 — Agent page targeting + Novel Import in-place regenerate/edit.**
  `AgentPanel` gained a page picker so a run can target a page other than
  the one open in the canvas. Novel Import's planned-page prompt became an
  editable textarea (was read-only `<pre>`), and regenerating an
  already-generated page now overwrites that same project page in place
  (new `reset-page-layout` domain command — a real wipe, unlike the
  content-preserving `set-page-layout`) instead of leaving the old page
  behind. Deliberately did **not** add a "chapter" concept or cross-page
  batch generation — pages have no chapter field once generated (only
  Novel Import's transient outline has one, pre-generation), and inventing
  one would violate "never invent a control for a capability that doesn't
  exist" (see `AGENT_ARCHITECTURE.md`/`systemPrompt.ts`'s own rule 9/10).
- **2026-09-14 — Rename dialog + Playwright wired up.** Replaced
  `window.prompt()` project rename with a real dialog; added
  `tests/e2e/smoke.spec.ts` (Playwright was an installed-but-unused
  dependency before this). Runs on its own dev server, port 3100, to avoid
  colliding with an unrelated project on port 3000 on this machine.
- **2026-09-14 — Usage dashboard, CBZ book export.** Live AI panel gained
  per-provider call/error-rate stats (never a dollar figure — BYOK means
  this process never sees a bill). `export/exportBook.ts` walks every page
  and zips PNGs into a CBZ; **PDF was deliberately rejected** as an export
  format (see the docstring in that file) — CBZ is a closer fit for how
  manga readers actually consume paginated art than a page-layout format.
- **2026-09-14 — Critical security patch.** Found via `npm audit`: an
  unauthenticated RCE in Next.js 15.5.23 (GHSA-p293-qw3h-jr36,
  GHSA-2xp9-vwfh-vxw4). Bumped to 15.5.25, which surfaced a nested
  `postcss@8.4.31` vuln bundled inside `next`'s own dependency tree (not
  reachable by the existing top-level `overrides.postcss`) — fixed with a
  **nested** override `overrides.next.postcss` in both `package.json`
  files. Needed a full `rm -rf node_modules package-lock.json` reinstall to
  actually take effect; a lockfile-only reinstall was not enough.
- **2026-09-14 — Novel Import.** New feature: paste prose, get a
  page-by-page manga walkthrough. See `manga-studio/docs/NOVEL_IMPORT.md`
  for the full design (the short version: every planned page becomes a
  plain-language prompt handed to the *existing* Creative Director —
  deliberately not a second execution engine, unlike the MangaFlow project
  this was inspired by). Iterated same-day into: character
  review/rename/merge before generating, "auto" pacing (spends the model's
  own per-beat importance score instead of asking for a panel count),
  configurable panels-per-page, per-project persistence in its own
  IndexedDB store (`storage/novelOutlineStore.ts`).
- **2026-09-14 — BYOK provider rotation + Live AI observability.** Multi-key
  rotation/fallback for agent, image, and (same day, extended) background-
  removal providers (`server/providerRotation.ts` + thin per-adapter
  wrappers). Live AI panel (`server/callLog.ts` + `LiveAiPanel.tsx`) shows
  what was actually sent to the connected AI and how it responded, per
  browser session (never cross-visitor).
- **2026-09-14 — AGENTS.md/CLAUDE.md added; fork begins.** The working
  directory previously held an unrelated "manga-studio" project (ahmet360);
  it was deleted and replaced with a clone of `BotTony329/mangaharness`,
  then pushed to `QuangTQV/Manga-Creator`. This is where this fork's own
  history starts.

## Crowdfunding roadmap vs. actual code (audited 2026-09-15)

The marketing/crowdfunding site (`kumanga-website.vercel.app`) lists 7 items
under "Next — funded by the campaign" (i.e. its author's claim of what's
*not* built yet). Audited against this repo's actual code on 2026-09-15 —
the site is stale in both directions (some items already done, effort
levels vary a lot within a single bullet):

| Roadmap item | Actual status |
|---|---|
| PDF, webtoon-strip and print-ready export | **Not built.** PDF was explicitly *rejected* as a format (see `export/exportBook.ts` docstring) — CBZ was chosen instead. No webtoon-strip (long vertical concat), no bleed/CMYK/DPI options. |
| Multi-project management | **Already done**, unrelated to the campaign — full CRUD (`editor/projectsStore.ts`, `ProjectsPanel.tsx`) predates this claim. |
| …& project archive import/export | **Not built.** No project-level `.json`/`.zip` download+reupload — only manga-page/book export exists. |
| Custom panel drawing, split & merge | **Not built.** `panelOps.ts` only has `reshapePanel` (drag existing points) and `movePanelPoint` — no draw-from-blank, no split/merge commands anywhere. |
| Advanced typography & layer effects | **Partial.** Bubbles already have `fontSize`/`fontFamily`/`textAlign`/`vertical` (`types.ts` `BubbleStyle`); missing bold/italic/letter-spacing. Effects are a fixed enum (`speed-lines`/`focus-lines`/`screentone`/`impact-burst`/`emotion`), no generic blend-mode/layer-stacking system. |
| Long-form story tools | **Already done** — this *is* Novel Import (2026-09-14 entry above), unrelated to the campaign. |
| …& richer agent orchestration | **Not built.** Still exactly one Creative-Director call per run (`agent-v3/run.ts`'s documented design) — no multi-turn/autonomous planning loop. |
| Collaboration and shared asset libraries | **Not built, by design** — contradicts the no-accounts/local-first philosophy; see "Deliberately not built" below. |
| Mobile & tablet support | **Not built.** No touch handlers, no responsive breakpoints anywhere in the editor chrome — desktop-canvas-only. |

## Backlog (prioritized 2026-09-15, user-confirmed — work top-down)

Ranked by value-vs-risk/effort, not by the campaign site's own order. Update
an item's status (or strike it through with a one-line note) as it lands,
rather than leaving this list to drift from reality.

**Tier 1 — quick, low-risk, reuses existing infra**
1. ~~Webtoon-strip export~~ — **done 2026-09-15**, see Timeline.
2. ~~Drag-to-reorder pages~~ — **done 2026-09-15**, see Timeline. Still a prerequisite for #5 (chapters).
3. ~~Typography polish~~ — **done 2026-09-15**, see Timeline. (All 3 Tier-1 items now done.)

**Tier 2 — moderate effort, clear value**
4. ~~Project archive import/export~~ — **done 2026-09-15**, see Timeline.
5. ~~"Chapter" as a first-class domain concept~~ — **done 2026-09-15**, see Timeline. Per-chapter export landed with it; Agent chapter-targeting did NOT (see Timeline entry — separate, deliberately deferred). (Tier 2 fully done.)

**Tier 3 — bigger, needs careful scoping**
6. ~~Split/merge panels~~ — **done 2026-09-15**, see Timeline.
7. ~~Draw a custom panel shape from scratch~~ — **done 2026-09-15**, see Timeline.
8. ~~Generic layer-effects system (blend modes)~~ — **done 2026-09-15**, see Timeline. (Tier 3 fully done: #6, #7, #8 all shipped.)

**Tier 4 — needs subsystem study before touching (flagged risky in an earlier session)**
9. `create_interaction` Agent tool.
10. Object → character-hand prop attachment UI.

**Tier 5 — architecture-level, needs its own scoping conversation first**
11. Multi-turn/autonomous Agent orchestration (beyond today's one-Creative-Director-call-per-run design).
12. Mobile/tablet support — low priority for a canvas-precision editing tool.

**Tier 6 — "professional manga tool" gaps (audited 2026-09-15, user-confirmed
"do what you think is necessary" — working top-down same as before)**
13. ~~Page Overview / storyboard grid~~ — **done 2026-09-15**, see Timeline.
14. ~~Custom font upload for bubble/SFX lettering~~ — **done 2026-09-15**, see Timeline.
15. Furigana/ruby text on bubbles — confirmed fully absent (no field, no
    render support); genre-authentic for real Japanese-style manga, absent
    entirely today.
16. ~~Print-ready export (bleed margin + target DPI)~~ — **done 2026-09-15**, see Timeline.
17. ~~Character "model sheet" view (V1: full-variant grid + PNG export)~~ —
    **done 2026-09-15**, see Timeline. Automatic drift DETECTION (flagging
    when a generation visually diverges from the reference) was explicitly
    scoped OUT as a separate, bigger AI-vision feature — not done, not
    started, needs its own scoping conversation before picking up.

**Tier 7 — audited against `coffe01-10/MangaFlow` (a comparable AI manga
workbench, audited 2026-09-15) for feature ideas Kumanga was actually
missing** — most of MangaFlow's feature set is either already covered
(novel import, character/scene assets, storyboard editor, multi-provider
routing, export) or a deliberate architectural difference not worth copying
(its cost/usage-ledger dashboard contradicts BYOK's "never show a bill"
rule; its FastAPI+Postgres+Redis multi-user backend contradicts local-first
single-user; its CLI-executor integration doesn't fit a browser tool). Three
items were genuine, verified gaps:
18. ~~Multi-candidate generation + independent per-candidate keep~~ — **done
    2026-09-15**, see Timeline.
19. Real mask/inpaint local editing — NOT a MangaFlow lead to copy (their own
    docs say no adapter implements it either); it's a note that Kumanga's
    existing "generative local editing is provider-untested" known
    limitation is worth hardening/testing, not a new feature to build.
20. Character "model package" export/import (bundle canonical + all states
    + version, reusable across projects) — not done, not started, lower
    value than #18, fine to leave for later.

**Tier 8 — audited against `BluePointDigital/mangagen` (another comparable
AI manga workbench, audited 2026-09-15)** — same story as Tier 7: mostly
already covered or a deliberate architectural difference (its cost-
estimation dashboard, its Docker/multi-user deployment story). Notably it
uses Konva/react-konva too — same canvas engine choice as Kumanga, an
independent validation of that pick, not a feature to adopt. One genuine,
verified gap, and it directly confirmed something already flagged and
deliberately deferred in this repo's own history (2026-09-15 "Project
archive import/export" Timeline entry):
21. ~~Full backup export/import (.zip, bundles actual image/font bytes,
    portable across machines/deployments)~~ — **done 2026-09-15**, see
    Timeline.

**Tier 9 — surfaced by the user asking "is continuing an existing manga
supported yet"** — audited end to end (resume a project, chapters,
character reuse via the Agent/manual placement: all already worked). One
real, previously undocumented gap found and fixed:
22. ~~Novel Import cross-checks a project's pre-existing characters, not
    just duplicates within one parse~~ — **done 2026-09-15**, see Timeline.
23. ~~Bulk-import existing page images as new project pages, in order~~ —
    **done 2026-09-15**, see Timeline. Follow-up to #22: the user then
    asked whether importing an existing (externally-made) manga to
    continue it was supported. Scoped down deliberately, with the user's
    explicit sign-off, from "AI understands the imported pages" to "place
    the images as real pages, then the creator connects them to the
    ALREADY-existing character-reference/Art-Style-reference systems
    themselves" — automatic vision-based character extraction or
    OCR-based plot understanding from the imported bitmaps was explicitly
    rejected as disproportionately complex/risky for what was asked.

**Tier 10 — from a fresh "what's still missing for a professional tool"
audit (2026-09-15), this time verifying candidate gaps by reading code
instead of guessing — several suspected gaps turned out to be real, several
didn't (native browser spellcheck already works on bubble text for free;
no i18n system exists, 100% hardcoded English UI, not flagged as a gap
worth chasing on its own)**
24. ~~Bubble auto-fit height to its text~~ — **done 2026-09-15**, see
    Timeline.
25. ~~Warp: perspective-style shear/stretch for impact lettering, wired up
    to the `BubbleStyle.warp` field that already existed in the schema but
    had no renderer or Inspector control~~ — **done 2026-09-15**, see
    Timeline.
26. ~~Print crop/registration marks~~ — **done 2026-09-15**, see Timeline.
27. Two-page spreads (art intentionally spanning two facing pages) — not
    done, not started; a real architecture change (panels are hard-
    clamped to one page's 0..1 coordinate space everywhere: export,
    canvas, panel ops), needs its own scoping conversation, not a quick
    add.

**Not in the backlog — deliberate, don't re-add without the user explicitly overriding**
- PDF export (rejected design decision, not a gap — see `export/exportBook.ts`).
- Verifying "generative local editing" against a live paid provider (needs the user's own API credentials).
- Collaboration/shared libraries, auth/accounts (contradict the local-first/no-accounts philosophy).

## Known gotchas (learned the hard way — save yourself the rediscovery)

- **Dual lockfile.** Root `package-lock.json` must **never** be committed
  (matches the upstream project's own repeated "drop root lockfile again"
  fix). `manga-studio/package-lock.json` **is** tracked (Vercel needs it).
  A workspace-aware `npm install` from the repo root writes to the *root*
  lockfile even when you only meant to touch `manga-studio`'s deps — to
  regenerate the real one: `cd manga-studio && rm -f package-lock.json &&
  npm install --no-workspaces --package-lock-only`.
- **IndexedDB `DB_VERSION`.** Every module that opens the `manga-studio`
  IndexedDB database (`storage/projectStore.ts`, `storage/novelOutlineStore.ts`)
  declares its own copy of `DB_VERSION` and defensively creates *every*
  object store in `onupgradeneeded`, because whichever module happens to
  open the DB first is the one that bootstraps it. Adding a new store means
  bumping the version **and** updating every module's copy, or the store
  that opens second silently doesn't see the new store.
- **TopBar has no width margin.** See the 2026-09-15 History entry above —
  it's already living close to the edge at 1280px viewport width. Any new
  toolbar control should be checked against that width, not just visually
  in a wide window.
- **Bash tool's cwd resets between calls** in this environment — don't
  assume a `cd` from a previous command persisted; use absolute paths or
  re-`cd` every time.

## Deliberately not built (and why — don't re-litigate without new information)

- **Auth / accounts.** Explicit design decision in Kumanga's own README
  ("no accounts, ever") — local-first, BYOK. Not an oversight.
- **PDF export.** Considered and rejected in favor of CBZ — see
  `export/exportBook.ts`'s docstring.
- **"Chapter" as a first-class domain concept.** Only exists as transient
  planning state inside Novel Import's own outline, pre-generation. A real
  `Page.chapter` field, cross-page/chapter Agent targeting, and per-chapter
  export would all follow from adding this — flagged to the user as a
  bigger, deliberate change, not started.
- **`create_interaction` Agent tool, Object→prop-attachment UI.** Both need
  a real understanding of the `puppet`/`interaction` subsystems first;
  rushing either risks breaking a carefully-built system. Scoped as
  separate future work, not attempted.
- **Collaboration / shared asset libraries / real-time sync.** Contradicts
  the local-first, no-accounts design philosophy directly.
- **Mobile/tablet support.** Desktop-canvas-only today; no touch handling,
  no responsive breakpoints anywhere in the editor chrome.
- **Custom panel drawing/split/merge, generic layer effects, typography
  polish (bold/italic/letter-spacing), PDF/webtoon-strip/print export,
  project archive import/export, richer multi-turn agent orchestration.**
  Genuine gaps, not yet started, no design decisions made — see the
  crowdfunding roadmap table above for the full breakdown.
