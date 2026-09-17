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

- **2026-09-17 — Two Retry options on a failed Agent run: same plan vs. new
  plan.** User asked why "Retry" always seemed to restart from scratch, and
  proposed there should be two choices: retry just the failed step, or
  retry from the beginning. Investigated `AgentPanel.tsx`'s `run()`/
  `execute()` split before deciding: `run()` always calls
  `runCreativeDirection` (a fresh, nondeterministic Director LLM planning
  call) then `execute(outcome)`; `execute(prepared)` is the ALREADY-existing
  separate function that only re-executes a given plan (no LLM call) — it's
  the same function the "Continue" confirm-dialog button already calls.
  True step-level partial retry (keep already-succeeded steps like `create_
  character`, only regenerate the failed image) would require changing the
  deliberate whole-transaction-rollback design ("a run either lands whole or
  does not land at all" — `orchestrator.ts`'s own docstring; also entangled
  with the "one Undo reverts an entire agent run" invariant). Asked the user
  to choose between that bigger architectural change and the smaller,
  already-safe option; they chose the smaller one. Shipped: the `error`
  block's "Run failed" UI now shows "Retry (same plan)" (calls `execute(
  prepared)` directly — `prepared` was already sitting in React state,
  never cleared on failure) alongside "Retry (new plan)" (the original
  behavior, `run(prompt.trim())`), gated on `runSummary?.status === "failed"
  && prepared` so a genuine PLANNING failure (no valid prepared plan to
  reuse) still shows just the single original "Retry". No automated test
  added: this repo's e2e suite (`smoke.spec.ts`) has no existing harness
  for mocking a full agent run (Director LLM + execution) end-to-end, and
  `execute(prepared)` is already an existing, separately-exercised code
  path (the "Continue" button) — building new mocking infrastructure just
  for this button felt disproportionate to the change and risked being more
  fragile than the feature itself. Flagging the gap explicitly rather than
  skipping it silently.
- **2026-09-17 — Per-LoRA scope ("all" / "isolated" / "scene").** After the
  white-background LoRA (weight 0.3, alongside the line-art LoRA at 0.5)
  finally produced a clean, genuinely white-background test generation —
  confirmed via the "Test generation" button, the first fully clean result
  of the whole debugging session — the user asked a good architectural
  question: can a LoRA apply conditionally, since a backdrop-biasing LoRA
  that helps character generation would actively fight a `background`-type
  generation (which wants a full scene, the opposite bias). Until now
  every configured LoRA applied unconditionally to every generation
  (`addLoraChain` in `comfyui.ts`, shared by `buildWorkflow`/
  `buildEditWorkflow`). Added `ComfyUiLoraEntry.scope?: "all" | "isolated" |
  "scene"` (`server/comfyui/config.ts`; omitted = "all", so every existing
  saved config is unaffected). `addLoraChain` now takes the CURRENT
  request's scope and filters entries before chaining — `buildWorkflow`
  derives it from `request.assetType` (`"background"` → `"scene"`, else
  `"isolated"`; required widening `buildWorkflow`'s `request` Pick type to
  include `assetType`, which `ImageGenerationRequest` already carried but
  the Pick had never needed before). `buildEditWorkflow` is hardcoded
  `"isolated"` — a local edit always targets an existing cutout asset,
  never a background. `AiSettingsDialog.tsx`'s LoRA row editor gained a
  third `<select>` per row ("All generations" / "Character/prop cutouts
  only" / "Backgrounds only"). Regression tests in both `comfyui.test.ts`
  (graph-level: an isolated-scoped LoRA is skipped on a background request
  and vice versa, an unscoped one applies to both) and a new e2e test
  (save/hydrate round-trip for the scope field). `HOW_TO_RUN.md` updated to
  recommend scoping the white-background LoRA to "Character/prop cutouts
  only" so it no longer needs manual toggling when switching between
  generating a character and a background.
- **2026-09-17 — Traced a "still draws a street scene" failure past the
  prompt-building layer into the Creative Director's own output.** After
  the `stateRuntime.ts` fix (previous entry) was confirmed live via Live
  AI (negative prompt now correctly carries every reinforced term), the
  user's real Agent run still failed — but the actual generated image
  was clean line art of "Haruto" running down a city street, not a
  background/panel-layout artifact at all. The Live AI PROMPT field
  showed why: `"Appearance: running, school student Standing neutral
  pose..."` — the character's own stored identity ("appearance") field
  literally contains the transient action "running", contradicting the
  very next sentence ("Standing neutral pose") in the same prompt, and
  plausibly biasing the model toward an outdoor/action scene despite the
  isolation instruction and every negative-prompt term. Traced the data
  flow: `characterIdentityDescription` (`characters/state.ts:118-125`)
  renders `character.appearance` verbatim → that field is set by
  `doCreateCharacter` (`agent-v2/process/characterProcess.ts:43-47`) from
  `args.appearance` → which `agent-v3/routing/capabilityRouter.ts:54`
  builds as `binding.attributes.join(", ")` — i.e. this is the Creative
  Director LLM's own `participant.attributes` array
  (`agent-v3/contract/creativeTaskMap.ts:26`), meant for STATIC identity
  traits only. The Director's system prompt's own Rule 3
  (`agent-v3/director/systemPrompt.ts`) already says to keep WHO and
  WHAT-THEY-DO separate — action belongs in `beats[].action`, not
  `participant.attributes` — but had no explicit example forbidding an
  action verb from landing in `attributes` specifically, and the model
  put "running" there anyway. This is a permanent character-identity
  pollution bug, not a one-off: once "running" is baked into
  `character.appearance`, it leaks into every future pose/expression
  render of that character, not just this generation. Added a concrete
  corrective example to Rule 3 (an action-verb blocklist framing plus
  the exact "Haruto runs through the school hallway" case, mirroring the
  real failure) — text-only change to the system prompt, no schema/logic
  change, verified `services/architecture.test.ts`'s "exactly one
  canonical system prompt" check still passes (it only checks the SYMBOL
  isn't duplicated, not prompt content/length). Caught a self-inflicted
  syntax bug while editing: `CREATIVE_DIRECTOR_SYSTEM_PROMPT` is a
  template literal, and backticks in the added example text (`` `attributes` ``,
  `` `beats[].action` ``) terminated the string early — `tsc` caught it
  immediately; fixed by dropping the backticks (plain text, no markdown
  code-span styling inside a prompt string anyway).
- **2026-09-17 — Found the REAL reason the negative-prompt fix never
  reached the Manga Agent's own generations.** User retried "Generate
  reference for Haruto" through the actual Agent panel (not the manual
  Generator dialog) after both negative-prompt fixes above and still got
  a rejected background — a clean, well-drawn character, but on a
  uniform grey backdrop. Spawned an Explore subagent to trace exactly
  which file builds that specific request rather than guess again, since
  guessing had already cost real time twice this session. Root cause:
  `characters/stateRuntime.ts`'s `generateCharacterAssetForState` — the
  actual function behind the Agent's "Generate reference"/pose/expression
  steps (`agent-v2/process/characterProcess.ts` → `stateRuntime.ts`) —
  was never among the 5 call sites updated earlier. Its positive prompt
  correctly went through `buildAssetPrompt`/`buildCharacterStatePrompt`,
  but its negative prompt still read `style.profile.negativePrompt` raw,
  completely bypassing every anti-background/anti-panel term added so
  far. This means the ENTIRE two-part negative-prompt fix had zero effect
  on real Agent-driven character generation the whole time — only the
  manual "Generator" dialog and a few secondary flows (tones, scenery,
  language, interaction) ever actually benefited. Fixed the one missed
  call site; added a regression test in the existing
  `characterCamera.test.ts` (extends its already-mocked
  `generateCharacterAssetForState` harness rather than building new
  mocking infrastructure) asserting the Agent's own request carries the
  reinforced terms. Also confirmed via the same trace that
  `panelCamera.ts`/`sceneCamera.ts` have the identical raw-read pattern
  but are genuinely harmless: both hardcode `assetType: "background"`,
  which `buildAssetNegativePrompt` already no-ops for — left alone,
  matching the original decision to skip them.
