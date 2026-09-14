# Novel Import

Turns pasted prose into a walkthrough of planned manga pages, generated one
at a time through the existing Manga Agent. Top bar → **Novel Import**
(`NovelImportDialog.tsx`).

## Where this came from, and what changed

The pipeline shape — novel text → chapters → LLM-structured scenes/beats →
deterministic pagination → page prompts — is ported from the sibling
**Manga-Translator-Extension / MangaFlow**-family design (MangaFlow's
`content_workflow.py` + `worker_handlers/story_parse.py` +
`services/ai_schemas.py`). The **optimization** for Kumanga specifically is
architectural, not just a language port:

- MangaFlow persists the parsed script as normalized Postgres rows (`Scene`,
  `Beat`, `Chapter`, …) with ordinal-conflict retry loops, savepoints, and a
  server-side job checkpoint so a multi-chunk parse can resume without
  re-paying for chunks that already succeeded. Kumanga has no server
  database — a project is a client-side IndexedDB document — so none of
  that machinery applies, and none of it was ported: `useNovelParse` is not
  a thing; the outline lives in `NovelImportDialog`'s own component state
  for the current tab.
- MangaFlow's script → page pipeline is its own execution engine: beats get
  anchored back to source-text character offsets, panels get filled from a
  library of manga-style layout templates, and the page is assembled
  server-side. Kumanga already has a general-purpose, tested single-page
  executor for exactly this job — the Creative Director
  (`agent-v3/run.ts`'s `runCreativeDirection`/`executeCreativeRun`, the same
  one `AgentPanel.tsx` drives). So this feature's OWN scope stops at
  producing one good plain-language prompt per planned page; generating it
  is 100% the existing agent path, unmodified. This is a large part of why
  the whole feature fits in a handful of new files under `agent/novelParser/`
  instead of a second generation pipeline.

## Pipeline

```
pasted text
  → splitIntoChapters              (segmentation.ts, pure — heading regex)
  → splitIntoSegments per chapter  (segmentation.ts, pure — paragraph/sentence bounds)
  → groupSegmentsIntoChunks        (segmentation.ts, pure — N segments per LLM call)
  → POST /api/agent/parse-novel    (one call per chunk, client-driven loop)
      buildNovelParsePrompt → provider.completeJson → parseNovelParseOutput
      (agent/novelParser/{prompt,schema}.ts)
  → planPages                      (pagination.ts, pure, no model call)
  → PlannedPage[] { prompt: string, beats, sceneLocation, ... }
  → per page: add-page, setCurrentPage, runCreativeDirection, executeCreativeRun
      (the SAME functions AgentPanel.tsx uses for a manually-typed prompt)
```

## The LLM's job vs. the deterministic code's job

Same division of responsibility the Creative Director itself uses ("the LLM
decides meaning, code decides structure"), applied one level up:

- The model (`buildNovelParsePrompt`, `schema.ts`) extracts characters and,
  per beat: action, exact quoted dialogue, narration, emotion, subtext, an
  **importance** score (0-1), whether it **mustVisualize** as its own panel,
  whether it's **mergeable** with the next beat, whether it's a
  **pageTurnHook**, and per-character **presence** (`visible` / `offscreen`
  / `mentioned` — so a character only referred to in dialogue is never
  drawn; a photo/portrait of them is a `prop`, not `visible`).
- `pagination.ts` — no model call, so it's instant and free to re-run — uses
  those signals to decide page/panel boundaries: a `mergeable` or
  `!mustVisualize` beat folds into the previous panel instead of spending a
  new one; a page never spans two scenes; a `pageTurnHook` beat always ends
  the page right there, even under the panel budget. That budget
  ("Panels per page") is a user setting in the dialog, 1-4 —
  `MAX_SUPPORTED_PANELS_PER_PAGE` (4) is a real ceiling of Kumanga's own
  page layouts (`domain/layouts.ts`), not an arbitrary pacing default, so
  the picker never offers more than that. Since `planPages` is pure and
  free, changing it after parsing re-plans instantly with no AI call —
  disabled once any page in the current outline has been generated, since
  re-planning renumbers page ids and would desync already-generated pages
  from their planned counterpart.
- Each planned page carries `panelCount` (how many panels it actually
  needs, which can be fewer than the budget above — several beats may fold
  into one panel). `NovelImportDialog.tsx` picks the matching Kumanga page
  layout (`single`/`two-vertical`/`three-vertical`/`four-grid`) from it when
  creating the page, instead of always creating a fixed 4-panel page and
  leaving some panels empty.
- Each planned page's `prompt` is composed prose, not JSON — "Panel 1: ...
  Aki says "Wait!" (urgent)." — written to read the way a creator would
  type it, because it IS handed to the Creative Director exactly like a
  manually-typed prompt. Its own literal-lock extraction is what turns
  quoted dialogue and named characters into the Creative Task Map; this
  module never talks to that contract directly.

## Fidelity dial (`NovelFidelity`)

A novel's prose is far denser than a page can hold, so *some* compression
is unavoidable — this lets the creator choose how much interpretation vs.
strict transcription they want, mirroring MangaFlow's
DIRECTOR/SEMI_AUTO/AUTO workflow modes:

- **faithful** — structure only what the text explicitly states.
- **guided** (default) — may add the visual detail a panel needs; never
  invents plot facts or motives.
- **creative** — actively supplies action/transitions/subtext where the
  prose is sparse; the plot itself still may never change.

## Chunking and failure isolation

The client drives the chunk loop (`NovelImportDialog.tsx`), not the server —
there's no DB to checkpoint into, so "resume after a failure" is just
"the chunks before the failed one already updated component state; retry
picks up from there" rather than a server-tracked job. Each chunk also
carries `knownCharacterNames` (every `primaryName` seen in earlier chunks of
the same chapter) so the model reuses the established name instead of
drifting to a nickname mid-chapter — a much lighter-weight substitute for
MangaFlow's DB-level cross-chunk alias-conflict merge.

## Known v1 limitations

- Not persisted: reload the page mid-import and the parsed-but-not-yet-
  generated outline is gone (pages already generated are ordinary project
  pages and persist normally, same as anything the Manga Agent makes).
- "Generate all remaining" walks pages sequentially, auto-proceeding past
  the Creative Director's normal "3+ images, are you sure?" confirmation —
  clicking Generate on a planned page already is the confirmation.
- Chapter-heading detection is regex-based and English-oriented
  (`Chapter N`, `Part N`, `Prologue`/`Epilogue`); a chapter-less paste (a
  short story, one chapter) is the common case and works with zero
  configuration either way.
