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
5. "Chapter" as a first-class domain concept (needs #2 first) — unlocks Agent targeting a whole chapter and per-chapter export; currently chapters exist only inside Novel Import's pre-generation outline.

**Tier 3 — bigger, needs careful scoping**
6. Split/merge panels — touches core panel/item domain model.
7. Draw a custom panel shape from scratch (not just reshaping a preset layout's panels) — new canvas interaction.
8. Generic layer-effects system (blend modes/opacity stacking) — currently a fixed `EffectKind` enum; touches the render pipeline.

**Tier 4 — needs subsystem study before touching (flagged risky in an earlier session)**
9. `create_interaction` Agent tool.
10. Object → character-hand prop attachment UI.

**Tier 5 — architecture-level, needs its own scoping conversation first**
11. Multi-turn/autonomous Agent orchestration (beyond today's one-Creative-Director-call-per-run design).
12. Mobile/tablet support — low priority for a canvas-precision editing tool.

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