- **2026-09-17 — Extended `backgroundNegativeTerms` with grey/two-tone
  backdrop and multi-panel/border terms.** Continuing the same live
  debugging: a real generated image (line-art LoRA + stock SDXL, after the
  earlier floor/shadow/gradient fix) still failed background removal — a
  grey-to-white two-tone backdrop AND a multi-panel "character reference
  sheet" layout (main figure + zoomed inset crops, divided by border lines
  touching the image edges). Notable: `isolationInstruction`'s positive
  prompt already said "no frame, no border" explicitly, and the model
  drew borders anyway — the exact same positive-negation-is-unreliable
  pattern the floor/shadow fix addressed, just a different manifestation.
  Extended `backgroundNegativeTerms` (not a new function — same gate,
  same call sites, this is squarely the same failure family: "what
  corrupts a clean single-subject isolated cutout") with `grey
  background, gray background, border, frame, panel border, multiple
  panels, panel grid, inset, close-up inset, reference sheet, turnaround
  sheet`. No new call sites to update — every consumer of
  `buildAssetNegativePrompt` picks this up automatically.
- **2026-09-17 — Checked a ranked model list from another AI (ChatGPT)
  before writing it into docs — caught a real architecture trap.** User
  pasted a ChatGPT-generated ranking of manga/anime SDXL checkpoints and
  asked to add the top pick ("Manga Vision IL") to HOW_TO_RUN.md as the
  new recommended checkpoint. Verified every claim via `WebSearch`/
  `WebFetch` before writing anything (same discipline as every other
  model recommendation this session) rather than trusting the report at
  face value — and it would have been actively harmful advice: despite
  the "IL" (implying "Illustrious"/SDXL) name and Civitai's own
  "Checkpoint" listing type, the model's actual "Base Model" field reads
  **"Anima"** — a genuinely different, incompatible architecture (16-
  channel VAE vs SDXL's 4, flow-matching vs epsilon-prediction), verified
  by fetching the Civitai page twice and cross-checking Civitai's own
  "Anima" ecosystem page. It would not have worked with the already-
  installed SDXL LoRA (LineAniRedmond) or with Kumanga's current
  hard-coded-for-SDXL ComfyUI graph — exactly the class of silent-garbage
  failure this whole session spent hours diagnosing with Animagine XL.
  Did NOT add it. Instead verified and added a real, compatible
  alternative from the same list: `Minthy/RouWei-0.8` (Illustrious-
  based, SDXL-shaped) — specifically its `rouwei_080_epsilon_fp16.
  safetensors` file, confirmed via the HF file listing to be the
  standard epsilon-prediction variant (the repo also ships a `vpred`
  variant that needs an extra ComfyUI node the current adapter doesn't
  add — avoided that trap too). Added a permanent callout in
  `docs/HOW_TO_RUN.md` §5c (VN+EN) about the "IL name ≠ Illustrious
  architecture" trap generally, not just this one model, since it's a
  naming pattern that will keep recurring on Civitai.
- **2026-09-17 — "Fetch models" for ComfyUI's checkpoint field.** Same live
  Kaggle debugging session, user's own observation: the Model field (the
  checkpoint filename) was still hand-typed free text, while LoRA/
  ControlNet-model fields already had "Fetch ..." dropdown buttons since
  v3 PR1. Widened `comfyui-object-info`'s zod enum to also accept
  `CheckpointLoaderSimple`/`ckpt_name` (same generic `object_info`
  mechanism, no new endpoint) and routed that combo's results into the
  Model field's already-existing `models` state/datalist (it already
  worked for the openai-compatible "Fetch models" button — ComfyUI just
  never populated it). "Fetch models" button now shows for ComfyUI too.
- **2026-09-17 — Reinforce the negative prompt against floor/shadow/
  gradient backdrops on every foreground asset.** Continuing the same live
  Kaggle-ComfyUI debugging session: after switching back to
  `sd_xl_base_1.0.safetensors` + one LoRA (the checkpoint/LoRA combo that
  actually produced good character art — see the two entries below), the
  user's own generated image still failed "Background removal did not
  complete" — visually clean, but with a grey-to-white gradient backdrop
  AND a cast drop shadow under the character's feet, both explicitly
  forbidden by the prompt's positive-phrased instruction ("no gradient...
  no cast shadow on the background") and both explicitly rejected by
  `validateWhiteBackground` (confirmed by reading
  `foregroundPolicy.test.ts`'s own existing "rejects a grey backdrop" /
  "rejects a gradient or textured backdrop" cases — this was never a loose
  heuristic, the validation was correctly strict the whole time). The
  actual gap: the app only ever asked for this in the POSITIVE prompt
  ("no floor, no cast shadow, no gradient") and never reinforced it as
  actual NEGATIVE-PROMPT terms — the channel SD-family models respect far
  more reliably for suppressing an unwanted element than a positively-
  phrased negation, which is exactly the class of instruction this whole
  debugging session kept watching these checkpoints ignore.
  Added `backgroundNegativeTerms(policy)` to `foregroundPolicy.ts`
  (empty for `native-alpha` — no backdrop to suppress there) and a new
  `buildAssetNegativePrompt(input)` companion to `buildAssetPrompt` in
  `promptTemplates.ts`, then switched every one of its 5 call sites that
  can generate a non-"background" asset type (`services/tones.ts`,
  `scenery.ts`, `language.ts`, `interaction.ts`, `GeneratorDialog.tsx`)
  from reading `style.profile.negativePrompt` directly to calling the new
  function — `sceneCamera.ts`/`panelCamera.ts` hardcode `assetType:
  "background"` and were left alone since the function is a no-op for
  that type anyway, not worth the diff. `AssetPromptInput.style`'s type
  widened to also `Pick` `negativePrompt` (was missing it, a real gap
  once a function needed to read it). New regression tests in
  `foregroundPolicy.test.ts` for both the new function and its
  `buildAssetNegativePrompt` companion.
- **2026-09-17 — New "Test generation" button in AI Settings (Image
  Generation).** After a long live-debugging session on the user's real
  Kaggle ComfyUI setup (checkpoint swaps, LoRA weights, `--fp32-vae`) where
  the only way to see the provider's *raw* output was for me to read the
  saved file straight off `.data/generated/` via the Live AI log's URL, the
  user asked for a real in-app way to do this themselves. Added `POST
  /api/provider/test-generate`
  ([route.ts](manga-studio/src/app/api/provider/test-generate/route.ts)):
  builds one representative character prompt via the existing
  `buildAssetPrompt` (isomorphic, already used by both the client preview
  and the agent) with the default "Minimal Line Manga" style profile, calls
  `createImageProvider(config).generateImage()` **directly** — deliberately
  bypassing `generateAssetImage`'s background-removal/`characterAssetContract`
  pipeline, since the entire point is to see what the provider drew BEFORE
  that gate can reject it — saves the raw bytes via `putObject`, and logs
  the call to Live AI (`recordLiveCall`, `route: "test-generate"`) so it's
  inspectable the same way any other generation is. Distinct from the
  existing "Test Connection" (status-only, `/api/provider/test`, explicitly
  "never a full generation") — this new button is a real, costly generation,
  gated behind `configured` exactly like Test Connection is, shown only for
  the image-kind card. `SIZE_MAP` in `ai/generate.ts` exported (was a private
  const) so this route reuses the exact same portrait dimensions real
  generations use, rather than duplicating the constant.
- **2026-09-17 — HOW_TO_RUN.md: `--fp32-vae` required on the Kaggle T4
  ComfyUI launch command.** After switching to the Animagine XL 4.0
  checkpoint (previous entry), the user hit "Background removal did not
  complete" again — but the actual generated PNG (checked the same way:
  read straight off `.data/generated/` via the Live AI log's URL) this
  time was nearly blank/washed-out grey-white with no character at all,
  a visually distinct failure from the earlier "drew a whole street scene"
  one. This is the well-known stock-SDXL-VAE fp16 numerical-overflow bug
  (activations exceed fp16 range → Inf → NaN → blank/grey decode),
  specifically common on T4-class GPUs — confirmed via `WebSearch`
  against `madebyollin/sdxl-vae-fp16-fix`'s own README before writing
  anything down. Fixed by adding `--fp32-vae` to the `ComfyUI/main.py`
  launch command in both §5b/5c Kaggle cells (VN+EN) rather than adding a
  separate fixed-VAE download + VAELoader node — simpler, and our
  ComfyUI adapter's hand-built graph doesn't have a VAELoader node to
  wire one into anyway (`comfyui.ts` uses the checkpoint's own baked-in
  VAE via CheckpointLoaderSimple). Also folded into the existing
  Troubleshooting cross-reference for "Background removal did not
  complete" as cause #2, since the two failure modes need different
  fixes and are easy to conflate from the symptom alone.
- **2026-09-17 — HOW_TO_RUN.md: checkpoint/LoRA guidance for ComfyUI
  character generation.** User hit "Background removal did not complete"
  on a real Kaggle ComfyUI + `sd_xl_base_1.0.safetensors` setup — confirmed
  by reading the actual generated PNG straight off `.data/generated/`
  (visible in the Live AI log's `url` field): the checkpoint drew a full
  street scene instead of the "isolated on pure white background, no
  scenery" the prompt asked for ([foregroundPolicy.ts](manga-studio/src/ai/foregroundPolicy.ts)),
  so the local flood-fill background remover had no clean edge-connected
  region to strip. Not a bug — a base-SDXL prompt-adherence limitation.
  Added a "Picking a checkpoint/LoRA for ComfyUI" subsection to
  `docs/HOW_TO_RUN.md` §5b (VN+EN) recommending two verified, directly
  downloadable LoRAs rather than a checkpoint swap: `artificialguybr/
  LineAniRedmond-LinearMangaSDXL-V2` (Hugging Face, matches Kumanga's own
  "Minimal Line Manga" style) and Civitai's `White Background` LoRA
  (needs a Civitai API key for the wget download — anonymous downloads
  are blocked there), plus a CFG-bump fallback. Cross-linked from both
  §7 Troubleshooting sections so a future user hitting this exact error
  message finds the fix. Follow-up in the same session: user asked for
  "xịn hơn" (better/quality) checkpoint options in the Kaggle download
  cell itself, not just LoRAs layered on base SDXL. Verified two more
  real, directly-downloadable-from-Hugging-Face anime checkpoints via
  `WebSearch`/`WebFetch` before writing them into the doc (never guessed
  a model URL): `cagliostrolab/animagine-xl-4.0` (anime/danbooru-tag
  trained, much stronger tag adherence — made the new default in the §5c
  Kaggle cell) and `OnomaAIResearch/Illustrious-XL-v2.0` (base for most of
  today's anime LoRA ecosystem, offered as an alternative). §5b's LoRA
  guidance updated to say "switch checkpoint first, LoRAs on top" instead
  of "LoRA instead of switching checkpoint."
- **2026-09-17 — Custom API agent: self-heal `max_tokens` →
  `max_completion_tokens`.** User was configuring Azure OpenAI as the
  Manga Agent via the Custom API protocol (following `docs/HOW_TO_RUN.md`
  §5c) and hit a real bug, not a config mistake: `customAgent.ts`'s
  `isOpenAiChatShape` heuristic (URL path ends in `/chat/completions` +
  body has a `messages` array) silently injects `max_tokens: 2048` into
  the request **outside** the user's editable Request template — there
  was no way to remove or override it from the UI. Newer reasoning-family
  models (o1/o3/gpt-5-class — the user's Azure deployment was one) reject
  `max_tokens` and require `max_completion_tokens` instead, so every
  request 400'd with Azure's own "Use 'max_completion_tokens' instead"
  error. Fixed by self-healing rather than model-name sniffing (deployment
  names are arbitrary, so a name-pattern list would always be behind the
  next model family): on a 400 whose body actually mentions
  `max_completion_tokens`, retry once with that key swapped in for
  `max_tokens`, same body otherwise. Added `customErrorFromText` to
  `execute.ts` (extracted from `customErrorFrom`, for a body already read
  once during the retry check) and two regression tests in
  `customAgent.test.ts` (retry-and-succeed; a same-shaped-but-unrelated
  400 must NOT trigger a wasted retry).
- **2026-09-17 — Fork attribution + README overhaul.** User asked to
  remove "Created and maintained by BotTony329" from README.md, saying
  this is now their own project. Flagged before acting: the LICENSE's own
  text requires "the attribution in NOTICE.md" be included in all
  copies/forks, and NOTICE.md itself says "This notice must be preserved
  in copies, forks and derivative works" — removing it outright would be
  a license violation, not a stylistic choice. User agreed to the
  compliant alternative instead: **keep** BotTony329's original credit
  (required), **add** QuangTQV (https://github.com/QuangTQV) as this
  fork's maintainer alongside it — in `NOTICE.md`, `README.md` (intro
  line + License & attribution section), and the in-app corner
  attribution link (`Studio.tsx`'s `Attribution` component, now two small
  links instead of one). This matches CLAUDE.md's own standing instruction
  on this exact scenario ("if the user wants to drop it, flag that as a
  licensing decision, not a code change to just make") — worth remembering
  for any FUTURE request to touch attribution: don't just comply, explain
  the license requirement first and offer the compliant middle ground.
  Also did the README content update the user asked for in the same
  message: test count badge 1425→1504 (stale since the v0.3.0 release
  README pass, before this session's ComfyUI work existed), quick-start
  `git clone` URL corrected from the upstream `BotTony329/mangaharness` to
  this fork's own `QuangTQV/Manga-Creator` (previously inconsistent with
  `docs/HOW_TO_RUN.md`, which already used the fork URL), and new content
  throughout ("What can it do?", the AI-providers table, two FAQ entries)
  covering everything shipped this session: ComfyUI (LoRA/ControlNet/
  IPAdapter/real inpainting), Azure OpenAI via Custom API, and running
  ComfyUI on Kaggle's free GPU — all pointing at `docs/HOW_TO_RUN.md` for
  exact steps rather than duplicating them.
  Verified: `npm test` → 1504/1504; typecheck/lint/build clean; a targeted
  e2e smoke check confirmed the studio still boots after the `Studio.tsx`
  change (no e2e test asserted the old attribution text, so no test
  needed updating there).

- **2026-09-17 — Added IPAdapter support to ComfyUI's edit path, closing
  the capability gap the previous fix (below) had documented but not
  built.** User asked to "add IPAdapter" right after that fix shipped.
  Given real uncertainty about the exact current node API for
  `ComfyUI_IPAdapter_plus` (a THIRD-PARTY custom node pack, not part of a
  vanilla ComfyUI install — a real new external dependency, not just
  another core-node feature like LoRA/ControlNet/mask were), ran a
  Plan-agent verification pass that read the actual `IPAdapterPlus.py`
  source directly (not docs) before writing any code — confirmed exact
  node names (`IPAdapterUnifiedLoader`, `IPAdapterAdvanced` — NOT the
  deprecated `IPAdapterApply` or the stripped-down `IPAdapterSimple`),
  exact required input names/types, and every COMBO/enum's real valid
  string values (`preset`'s 6 real strings, `weight_type`'s 15 real
  values, `combine_embeds`'s 5, `embeds_scaling`'s 4) plus their function
  defaults. This is the 4th time this session a second-opinion pass over
  a ComfyUI graph shape (LoadImageMask channel, ControlNetApplyAdvanced
  required fields, and now IPAdapter's whole node pair) caught or
  confirmed something non-obvious before shipping, given zero live
  ComfyUI access throughout.
  `ComfyUiExtraConfig` gains `ipAdapterPreset`/`ipAdapterWeight` — unlike
  ControlNet, NO required config: `ipAdapterPreset` defaults to
  `DEFAULT_IP_ADAPTER_PRESET` ("STANDARD (medium strength)", the
  architecture-agnostic one of the 6 real presets — 2 others are SD1.5-only
  and fail on SDXL) whenever an edit carries an extra reference, so this
  activates automatically the moment the capability gap it fixes would
  otherwise recur. `buildEditWorkflow` wires `IPAdapterUnifiedLoader` →
  `IPAdapterAdvanced` at node ids `50`-`52` (edit path only), replacing the
  LoRA chain's model output as KSampler's `model` input — confirmed
  composes correctly with LoRA (wraps the LoRA-chained model, not the raw
  checkpoint) and is orthogonal to the mask/`SetLatentNoiseMask` machinery.
  `AiSettingsDialog.tsx` gets a plain `<select>` with the 6 hardcoded
  preset strings (deliberately NOT a "Fetch"-button dropdown like LoRA/
  ControlNet — presets are a small, fixed, version-pinned list, not a
  per-install file listing, so a network round trip would be pointless).
  **Fixed the SAME recurring bug class a third time, then eliminated it
  at the root instead of patching it again**: `normalizeComfyUiConfig`'s
  emptiness check (already patched once for `controlNetModel`/
  `controlNetStrength` after going stale for THOSE fields) would have
  gone stale a second time for these two new fields too. Rewrote it to be
  generic (`Object.values(scalars).some(v => v !== undefined)`, checking
  every field automatically) instead of patching the hand-enumerated list
  a third time. Found the SAME category of bug in a second place while
  fixing this one: `AiSettingsDialog.tsx`'s "should the Advanced ComfyUI
  settings section start open" check was ALSO a hand-enumerated OR-chain,
  missing `comfyUiControlNetStrength` (already caught and fixed earlier
  today) and would have needed the same treatment for the 2 new IPAdapter
  fields. Simplified to `open={configured}` — "already saved once" is
  what actually correlates with "something's probably in here," and
  needs no upkeep when yet another field is added later. **This
  simplification broke 2 existing e2e tests** that unconditionally
  clicked the section's summary regardless of its already-open state —
  a native `<details>` click always inverts current state, so clicking
  an already-open section (now open because `configured` was already
  true in those tests' mocks) closed it instead. Fixed by removing the
  now-redundant clicks, with a comment explaining why, rather than
  reverting the simplification — this is the exact same "don't blindly
  click a disclosure whose open state depends on data" lesson already
  learned and documented earlier this same day, now applied a second time.
  New tests: `buildEditWorkflow` gets 4 IPAdapter cases (default preset
  applied automatically, preset/weight overrides, LoRA-then-IPAdapter
  composition, and a no-reference case proving zero IPAdapter nodes are
  added when there's nothing to blend in). `editImage` end-to-end test
  extended to upload source+mask+reference as 3 separate calls and assert
  the IPAdapter nodes use the reference upload's own server-returned name.
  New `providerSession.test.ts` case pins the generic-rewrite fix with an
  ipAdapterWeight-only config. New e2e test covers the preset/weight
  select+number-input save/hydrate round trip.
  Verified: `npm test` → 1504/1504; typecheck/lint/build clean; full
  Playwright suite (37 tests) passing after the 2 test fixes above.

- **2026-09-17 — Fixed local-edit identity references being silently
  dropped, plus a smaller same-session-pattern bug.** Found during a
  requested code review pass over the ComfyUI v3 work, not by the user
  reporting broken behavior.
  **The real bug**: `AssetDetailEditor.tsx` builds a `referenceUrls` array
  (a character's canonical render, sent alongside an edit so the provider
  has a stronger identity anchor) and `/api/assets/edit/route.ts`'s own
  zod schema accepts and documents it ("Identity/style references, sent
  alongside the source where supported") — but the route never actually
  forwarded it to `provider.editImage(...)`. Pre-existing, predates this
  session's ComfyUI work entirely; just never noticed until asked to look.
  Fixed: `ImageEditRequest` (`ai/types.ts`) gains
  `referenceImages?`/`referenceUrls?` (same shape/pairing as
  `ImageGenerationRequest`'s own fields, kept separate from `image` since
  editing's primary reference is the source itself). `ai/generate.ts`'s
  `loadReferences` — already bounded/allowlisted — is now exported and
  reused (not duplicated) by the route, gated on
  `provider.capabilities.supportsReferenceImage` the same way the main
  generation route already gates references. Gemini's `editImage` now
  sends `[source, ...extraRefs]` capped at its own declared `maxImages`
  (3) rather than silently exceeding the capability it promises.
  customImage's `editImage` extends both the base64 and URL reference
  arrays consistently with its existing per-mode logic. ComfyUI's
  `editImage` explicitly does NOT use the new field — its edit graph's one
  image-input slot already goes to the edit source via `VAEEncode`;
  blending in a second identity reference would need model composition
  (an IPAdapter-style node) that adapter doesn't build — documented as a
  real, deliberate capability gap in a code comment, not a silent no-op.
  New tests: Gemini gets two `editImage` cases (extra references
  included, and truncated at exactly `maxImages` rather than exceeded).
  `referenceContract.test.ts` gets a new Contract G block covering
  customImage's `editImage` in both base64 and URL reference-transport
  modes. `assets/edit/route.test.ts` gets two new cases: references
  loaded and forwarded when the provider supports them, and never
  loaded/forwarded at all when it doesn't (proving the capability gate
  actually short-circuits, not just that it happens to pass through unused).
  **The smaller bug, found while re-scanning for the SAME pattern that
  had already bitten twice this session** (`hasCredential` in v3 PR1,
  `normalizeComfyUiConfig` in v3 PR3): the "Advanced — ComfyUI settings"
  `<details>` disclosure's own hand-enumerated "is there anything to
  show" check was missing `comfyUiControlNetStrength` — added when
  ControlNet strength shipped in PR3 but never added to this list. Fixed
  in an earlier, separate commit this same day (`311bee7`) once spotted.
  Verified: `npm test` → 1498/1498; typecheck/lint/build clean; full
  Playwright suite (36 tests) passing.

- **2026-09-17 — Documented Azure OpenAI (Agent) + Kaggle free-GPU
  ComfyUI (Image Generation) as a combined hosting recipe.** User asked
  whether they could run the Manga Agent purely via a cloud API (Azure
  OpenAI) while running image models on Kaggle's free GPU quota, exported
  as an API. Confirmed both are achievable with ZERO new code — pure
  documentation, added as `docs/HOW_TO_RUN.md` §5c (both VN/EN):
  - **Azure OpenAI is NOT plug-compatible with the existing
    "OpenAI-compatible" agent adapter** — checked
    `agent/providers/openaiCompatible.ts` directly: it hardcodes
    `Authorization: Bearer` and appends `/chat/completions` with no query
    string support, but Azure needs an `api-key` header (not Bearer) and
    a required `?api-version=...` query parameter. The already-existing
    **Custom API** agent provider (`agent/providers/customAgent.ts`) DOES
    work: it uses `config.baseUrl` as the literal full request URL (no
    appending), and its `auth.mode: "header"` supports an arbitrary header
    name — documented the exact field values (endpoint with the full
    query string pasted in, header name `api-key`, default Chat
    Completions request template/response path unchanged).
  - **Kaggle + ComfyUI**: the existing ComfyUI adapter (shipped this same
    session, v1-v3) already works against ANY reachable base URL — a
    Kaggle notebook running ComfyUI, tunneled out via `cloudflared` (no
    account needed, unlike ngrok) to a real public HTTPS URL, needs
    **zero `ALLOW_PRIVATE_NETWORKS` bypass** since it's genuinely public,
    not a private/local address — this means it also works from a
    production deployment, not just local dev. Documented a concrete
    notebook script (clone ComfyUI, `pip install`, download one
    checkpoint, start the server with `subprocess.Popen` in the
    background, start `cloudflared tunnel --url http://localhost:8188`,
    read its printed URL) and flagged the real operational caveats
    explicitly: Kaggle interactive sessions time out and have a weekly GPU
    quota, the tunnel URL changes completely on every restart (must
    re-paste into AI Settings each time), and Kaggle offers no SLA for
    this as production infrastructure — call it out as fine for personal/
    test use, not a real hosting story for multiple concurrent users.
  - Not verified end-to-end against a live Kaggle notebook or a live
    Azure OpenAI resource (none available in this environment) — the
    Azure claim rests on checking the actual adapter source code (the
    auth-header/URL mismatch is a real, confirmed fact from the code, not
    a guess), while the Kaggle steps are standard/well-documented but
    should be treated as best-effort, flagged as such in the doc itself.

- **2026-09-17 — ComfyUI adapter v3 PR3: ControlNet (final PR of the
  three-PR v3 plan; backlog #47 fully done now).** Per the approved plan
  (`/Users/quang/.claude/plans/luminous-sparking-wombat.md`), user-supplied
  pre-processed control image only — no auto pose/edge extraction, since
  ComfyUI's preprocessor nodes (`controlnet_aux`) aren't part of a vanilla
  install and depending on them would risk "unknown node type" for anyone
  who hasn't added that extra pack.
  `ProviderCapabilities.supportsControlImage?: boolean` (`ai/types.ts`,
  optional so every other adapter is unaffected) and
  `ImageGenerationRequest.controlImage?: {mimeType, data}` — its own field,
  not folded into `referenceImages`, since that array's single ComfyUI
  slot (`maxImages: 1`) is already spent on v2's img2img feature and the
  two purposes (identity/style reference vs. structural control) are
  genuinely different. `ai/generate.ts` gained a matching
  `controlImageUrl` schema field + capability gate, and reused
  `loadReferences([url])` for the single-URL fetch rather than writing a
  second bounded-fetch implementation.
  `GeneratorDialog.tsx`'s `ReferencePicker` gained `label`/
  `unsupportedMessage`/`showUseSelector` props so the control-image picker
  could reuse the exact same component (upload-or-pick-from-library)
  instead of a parallel widget — `showUseSelector={false}` hides the
  reference-weighting dropdown ("match layout/style/loose inspiration"),
  which describes identity-reference semantics with no meaning for a
  ControlNet structural input.
  `comfyui.ts`'s `buildWorkflow` gained nodes `40`-`42`
  (`LoadImage`/`ControlNetLoader`/`ControlNetApplyAdvanced`, per the
  design the Plan-agent review already validated during PR2's planning —
  both required `start_percent`/`end_percent` inputs supplied explicitly,
  both conditioning outputs wired to KSampler), composing orthogonally
  with the LoRA chain (model/clip source) and img2img (latent source) —
  confirmed with a dedicated 3-way-composition test, not just an
  architectural claim. `generateImage` throws a clear `ProviderError` if a
  control image arrives with no `controlNetModel` configured, rather than
  silently dropping it.
  `AiSettingsDialog.tsx` reuses PR1's `fetchComfyUiOptions`/
  `comfyui-object-info` mechanism for a "Fetch ControlNet models" button
  — proof that PR1's generic route design (parameterized by node
  class/input name) was genuinely reusable, not just built for LoRA.
  **Another small real bug caught while extending the config, same
  category as PR1's `hasCredential` gap**: `normalizeComfyUiConfig`
  (`providerSession.ts`) collapses an all-unset `comfyui` object to
  `undefined` to avoid writing cookie noise for users who never open the
  Advanced section — its emptiness check is a hand-enumerated list of
  field names, and had NOT been extended for the two new fields
  (`controlNetModel`/`controlNetStrength`). A config with only a
  ControlNet model set (no steps/cfg/LoRAs) would have been silently
  dropped on every save. Fixed, with a regression test pinning the exact
  failure case. **Pattern worth remembering**: any "is this object
  effectively empty" check built as an enumerated field list needs to be
  revisited every time a sibling field is added to that same config
  shape — two bugs in three PRs came from exactly this shape of check
  (`hasCredential`'s OR-chain in PR1, `normalizeComfyUiConfig`'s
  AND-of-undefined-checks here) silently going stale.
  Verified: `npm test` → 1492/1492; typecheck/lint/build clean; full
  Playwright suite (36 tests) all passing, including a save/hydrate
  round-trip test for the two new fields and a "Fetch ControlNet models"
  dropdown test reusing PR1's own e2e pattern.
  **Overall v3 status: DONE** — all three planned PRs (dropdown discovery,
  masked inpainting, ControlNet) shipped, tested, and pushed. No live
  ComfyUI instance was available anywhere in this three-PR arc to verify
  the real `/object_info`, `LoadImageMask`, or `ControlNetApplyAdvanced`
  behavior empirically — every unverified specific was flagged explicitly
  in code comments and both architecture docs rather than assumed silently
  correct; first real use against a live instance should be treated as
  the actual acceptance test for this whole feature arc.

- **2026-09-16 — ComfyUI adapter v3 PR2: real, provider-side masked
  inpainting.** Second of the three planned v3 PRs (see PR1's entry below
  for the full plan/context — same session, same backlog request).
  `ImageEditRequest` (`ai/types.ts`) gained an optional `mask?: {mimeType,
  data}` field — purely additive, confirmed Gemini/customImage's existing
  `editImage` never reads unknown fields, so no behavior change there.
  `/api/assets/edit/route.ts` already decoded the creator's painted mask
  into raw RGBA for its OWN local compositing step (this has existed since
  before this session — the mask/paint UI already worked for every
  provider, correctness enforced client/server-side regardless of provider
  masking support); it now ALSO re-encodes those same already-computed
  bytes back to PNG and forwards them to `provider.editImage(...)` as
  `mask`, reusing bytes rather than a second decode.
  `comfyui.ts` gained `buildEditWorkflow` (kept deliberately separate from
  v2's `buildWorkflow` — editing always has a source image and no target
  width/height, generation has neither guarantee) and `editImage()`,
  flipping `capabilities.supportsImageEditing: true`. LoRA-chaining logic
  was factored out of `buildWorkflow` into a shared `addLoraChain` helper
  both functions now call, rather than duplicated.
  **Two real, would-have-shipped-silently-wrong bugs caught by a
  Plan-agent design-validation pass BEFORE any of this PR's code was
  written** (not by a test afterward — there is no live ComfyUI instance
  in this environment to have caught either empirically):
  1. `LoadImageMask`'s `channel` parameter: my first draft used
     `channel: "alpha"`. `AssetDetailEditor.tsx` (the existing paint UI)
     paints opaque white strokes on an initially-transparent canvas, so
     editable pixels are alpha=255 — but ComfyUI's `"alpha"` channel mode
     computes `mask = 1 - alpha`, a legacy cutout-mask convention. That
     would have inverted polarity: ComfyUI would protect exactly the
     region the creator selected to change, and freely repaint everything
     else. Fixed to `channel: "red"` (pure pass-through, R=255→mask=1.0).
     Notably, even with this bug, the existing local compositor would
     still have clipped the output to the CREATOR's own drawn mask
     (decoded independently in the route) — so a real user would have
     seen "inpainting did nothing useful," not leaked pixels outside the
     selected region. Worth remembering as a case where the existing
     defense-in-depth (compositor never trusts the provider) turned a
     silent-wrong-output bug into a silent-no-effect one instead — better,
     but "no effect" is still a real, confusing bug for whoever hits it.
  2. Denoise value: first draft used `0.95` for the masked path by
     instinct ("close to full, but not quite"). Corrected to `1.0` to
     match ComfyUI's own official inpainting example — `SetLatentNoiseMask`
     already fully protects everything outside the mask, so the masked
     region should be discarded and resampled entirely from the
     instruction, not biased toward the original content.
  New tests: `buildEditWorkflow` unit tests (mask/no-mask graph shape,
  `channel: "red"` asserted explicitly, denoise 1.0 vs 0.6, LoRA-chain
  reuse, sampler-override reuse), an `editImage` end-to-end mocked-fetch
  test (source + mask uploaded as two SEPARATE `/upload/image` calls, each
  used by its own server-returned name), and — since `/api/assets/edit`
  had NO existing test file at all before this change, a real pre-existing
  gap, not one introduced here — a new `route.test.ts` using real `sharp`
  PNG encode/decode (not mocked) to verify the mask that reaches
  `provider.editImage(...)` actually decodes back to the same
  editable/protected shape the creator painted, at the source image's own
  pixel dimensions.
  Verified: `npm test` → 1485/1485; typecheck/lint/build clean; full
  Playwright suite passing (one unrelated pre-existing flaky drag-reorder
  test failed on the full run, passed cleanly in isolation — not
  investigated further, not something this change touched).

- **2026-09-16 — ComfyUI adapter v3 PR1: LoRA/ControlNet-model dropdown
  discovery, plus a real credential-readback bug found and fixed.** User
  asked for ControlNet, real mask/inpainting, and LoRA-from-a-list — I
  incorrectly told them no mask-paint tool existed (it does:
  `AssetDetailEditor.tsx` + `/api/assets/edit`'s local compositor, already
  provider-agnostic) before checking; corrected once verified via two
  Explore-agent passes. Given the scope (3 sub-features, one touching
  shared `ai/types.ts`), went through `EnterPlanMode` + a Plan-agent
  design-validation pass, which recommended shipping as 3 sequential PRs
  in a specific order (dropdown discovery → masked inpainting → ControlNet)
  and caught two real would-be bugs in the *next* two PRs before any code
  for them was written (`LoadImageMask`'s `channel: "alpha"` would invert
  mask polarity; `ControlNetApplyAdvanced` needs explicit
  `start_percent`/`end_percent` or ComfyUI rejects the graph) — see the
  plan file `/Users/quang/.claude/plans/luminous-sparking-wombat.md` for
  the full three-PR design; PR2/PR3 not yet built.
  This PR: `fetchObjectInfoOptions()` in `comfyui.ts` (reuses the file's
  own SSRF-guarded fetch helpers, `GET /object_info/{nodeClass}`,
  extracts a COMBO input's option array defensively); new `POST
  /api/provider/comfyui-object-info` route (`nodeClass`/`inputName`
  zod-enum-restricted, best-effort `{options: []}` on any failure, same
  philosophy as the existing `/api/provider/models` route); a "Fetch
  LoRAs" button in `AiSettingsDialog.tsx`'s LoRA rows editor populating a
  `<datalist>` (free text stays the fallback).
  **Real bug found while writing the route's own test** (not by reading
  code — the "keyless ComfyUI config" write path had already been tested,
  but never round-tripped through the READ path): `readSessionConfig` in
  `providerSession.ts` has its OWN separate `hasCredential` check, distinct
  from `resolveApiKey` (used at save time) — it never got the "comfyui has
  no built-in auth" exception `resolveApiKey` already had. Effect: a
  legitimately-saved keyless ComfyUI provider would silently read back as
  "not configured" on every subsequent page load / status check /
  generation attempt, despite saving successfully — the whole v1 feature
  would have appeared broken in real use. Fixed by adding the same
  `providerType === "comfyui"` exception to `hasCredential`; added a
  regression test that round-trips a saved config through
  `readSessionConfig` specifically (the prior test only covered
  `buildProviderConfig`, the write side) so a future edit to one check
  without the other can't silently regress again. General lesson worth
  keeping: **a config value with two independent "is this required"
  checks (one at write, one at read) needs a test exercising BOTH paths,
  not just the one that happens to be exercised while building the
  feature that introduced the exception.**
  Also hit and fixed an unrelated e2e gotcha while testing: once a `list`
  attribute is present on an input (via a populated datalist), Chromium
  changes its exposed ARIA role from `textbox` to `combobox` — same quirk
  already known from the dialogue-language field elsewhere in this file's
  e2e suite, now documented again at the LoRA-name-input call site.
  Verified: `npm test` → 1478/1478; typecheck/lint/build clean; e2e suite
  (35 tests) all passing.

- **2026-09-16 — ComfyUI adapter v2: LoRA chaining, reference-image
  (img2img), and sampler tuning (backlog #47).** User asked to "finish it
  fully" right after v1 shipped; clarified via `AskUserQuestion` into two
  parts done in order: (1) QA v1 — found and fixed a real bug (`canSave`
  wrongly required a non-empty API key even for ComfyUI, which has none;
  a first-time save of a fresh ComfyUI config could never enable the Save
  button — caught by writing the e2e test v1 was missing, not by reading
  the code) and added a Playwright scenario covering protocol selection,
  save, and Test Connection; (2) this v2 build, went through
  `EnterPlanMode` twice-over — once to draft the design, once more via a
  Plan-agent second opinion that caught a real correctness gap before any
  code was written (see below).
  New `src/server/comfyui/config.ts`: `ComfyUiExtraConfig` (steps, cfg,
  samplerName, scheduler, up to `MAX_COMFYUI_LORAS` = 4 `{name,
  strength}` entries) — a NEW, non-secret sibling to `custom?:
  CustomApiConfig` on `ProviderConfig`. Unlike backup keys, nothing here
  is a credential, so it needed no `/api/provider/*` mutation endpoint:
  it lives in the plain `ProviderConfig`/`ProviderSummary` and is
  resubmitted wholesale on every AI Settings save, exactly like
  `rotationStrategy` already is — a much simpler pattern than
  `BackupKeysList`'s live-per-row-API pattern, correctly recommended by
  the Plan-agent review over blindly mirroring `fallbackRows`'
  touched-gating (that gating exists ONLY because fallback secrets can
  never be read back; LoRA filenames aren't secret, so hydrate + resend
  unconditionally instead).
  `comfyui.ts`'s `buildWorkflow` gained: a `LoraLoader` chain (node ids
  `20`-`23`, chained from the checkpoint, each hop's model/clip output
  feeding the next — `strength_model`/`strength_clip` intentionally
  collapsed into one `strength` field per entry) that KSampler/both
  `CLIPTextEncode` nodes now read from instead of the checkpoint directly
  when present; and an img2img path (`LoadImage` id `30` → `ImageScale`
  id `32` → `VAEEncode` id `31`) used when `request.referenceImages[0]`
  exists, via a new `uploadImage()` that POSTs multipart to ComfyUI's own
  `/upload/image` FIRST (mirrors `genericRest.ts`'s `buildEditsFormData`
  Blob/FormData pattern — no manual `Content-Type`) and wires the graph
  to the **server's own returned filename**, never the client-sent one
  (ComfyUI auto-dedupes/renames on collision).
  **The correctness gap the Plan-agent review caught before any code was
  written**: the original design replaced `EmptyLatentImage` with
  `LoadImage`+`VAEEncode` for img2img but had NO width/height-resizing
  step — since nothing downstream in `ai/generate.ts` re-scales provider
  output, and `EmptyLatentImage` was the ONLY place `request.width`/
  `height` took effect in v1, removing it would have made output
  resolution silently follow the reference image's own native size
  instead of the requested size. Fixed by inserting `ImageScale` (id
  `32`) between `LoadImage` and `VAEEncode`. Caught by a validating
  Plan-agent pass BEFORE implementation, not by a test after the fact —
  worth remembering as a reason to actually use the second-opinion Plan
  agent step, not skip it for "I already know this codebase" tasks.
  Deliberate scope cut, called out explicitly per the plan (not silent):
  a ComfyUI provider configured as a *fallback*
  (`FallbackProviderConfig`) does NOT get `comfyui` extras — only v1
  defaults; commented in `providerSession.ts` and in the architecture doc.
  Tests: `comfyui.test.ts` gained `buildWorkflow` unit tests for 1- and
  4-entry LoRA chains and the img2img node substitution, plus a
  `generateImage` end-to-end test asserting the `/upload/image` →
  `/prompt` → `/history` → `/view` sequence and that the submitted
  workflow's `LoadImage` node uses the mocked upload response's name, not
  the client's. `referenceContract.test.ts` (the shared cross-adapter
  "declared reference support ⇒ image physically in the request"
  guarantee) gained ComfyUI in its capability-binding table and its own
  Contract F block. New Playwright e2e scenario covers opening "Advanced
  — ComfyUI settings", adding a LoRA row + sampler fields, saving, and
  confirming the exact payload plus re-hydration on reopen — which
  surfaced a genuine native-`<details>` gotcha: clicking an already-open
  `<details>` summary (its `open` prop was already `true` from hydrated
  non-empty state) toggles it CLOSED, not a no-op: don't click a
  disclosure whose open state is derived from data that might already be
  populated.
  Verified: `npm test` → 1468/1468 (was 1461 after v1); `npm run
  typecheck && npm run lint && npm run build` clean; full Playwright
  suite (34 tests, single worker) all passing.
  No live ComfyUI instance was reachable to verify `/upload/image`'s
  real response shape or the exact `LoraLoader`/`ImageScale` field names
  against — written defensively (a malformed node/field surfaces as
  ComfyUI's own `/prompt` 400, already handled, not silent wrong output),
  flagged explicitly in both the plan and the architecture doc as
  something to spot-check against a real instance.

- **2026-09-16 — ComfyUI adapter: local self-hosted image generation
  (backlog #46, the follow-up to the doc-only local-model commit below).**
  Went through `EnterPlanMode` given it touches `providerSession.ts`
  (security-sensitive) and adds a new provider adapter — plan approved,
  see `/Users/quang/.claude/plans/luminous-sparking-wombat.md`. New
  `src/ai/providers/comfyui.ts`: a dedicated CODED adapter
  (`providerType: "comfyui"`), not a `"custom"` declarative config —
  confirmed by reading `customApi/{config,execute,jsonPath,template}.ts`
  that Custom API genuinely can't express ComfyUI's protocol: (1)
  `GET /history/{prompt_id}` nests its result under a key EQUAL TO the
  submitted `prompt_id` (a hyphenated UUID), and `jsonPath.ts`'s
  `getAtPath` path grammar only parses plain identifier keys + numeric
  `[N]` indices — a hyphenated dynamic key cannot be expressed as a static
  path at all; (2) a real ComfyUI workflow graph is several KB, too big
  for the 6000-char request-template cap or the ~3500-char total cookie
  budget. Fix: `pollHistory` reads the dynamic key via plain object
  property access (`body[promptId]`), never `getAtPath`; the workflow
  graph (standard checkpoint-only txt2img: CheckpointLoaderSimple →
  CLIPTextEncode ×2 → EmptyLatentImage → KSampler → VAEDecode → SaveImage,
  fixed node ids) is built server-side from typed fields
  (`buildWorkflow`), never accepted as user-supplied JSON — sidesteps the
  cookie-size problem entirely. v1 scope deliberately excludes LoRA and
  reference-image/img2img support (`supportsReferenceImage: false`,
  same honest-capability pattern as `genericRest.ts`) and UI-exposed
  sampler tuning (fixed steps/cfg/sampler defaults) — flagged in the plan
  as follow-ups, not started.
  Three small additive changes to `server/providerSession.ts`: `"comfyui"`
  added to `imageTypes` only (image-gen-only, no agent/background);
  `DEFAULT_BASE_URLS.comfyui = "http://127.0.0.1:8188"`; `resolveApiKey`
  now takes `providerType` (was `isCustom`) and also allows a missing key
  when `providerType === "comfyui"` — ComfyUI has no built-in auth (an
  optional key, if set, is sent as `Authorization: Bearer` for
  reverse-proxied setups). `providerRegistry.ts` gained one switch case.
  `AiSettingsDialog.tsx`: one new `IMAGE_PROTOCOLS` entry — confirmed by
  reading the render logic that any non-`"custom"` `providerType` already
  renders the shared simple Base URL/API key/Model/Test/Save form with no
  protocol-specific JSX needed — plus two small hint lines (ALLOW_PRIVATE_
  NETWORKS reminder under Base URL, "checkpoint filename" hint under
  Model) copying the existing `openai-compatible` local-server note's
  pattern.
  **Test-writing gotcha hit and fixed**: the first draft of
  `comfyui.test.ts` used `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`
  to skip the poll loop's real 2s/180s delays — 4 of 6 async tests hung
  until vitest's own 5000ms wall-clock test timeout, and the 5th produced
  the wrong error message (an `outboundFetch`-internal 90s abort timer
  fired instead of `pollHistory`'s own 180s deadline) after a single large
  `advanceTimersByTimeAsync(200_000)` jump. Root cause never fully pinned
  down (suspected interaction between fake timers and `outboundFetch`'s
  real `dns.promises.lookup()` SSRF check not draining cleanly through
  `advanceTimersByTimeAsync`'s microtask-flush model) — rather than debug
  the interaction further, added optional `pollIntervalMs`/`pollTimeoutMs`
  overrides to the adapter's own (non-cookie, adapter-local) config type,
  defaulting to the real 2s/180s in production, and rewrote all tests to
  use tiny real values (5–200ms) with genuinely real timers instead of
  fake ones — same precedent as `customApi`'s own already-configurable
  `pollingSchema.intervalMs/timeoutMs`. Fixed the flaky/hanging behavior
  completely; full suite (49 tests across the 3 touched files) now runs
  in ~230ms instead of hanging.
  Docs: `docs/HOW_TO_RUN.md` §5b (both VN/EN) — replaced the earlier "not
  fully supported yet" ComfyUI row with real setup instructions;
  `manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md` — added a "ComfyUI"
  subsection under "Implemented adapters" and rewrote the "Async
  providers" section (added in the previous doc-only commit) to describe
  the limitation as resolved via a dedicated coded adapter rather than an
  open gap.
  Verified: `npm test` → 1461/1461 (was 1447 before this feature);
  `npm run typecheck && npm run lint && npm run build` → clean (same 4
  pre-existing unrelated warnings as always).

- **2026-09-16 — Documented self-hosted/local AI model usage (Ollama, LM
  Studio, Automatic1111); confirmed ComfyUI needs a dedicated adapter, not
  documented as supported.** Followed an audit of
  `ahmet360/manga-studio` (a Python/FastAPI + local ComfyUI manga pipeline)
  that found nothing else worth porting — architectures are too different
  (local GPU orchestration vs. cloud BYOK SaaS) — after which the user
  asked for Kumanga to also support a self-hosted local mode. Investigation
  found the infrastructure already existed and just needed documenting:
  `ALLOW_PRIVATE_NETWORKS=1` (`server/outboundFetch.ts`) plus the existing
  OpenAI-compatible provider type already lets the Manga Agent point at
  Ollama (`http://localhost:11434/v1`) or LM Studio
  (`http://localhost:1234/v1`) with zero code changes, and the existing
  Custom API provider (sync, base64 response) already lets image generation
  point at Automatic1111's `/sdapi/v1/txt2img` the same way. Added a new
  §5b to `docs/HOW_TO_RUN.md` (both VN and EN) with exact base
  URLs/config per server, updated the troubleshooting bullet to point at
  it, and added a technical note to `manga-studio/docs/
  AI_PROVIDER_ARCHITECTURE.md`'s "Async providers" section. Checked
  ComfyUI specifically and found it does NOT fit today's declarative
  Custom API polling: `/history/{prompt_id}`'s result is nested under a
  key equal to the submitted `prompt_id` itself (a dynamic path segment),
  but `customApi/config.ts`'s `pollingSchema.statusPath`/`resultPath` are
  fixed paths with no `{{taskId}}` interpolation support (only
  `statusUrlTemplate` has that). Documented this limitation explicitly
  rather than claiming ComfyUI works when it doesn't; added backlog #46
  for the dedicated adapter this needs, deliberately not started this
  session (user's own sequencing: docs first, then scope ComfyUI
  separately).

- **2026-09-16 — Rich per-key rotation management in AI Settings, Phase 1
  of 2 (weight, enable/disable, and per-key test/delete/reorder for the
  primary provider's backup keys).** Prompted by a screenshot of another
  app's provider panel (weight per key, per-key Test button, reorder/
  delete, "Test all keys"). Went through `EnterPlanMode` given the size and
  that it touches `server/providerSession.ts` (explicitly security-
  sensitive per `CLAUDE.md`) — the approved plan split the ask into three
  tiers the user picked all of, phased as: Phase 1 (tiers 1+2, shipped
  here) now, Phase 2 (tier 3 — flattening the primary key and fallback
  providers into one list of equal blocks) deferred as its own future
  scoping pass, since it touches every adapter call site that reads
  `config.apiKey` directly and is a materially different risk profile than
  Phase 1's self-contained data-model change.

  Root constraint that shaped the whole design, confirmed by reading the
  actual storage: the ENTIRE provider config is one encrypted JSON blob in
  ONE HttpOnly cookie (~3.5KB budget, no database), and a stored secret is
  never sent back to the browser once saved. So "per-key test/delete/
  reorder" could not mean "the client holds each key and acts on it" — it
  had to mean new SERVER actions that resolve a key from the ALREADY-
  DECRYPTED session config in memory, addressed by ARRAY INDEX, never by
  value.

  `server/providerSession.ts`: `backupApiKeys` changes from `string[]` to
  `BackupKeyEntry[]` (`{key, weight?, enabled?}`) — a real breaking shape
  change for cookies already in the wild, handled the same way
  `domain/bubbleStyles.ts`'s `normalizeBubbleStyle` handles old/foreign
  document data: `readSessionConfig` coerces a legacy plain-string entry
  into `{key: entry, weight: 1, enabled: true}` on read, so an existing
  session keeps working unchanged and the next save persists the richer
  shape. `server/providerRotation.ts`: `buildCandidates` now excludes
  `enabled: false` entries from the pool ENTIRELY (not just deprioritizes
  them) and propagates each entry's `weight` onto its flattened candidate;
  `orderCandidates`'s `"random"` strategy replaced a uniform Fisher-Yates
  with a real weighted-random-without-replacement draw
  (`weightedShuffle`) — mathematically equivalent to the old uniform
  shuffle when every weight is equal (the untouched-by-a-creator default),
  so nothing changes unless someone actually sets a weight.

  Two new routes, both composition of already-existing pieces, no new
  provider-adapter code: `POST /api/provider/backup-keys` (one route, four
  actions — add/update/remove/reorder — via a zod discriminated union,
  mirroring `config/route.ts`'s read → mutate → rebuild → write shape,
  scoped to one array instead of the whole config) and
  `POST /api/provider/test-key` (tests the primary or one backup key BY
  INDEX, reusing the exact `createAgentProvider(...).testConnection()` /
  `createImageProvider` / background-removal pattern
  `app/api/provider/test/route.ts` already had, just resolving `apiKey`
  from a specific slot in the session's own decrypted config instead of
  always the primary).

  `AiSettingsDialog.tsx`: the old "one per line" backup-keys textarea is
  gone, replaced by a new `BackupKeysList` — live rows (masked placeholder,
  weight, enabled checkbox, Test, reorder, delete) that each act
  IMMEDIATELY through the two new routes rather than batching into the
  dialog's big Save button, since none of these mutations need a secret
  retyped.

  **Two real bugs caught building this, both from real Playwright
  failures, not code review:**
  1. A shared `vi.spyOn(Math, "random")` + `afterEach(() => spy.mockRestore())`
     pattern in `providerRotation.test.ts` silently broke the SECOND test
     added to that describe block — `mockRestore()` fully detaches a spy,
     so a later test's `.mockReturnValue()` on the same handle becomes a
     no-op and real, non-deterministic `Math.random()` runs instead. A
     "deterministic" test kept "passing" against genuine randomness until
     a repeated-run check caught the actual value changing between runs.
     Fixed with `mockReset()` between tests (clears the return value,
     keeps the spy installed) and `afterAll(() => spy.mockRestore())` for
     real cleanup. Worth remembering as a general vitest/tinyspy gotcha,
     not a one-off.
  2. `BackupKeysList`'s checkbox/weight inputs are fully controlled from
     `summary.backupKeys`, which only updates once `onChanged()`'s GET
     round-trips. Setting `busyIndex` (to disable the row mid-request)
     forces an immediate re-render against the STILL-STALE summary —
     React then syncs the controlled checkbox straight back to its old
     value, undoing the click before the real update ever lands. Caught by
     Playwright's `.uncheck()` literally failing with "did not change its
     state". Fixed with a small local `overrides` map applied optimistically
     at the same synchronous point `busyIndex` is set, cleared only after
     `onChanged()` (now returning the real fetch promise, not fire-and-
     forget) has actually resolved — the same general shape as this
     session's earlier `TextStylePresetControls`/`ContinuesFromControl`
     zustand-selector render-loop bug (2026-09-16, same day): a controlled
     UI value must never be driven by data that hasn't caught up yet.

  Verified: full unit suite (1447/1447 — new/extended cases in
  `providerSession.test.ts` — legacy-string coercion, weight/enabled
  round-trip, an 8-key cookie-size budget pin — and `providerRotation.test.ts`
  — enabled=false exclusion, a 500-trial statistical weighted-selection
  test, the two rewritten determinism-guard cases — plus full route tests
  for both new endpoints proving no key value ever appears in a response),
  clean typecheck/lint/build, and a new Playwright e2e test exercising the
  complete row lifecycle (add, weight edit, enable/disable, per-key test,
  reorder, remove, "Test all keys") against mocked endpoints.

- **2026-09-16 — The Manga Agent can split, merge and add custom panels,
  not just pick from 7 fixed layout presets or reshape one panel's
  polygon.** From a `Barun-2005/manga-gen-ai-pipeline` research pass — its
  "LLM picks from 15+ narrative-matched layout templates" claim turned out
  to expose a REAL gap once checked against this codebase's actual agent
  tool vocabulary: `agent-v2/process/panelProcess.ts` only wrapped
  `set-page-layout` (7 presets) and `reshape-panel` (edit one existing
  panel's polygon) as agent tools — `split-panel`/`merge-panels`/
  `add-custom-panel` were already real, tested domain commands the MANUAL
  UI could call (the "Panel" button, split/merge controls) but were never
  exposed to the Director at all. (Its other two claimed capabilities —
  "Character DNA" text-trait injection and face-detection-aware bubble
  placement — were also checked: the first is a weaker, text-only
  substitute for something Kumanga already does better with real
  reference-image conditioning; the second is real and currently missing
  here (`FocusRegion{kind:"face"}` exists in the schema but is written by
  nothing, confirmed zero producers — bubble placement uses a fixed
  `y = 18% of panel height` heuristic, not real face position) but was
  correctly scoped as a separate, bigger, not-yet-approved item.)

  Added three tool wrappers (`doSplitPanel`, `doMergePanels`,
  `doAddCustomPanel` in `panelProcess.ts`) following the EXACT existing
  `doSetPageLayout`/`doReshapePanel` pattern: resolve panel NUMBER → panel
  ID via `ctx.panelIdByNumber`, dispatch the existing domain command
  unchanged. Registered as `split_panel`/`merge_panels`/`add_custom_panel`
  in `agent/tools/schemas.ts` (zod arg schemas, `TOOL_DOCS` entries,
  `describeStep` cases in `orchestrator.ts`) — no new domain code at all,
  purely wiring already-tested `panelOps.ts` functions into the Director's
  vocabulary.

  The one genuinely tricky part was `validateStepScope`'s scope-security
  rules, which are keyed by tool name and had to be extended correctly for
  three tools with three different argument shapes: `split_panel` (one
  `panel` field) slotted into the existing generic `PANEL_TOOLS` check
  exactly like `reshape_panel` already does; `add_custom_panel` (no panel
  field — it ADDS one) got its own explicit rejection under
  `selected-panel` scope, mirroring how `set_page_layout` is already
  rejected there (a page-level change is never licensed by a scope that
  only covers editing one existing panel); `merge_panels` (two panel
  fields, `panelA`/`panelB`, neither privileged) needed a new rule —
  allowed under `selected-panel` scope when EITHER side matches
  `scope.panelNumber`, since unlike `reuse_scene_background` (which always
  has one clear "target" side) a merge has no such asymmetry. All three
  are also in `PANEL_LEVEL_TOOLS`, so a narrower `selected-object` scope
  (one character/item selected, not a whole panel) rejects them outright —
  selecting one thing never licenses restructuring the panel it lives in.

  Documented in `TOOL_DOCS` that splitting/merging shifts every LATER
  panel's number for the rest of the same plan (the new panel from a split
  is inserted immediately after the source panel — confirmed directly in
  `panelOps.ts`'s `splitPanel`, not assumed), since `panelIdByNumber`
  resolves against the live, current document at each step — the model
  needs to either do all structural steps before any panel-numbered
  placement steps, or account for the shift explicitly.

  Verified: full unit suite (1425/1425 — 13 new scope-validation cases in
  `agent/scope.test.ts` covering all three tools under both scope kinds,
  including the "either side of a merge" rule and an out-of-range panel
  number, plus 4 new tests in a new `agent-v2/panelStructureTools.test.ts`
  that execute real plans through `executePlan` against a real store — not
  just schema validation — including one that actually places a bubble on
  the SHIFTED panel number after a split to prove the renumbering claim in
  the docs is true, not just asserted), clean typecheck/lint/build. No e2e
  run for this one — nothing UI-visible changed; the new unit tests already
  exercise real domain-command dispatch end to end, which is exactly what
  CLAUDE.md's e2e guidance exists to cover for changes a unit test can't see.

- **2026-09-16 — A brand-new character can start from a base/inspiration
  reference image plus a text prompt, not text alone.** Prompted by a
  `RemiPelloux/agent-mangaka-forge` research pass (a Codex-skill folder
  convention for character consistency — verified its core idea, keeping
  persistent reference images so an AI doesn't drift a recurring
  character's design, is already solved in Kumanga's `Character`/
  `characterStates`/`resolveCharacterIdentityReference` domain model, and
  solved more robustly: deterministically in code
  (`resolveOrGenerateState`'s `generateIfMissing`), not via a markdown rule
  an LLM has to remember to follow — so nothing from that project's actual
  mechanism was adopted). Answering the user's own follow-up question
  ("can I use an existing character from another series as a base image,
  then prompt to create a new design from it") surfaced a REAL, separate
  gap: `GeneratorDialog.tsx`'s `ReferencePicker` (upload/pick an image +
  say what it's for: style / layout / loose inspiration + text prompt →
  generate something NEW) already existed for Scene/Object/Background/
  Prop/Tone generation, but was hard-gated OFF for character generation
  (`!isCharacterType`) — the ONLY image path for a character was either
  pure text-to-image, or uploading a file that became the reference AS-IS
  with no AI transformation at all (`CharactersTab.tsx`'s "Reference Only"
  upload, a completely different, still-valid code path left untouched).

  Fixed narrowly: `showBaseImagePicker = request.assetType === "character"
  && !referenceAsset` — true only for a character's FIRST-EVER reference
  (before it has one), never for character-pose/character-expression or a
  character that already has a canonical reference, which keep using
  their own EXISTING selector (`references`/`referenceChoice`, built from
  the state graph — "which past render of THIS character anchors
  identity," a different question entirely from "what external image
  should inspire a brand new one"). When true, the same `ReferencePicker`
  component renders (passing `category: "character"`, which the
  component's existing category check already handles correctly — no
  "layout" option, since that only makes sense for backgrounds) and its
  chosen image flows into `generate()`'s `referenceAssets` alongside the
  existing scene-reference path. Required zero changes to
  `ai/promptTemplates.ts`: the reference-intent sentence ("use this as
  loose inspiration only, don't copy it directly") was already being
  folded into the `description` field before reaching
  `buildAssetPrompt`, and the `"character"` prompt case already includes
  `description` — the plumbing for "reference image + free text" was
  already assetType-agnostic once the UI stopped blocking it.

  Verified: full unit suite (1415/1415, unaffected — this is a UI-only
  change with no existing test file for `GeneratorDialog.tsx`, matching
  every other top-level dialog in this codebase), clean typecheck/lint/
  build, and a new Playwright e2e test (create a character with the plain
  "Create" button so it starts with zero assets → "Generate character
  reference" → confirms the base-image picker actually renders, uploads
  an inspiration image, confirms the "Use reference for" dropdown has no
  "layout" option, generates, and confirms the reference image really
  reached the provider via the mocked `/api/generate` request body — not
  silently dropped because the request happened to be `assetType:
  "character"`) passing on its first real run.

- **2026-09-16 — Five features from a comfyui-comic-creator competitive
  audit (Tier A, all approved by the user together): whole-project PDF/EPUB
  export, linked/extended speech bubbles, reusable text style presets,
  traditional Japanese tone patterns, and SVG panel-layout import.**
  Researched `github.com/ketle-man/comfyui-comic-creator` (a ComfyUI-based
  comic/manga production tool) and cross-checked every candidate gap
  against the actual codebase before proposing anything — two of the five
  originally-proposed items (bomb/cloud bubble shapes, "concentration
  lines") turned out to be **already fully implemented**
  (`BubbleStyle.shape` already has `spiky`/`cloud`/`wavy`/`jagged`/
  `scalloped`, all rendered in `render/BubbleNode.tsx`; `EffectKind`
  already has `focus-lines`/`impact-burst`, fully modeled in
  `domain/effects.ts`) and were dropped before implementation rather than
  duplicated — caught by reading `render/BubbleNode.tsx`'s and
  `domain/effects.ts`'s actual switch cases, not by trusting the earlier
  analysis pass's guess.

  **PDF/EPUB export overrides an old "deliberately not built" note** — see
  the "Known gotchas"/"Deliberately not built" sections below, updated in
  the same edit as this entry. The old rejection was scoped to "PDF instead
  of CBZ as the interchange format" (CBZ remains that, unchanged); this
  adds PDF/EPUB as ADDITIONAL formats for a different, real need (print-shop
  and portfolio/publisher submissions ask for PDF by name; digital
  storefronts/e-readers want EPUB) that CBZ never served. `export/
  exportBookPdf.ts` wraps `jspdf` (new dependency) around the exact same
  `captureAllPages` pipeline every other multi-page exporter already uses,
  computing page pixel size directly from `ProjectSettings.pageWidth/
  pageHeight * scale` rather than decoding each captured image just to ask
  its own dimensions back. `export/exportBookEpub.ts` hand-builds a
  fixed-layout EPUB3 directly on `jszip` (already a dependency, used for
  CBZ) rather than pulling in an EPUB-authoring library — the format is a
  handful of small, well-specified XML/XHTML files, and a manga's structure
  (a flat, ordered list of full-page images) needs none of a general
  library's text-flow/footnote machinery. `dc:language` is best-effort
  mapped from `ProjectSettings.dialogueLanguage`'s free-text name to a
  BCP-47 code via a small lookup table (falls back to "en" for anything
  unrecognized or unset) rather than writing the free-text name straight
  into a field that expects a real language code.

  **Linked/extended bubbles**: `SpeechBubbleItem.continuesFromItemId?: ID`
  (a plain optional field — no schema bump, same as `warp` before it) names
  another bubble in the SAME panel this one continues, for one line of
  dialogue split across two balloons. Validated in `itemOps.ts`'s
  `updateBubble` (target must exist, must be a bubble, must be in the same
  panel, cannot be itself) but deliberately has NO cleanup on delete — a
  dangling reference after the target is deleted just stops resolving,
  exactly like every other cross-item reference already in this codebase
  (`targetCharacterId`, `targetItemId`); confirmed `removeItem` never
  cleaned up any of those either before adding this one, so this isn't a
  new gap, it's the existing convention. `render/BubbleNode.tsx`'s new
  `NeckConnector` draws a ribbon between the two bubbles' centers in the
  CONTINUING bubble's own style — an approximation (ignores rotation, same
  spirit as `TailShape`'s existing "0.75 factor" edge-point approximation)
  computed from data `PanelRenderer.tsx`'s `renderItem` already has on hand
  (the full `doc.items` map), so no new prop-drilling was needed beyond
  passing the resolved sibling item down as `linkedFrom`.

  **Text style presets**: new top-level `ProjectDocument.textStylePresets:
  Record<ID, TextStylePreset>` collection — DOES need a schema bump (v15→16,
  migration `doc.textStylePresets ?? {}`) because it's a brand new
  top-level Record, not an optional field on an existing object (matches
  the `chapters`/`fonts`/`puppets` precedent exactly, not the `warp`
  precedent). A preset is an explicit snapshot copy applied via the
  existing `update-bubble` command (`{fontSize, style: {...}}` in one
  dispatch, same shape the auto-fit path already uses) — deliberately NOT
  a live reference, so editing a preset later never silently changes
  bubbles that already used it.

  **Traditional Japanese tone patterns** (asanoha/ichimatsu/shippo/uroko):
  extends `ProceduralToneType` (no schema bump — `normalizeToneParams`
  already tolerates an unknown type by falling back to `"dot"`, same
  forward-compat contract every other tone type gets) and `render/
  tonePainter.ts`'s `paintTone` switch with four new draw functions,
  filed under the `TONE_FAMILIES`' pre-existing but previously-EMPTY
  `"decorative"` family. Deliberately simple stroke/fill approximations
  (a six-spoke star per grid point for asanoha, alternating filled cells
  for ichimatsu, stroked overlapping circles for shippo, alternating
  triangles for uroko) rather than historically exact weaves — same
  "parameters, not a bitmap" contract, same "close enough, simple code"
  spirit as the existing `wavyPoints`/`starburstPoints` bubble-shape
  approximations.

  **SVG panel-layout import**: `domain/importLayoutSvg.ts`'s
  `parseLayoutSvg` is a regex-based scan (deliberately not a real
  DOMParser/XML parse — this file needs to run and be unit-tested in plain
  Node, which has no DOM) that reads an SVG's `viewBox` (or `width`/
  `height` as a fallback) and every `<rect>` element, normalizing each into
  the same `{x,y,width,height}` shape `domain/layouts.ts`'s built-in
  presets already produce. Wired into the existing `set-page-layout`/
  `reset-page-layout` commands by widening their `layout` field from
  `LayoutPresetId` to `LayoutPresetId | Rect[]` (`pageOps.ts`'s
  `applyLayout` just branches on `Array.isArray`) — reuses ALL of the
  existing content-preserving re-homing logic for free, rather than adding
  a parallel "custom layout" command. Only `<rect>` shapes are read — a
  layout drawn as polygons/paths is a disclosed limitation, not a bug.

  **A real bug caught mid-session, not shipped**: the first draft of two
  new Inspector controls (`TextStylePresetControls`, `ContinuesFromControl`
  in `InspectorPanel.tsx`) used a zustand selector that built a FRESH array
  every call (`(s) => Object.values(s.doc.textStylePresets)`, and similarly
  a `.map().filter()` chain for bubble siblings). Since the returned
  reference never `Object.is`-equals the previous one, this free-runs into
  a render loop and froze the whole page — surfaced as 6 unrelated
  Playwright tests suddenly timing out on completely different actions
  ("Edit text" button never appearing, "Appearance" section never
  clickable), which was initially confusing until the common thread (every
  failure involved selecting a bubble, which mounts these two components)
  pointed at the actual cause. Fixed by following the EXACT pattern already
  used elsewhere in the same file (`BubbleStyleControls`'s `masks`): select
  the STABLE underlying object/map via the zustand selector, then derive
  arrays in the component body afterward, never inside the selector
  callback itself. Worth remembering as a general zustand rule, not just a
  one-off — see "Known gotchas" below.

  Verified: `npm test` (1415/1415 — new unit tests added for
  `textStylePresets.ts`'s commands, `updateBubble`'s `continuesFromItemId`
  validation, `pageOps.ts`'s literal-`Rect[]` layout path, `parseLayoutSvg`,
  the four new tone painters, and the EPUB helper functions), clean
  typecheck/lint/build, and the full 30-test Playwright suite passing
  reliably in isolation (a handful of full-sequential-run flakes were
  chased down and confirmed pre-existing/environmental — a Next.js dev
  overlay badge intermittently colliding with the "Add page" button's
  screen position, and worker-concurrency timing — reproducing on
  DIFFERENT, unrelated tests each run and vanishing every time in isolation
  or on a clean single-worker pass, with zero diff to `next.config.ts`,
  `playwright.config.ts`, or the affected components).

- **2026-09-16 — Translate Project: AI-translate an already-lettered
  project's dialogue into another language (backlog #28).** From a fresh
  audit specifically for AI-powered (not general UI) gaps —
  `ProjectSettings.dialogueLanguage` only ever governed what language NEW
  Director-composed dialogue was written in; nothing read EXISTING bubble
  text and translated it. Verified absent by reading code, not guessing,
  before starting.

  Deliberately produces a NEW, separate project rather than rewriting the
  current one in place — a real localization workflow keeps the master-
  language project and generates a per-locale copy, and this avoids any
  risk of a bad/partial translation clobbering a creator's own wording
  with no way back beyond Undo. `services/translateProject.ts` batches
  every non-empty bubble in scope (30 per request — one call per batch,
  not per bubble, matching Novel Import's own chunking pacing), calls the
  new `/api/agent/translate` route, and for each returned translation
  calls `render/bubbleFit.ts`'s `fitBubbleHeight` (backlog #24) before
  applying `{text, height}` via `domain/itemOps.ts`'s `updateBubble` —
  called directly on a plain `ProjectDocument`, NOT through the editor
  store's `dispatch`, since the document being translated isn't open
  anywhere yet. The dialog then hands the fully-translated document to
  `projectsStore.ts`'s `importDocument` (the same "commit as a genuinely
  new project" tail #21's full-backup import already added) and opens it.

  New route (`app/api/agent/translate/route.ts`) is a near-exact structural
  copy of `parse-novel/route.ts`'s pattern: `resolveProvider(request,
  "agent")` → `createAgentProvider(...).completeJson(...)` → `parseModelJson`
  + a small zod schema (`agent/translation/schema.ts`) → `recordLiveCall`
  on both the success and failure paths. Gets provider rotation/fallback
  "for free" the same way, since `createAgentProvider` always wraps with
  it. One id in the model's response missing (or the whole batch failing)
  never sinks the run: a missing id just leaves that bubble with its
  original text (`skippedCount`, surfaced to the creator in the result
  message), matching this session's established "one bad item, not the
  whole operation" philosophy (#21's per-asset-URL tolerance, #18's
  per-candidate independence).

  Deliberately NOT the same thing as the Director's literal-lock rule
  ("never translate exact quoted dialogue" — `agent-v3/director/
  systemPrompt.ts` Rule 5): that rule protects a creator's own wording
  from being silently reworded while composing NEW pages; this is a
  separate, explicitly creator-INITIATED action whose entire point is
  producing a translation, so the two don't actually conflict. Also does
  NOT translate SFX/onomatopoeia baked into generated images (a
  MangaLanguageAsset's pixels, not bubble text) — flagged as a real,
  disclosed limitation, not silently missed: that would need regenerating
  the image, a materially bigger feature.

  Verified with unit tests for the prompt builder, the output schema, the
  new route (mocking `createAgentProvider`/`resolveProvider`, mirroring
  `remove-background/route.test.ts`'s pattern — no prior test existed for
  ANY `agent/*` route, so this sets the precedent), and the service's own
  batching/scope-filtering/skip-on-missing-id logic (with `bubbleFit.ts`
  mocked out, since real Konva measurement needs a canvas this project's
  Node vitest environment doesn't have). Plus a real-browser Playwright
  test — mocking only `/api/agent/translate` — that types real dialogue,
  translates the whole project, confirms a second, distinctly-named
  project now exists alongside the untouched original, and reads the
  new project's saved document straight out of IndexedDB to confirm the
  actual translated text landed, rather than just checking the UI didn't
  throw.

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
levels vary a lot within a single bullet). **This table is a point-in-time
snapshot, not live status** — several rows are already outdated by later
Timeline entries (e.g. webtoon-strip export shipped 2026-09-15/16; PDF/EPUB
export shipped 2026-09-16, see "Deliberately not built" below for the
current, corrected framing of that decision). Check the Timeline for
current status rather than trusting this table's wording on its own:

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

**Tier 11 — audited specifically for AI-powered gaps (2026-09-16), verified
by reading code rather than guessing — both confirmed genuinely, fully
absent, not partial**
28. ~~Translate an already-lettered project's dialogue into another
    language, producing a new duplicated project~~ — **done 2026-09-16**,
    see Timeline. `ProjectSettings.dialogueLanguage` only ever governed
    what language NEW Director-composed dialogue was written in; nothing
    read existing bubble text and translated it. Builds directly on #24's
    `bubbleFit.ts` (auto-fit needs no changes to serve a translated string
    instead of a typed one) and on the same agent-provider-calling pattern
    Novel Import's parse step already established.
29. AI upscaling for real print resolution — not done, not started. Print
    Export (#16/#26) only ever applies a geometric canvas scale; there is
    no AI super-resolution capability anywhere in the codebase (no
    provider, no capability flag, no route) — confirmed the existing
    `assets/edit` local-edit route can't be repurposed for this either,
    since it forcibly resizes whatever a provider returns back down to
    the SOURCE's own dimensions before compositing. Needs a new provider
    capability, higher effort/risk than #28.

**Tier A — from a `ketle-man/comfyui-comic-creator` competitive audit
(2026-09-16), all five approved by the user together as "Tier A"**
30. ~~Whole-project PDF export~~ — **done 2026-09-16**, see Timeline.
    Overrides the older "PDF export: rejected" note below — see that
    note's own update for why this isn't a reversal of the same decision.
31. ~~Whole-project EPUB export~~ — **done 2026-09-16**, see Timeline.
32. ~~Linked/extended speech bubbles (`continuesFromItemId`) for dialogue
    split across two balloons~~ — **done 2026-09-16**, see Timeline.
33. ~~Reusable text style presets~~ — **done 2026-09-16**, see Timeline.
34. ~~Traditional Japanese tone patterns (asanoha/ichimatsu/shippo/uroko)~~
    — **done 2026-09-16**, see Timeline.
35. ~~SVG panel-layout import~~ — **done 2026-09-16**, see Timeline.

**Tier B — from the same audit, saved to the backlog (not implemented) per
the user's explicit "ghi vào tier B vào memory" instruction — these are
proposals only, not yet verified against the code the way Tier A's items
were before being scoped, so treat the effort estimates as rough**
36. Layer groups/folders within a panel (nested item organization). No
    domain support exists today (confirmed absent — no `groupId`/folder
    concept anywhere in `domain/` or `editor/`). Needs a domain model change
    (a tree instead of a flat item list per panel) plus a Layers-panel UI
    for it; bigger than any single Tier A item.
37. Basic freehand brush/paint tool with a mask layer, for hand-correcting
    AI-generated art. No freehand drawing capability exists today — this
    would be a genuinely new kind of editor interaction (pointer-tracked
    strokes), not an extension of the existing "compose pre-made assets"
    model. Real value (fixing small AI-generation artifacts by hand without
    leaving the app), but a materially different scope than a domain-model
    addition.
38. Basic vector shape tool (line/polygon) for custom panel borders or
    hand-drawn speed lines. Would need a new `PanelItem` kind plus a Konva
    renderer for it — moderate effort if scoped narrowly to a couple of
    primitives, but worth confirming the actual creator need first rather
    than building it speculatively.
39. PSD import/export, for round-tripping a page through Photoshop for
    finishing touches. Real value for pro workflows, but PSD is a complex
    binary format to parse safely — should come after the above, and
    probably as its own scoping conversation given the parsing risk.
40. A manual, panel-by-panel script/screenplay editor (Work → Synopsis →
    Plot → Page → Panel, writing scene/dialogue by hand and "flowing" it
    into the existing layout system) as an alternative to Novel Import's
    AI-first, prose-driven flow. Would reuse the existing layout/Manga
    Agent pipeline as its backend; the new part is purely the manual
    authoring UI.

**Tier from a `Barun-2005/manga-gen-ai-pipeline` competitive audit
(2026-09-16), verified by reading the actual agent tool vocabulary rather
than guessing**
41. ~~Expose `split-panel`/`merge-panels`/`add-custom-panel` (already real,
    tested domain commands the manual UI could call) to the Manga Agent's
    own tool vocabulary~~ — **done 2026-09-16**, see Timeline. The Director
    was limited to picking one of 7 layout presets or reshaping a single
    existing panel, even though a human using the manual UI already had
    all three of these.
42. Face-position-aware bubble placement. Confirmed real and currently
    missing (agent-placed bubbles use a fixed `y = 18%` heuristic; the
    schema's `FocusRegion{kind:"face"}` slot exists but nothing writes it —
    zero producers found). Two credible paths, increasing effort: (a) use
    the character instance's already-known bounding box in the panel to
    bias placement away from its upper portion — no new capability needed,
    just a better heuristic; (b) real face detection (a CV step after
    generation, closer to what `manga-gen-ai-pipeline` actually does) —
    meaningfully bigger, a new dependency and a new pipeline stage. Not
    started; needs the user to choose which path before implementation.
43. "Character DNA" (an LLM pass that extracts structured visual traits
    from a character's description and re-injects them into every
    generation prompt) — considered and NOT recommended. Kumanga's
    reference-image conditioning is already the stronger identity anchor,
    and the prompt already includes both the raw appearance text and an
    explicit "preserve this identity" instruction when a reference is
    present (`ai/promptTemplates.ts`'s `buildCharacterStatePrompt`). An
    extra LLM call per character for marginal, unclear benefit.

**Rich rotation management (2026-09-16 plan, approved by the user)**
44. ~~Phase 1: weight, enable/disable, and per-key test/delete/reorder for
    the primary provider's backup keys~~ — **done 2026-09-16**, see
    Timeline. See `/Users/quang/.claude/plans/luminous-sparking-wombat.md`
    for the full approved plan (both phases).
45. Phase 2: flatten the primary key and fallback providers into one flat
    list of equal, repeatable provider blocks (each owning its own
    Phase-1 `BackupKeysList`) — deliberately NOT started. Needs its own
    scoping pass: touches every call site that reads `ProviderConfig.apiKey`
    directly (every adapter, `buildCandidates`, the save/test routes), a
    materially bigger and riskier refactor of security-sensitive code than
    Phase 1's self-contained data-model change. Do not start without the
    user explicitly re-authorizing this specific phase.

**Self-hosted local AI (2026-09-16, user asked "muốn kumanga cũng có chế độ
self host local" after an ahmet360/manga-studio audit found nothing else
worth porting)**
46. ~~ComfyUI adapter for local image generation~~ — **done 2026-09-16**,
    see Timeline. Ollama/LM Studio (agent) and Automatic1111 (image)
    already worked via the existing OpenAI-compatible/Custom API provider
    types + `ALLOW_PRIVATE_NETWORKS=1` (documented in `docs/HOW_TO_RUN.md`
    §5b). ComfyUI specifically needed a dedicated coded adapter
    (`src/ai/providers/comfyui.ts`, `providerType: "comfyui"`) rather than
    a `"custom"` declarative config — Custom API's static path grammar
    can't express ComfyUI's dynamic `prompt_id`-keyed history response,
    and a real workflow graph doesn't fit the cookie-size budget. v1 is
    checkpoint-only txt2img (no LoRA, no reference-image/img2img) —
    those remain explicit future follow-ups, not started.
47. ~~ComfyUI adapter v2: LoRA chaining, reference-image/img2img support,
    and UI-exposed sampler/steps/cfg tuning~~ — **done 2026-09-16**, see
    Timeline. Sampler/LoRA settings live in a new non-secret
    `ProviderConfig.comfyui` field (no cookie-size problem — nothing here
    is a full workflow graph). Deliberate scope cut: a ComfyUI provider
    configured as a *fallback* does not get `comfyui` extras, only v1
    defaults (not fixed, not silent — commented in `providerSession.ts`).
48. ~~ComfyUI adapter v3: LoRA/ControlNet-model dropdown discovery, real
    provider-side masked inpainting, and ControlNet~~ — **done
    2026-09-17**, see Timeline (three separate PR entries: dropdown
    discovery, masked inpainting, ControlNet). User explicitly asked for
    all three after a status check surfaced them as missing (one
    incorrectly — the mask-paint UI already existed, corrected before any
    code was written). Went through `EnterPlanMode` + a Plan-agent design
    review that caught two real bugs before writing any code (see the
    plan file and the PR2/PR3 Timeline entries). No live ComfyUI instance
    was available anywhere in this arc — first real use against one
    should be treated as this feature's actual acceptance test.

**Not in the backlog — deliberate, don't re-add without the user explicitly overriding**
- PDF export as the WHOLE-BOOK interchange format — CBZ remains that
  choice, unchanged (see `export/exportBook.ts`'s docstring: comic-reader
  apps expect CBZ, not PDF). **This does NOT cover PDF as an ADDITIONAL
  export option for a different audience** (print shops and portfolio/
  publisher submissions ask for PDF by name) — the user explicitly
  approved that as part of Tier A on 2026-09-16, see the Timeline entry
  and `export/exportBookPdf.ts`. If this note is read again, treat THIS
  clarification as current, not the older blanket-sounding phrasing still
  left in the "Known gotchas"/crowdfunding-audit sections below (kept
  as-is there since they're dated historical snapshots, not live guidance).
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
- **A zustand selector must never return a freshly-built object/array.**
  `(s) => Object.values(s.doc.foo)` or a `.map()/.filter()` chain INSIDE
  the selector returns a new reference every call, which never
  `Object.is`-equals the previous snapshot — React's
  `useSyncExternalStore` (which zustand's hook is built on) then treats
  every check as "the store changed" and free-runs into a render loop,
  which in this app manifests as the whole page freezing/hanging rather
  than an obvious error. The existing, correct pattern (`BubbleStyleControls`'s
  `masks` in `InspectorPanel.tsx`, and every other selector in this
  codebase already) is: select the STABLE underlying object/map/array
  reference the store actually holds, then derive filtered/mapped results
  in the component body AFTER the hook call, never inside the selector
  callback. Caught 2026-09-16 the hard way — see that date's Timeline
  entry for how confusing the symptom was (6 unrelated e2e tests all
  timing out on completely different UI, with no error thrown anywhere).

## Deliberately not built (and why — don't re-litigate without new information)

- **Auth / accounts.** Explicit design decision in Kumanga's own README
  ("no accounts, ever") — local-first, BYOK. Not an oversight.
- **PDF export AS THE WHOLE-BOOK INTERCHANGE FORMAT.** Considered and
  rejected in favor of CBZ — see `export/exportBook.ts`'s docstring; CBZ
  is still that choice, unchanged. This note originally read as a blanket
  "no PDF export" and was corrected 2026-09-16: PDF (and EPUB) now exist as
  ADDITIONAL export formats for a different audience — print-shop and
  portfolio/publisher submissions that ask for PDF by name, and digital
  storefronts/e-readers that want EPUB — neither of which the CBZ decision
  above was ever about. See the Backlog section's Tier A entry and the
  2026-09-16 Timeline entry for the full reasoning; `export/exportBookPdf.ts`
  and `export/exportBookEpub.ts` are the actual code.
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
