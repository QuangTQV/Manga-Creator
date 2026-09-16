# AI Provider Architecture

## The universal provider: Custom API

The harness is not bounded by a vendor catalog. The fundamental provider type is **Custom API** (`src/server/customApi/`): a declarative description — endpoint, method, auth mode, headers, JSON request template with `{{variables}}`, response mapping path, reference-image mode, sync or polling execution — that the executors (`src/ai/providers/customImage.ts`, `src/agent/providers/customAgent.ts`) run against any compatible endpoint. Template rendering is pure substitution (exact-match placeholders inject structured JSON values like `{{messages}}`; inline placeholders interpolate as text; unknown variables are rejected; nothing is ever evaluated), and response mapping is a traversal-only property path. Presets — both the coded adapters below and the "Start from" chips in the Custom form — are conveniences layered on top. Projects reference capabilities, never vendors: switching providers never touches project data.

## Shape

```
Browser (GeneratorDialog / Agent executor)
   ↓ POST /api/generate  { assetType, prompt, referenceUrls?, size }
Server route (validates with zod)
   ↓ secret-safe request-scoped trace (credential / adapter / fetch / persistence stages)
   ↓ src/ai/generate.ts  (loads references from OUR storage only)
   ↓ providerRegistry → ImageGenerationProvider adapter
   ↓ external provider API (key attached server-side)
   ↓ result stored in object storage (Vercel Blob / local dev)
   ← { url, mimeType, provider, model, referenceUsed }
```

The editor never sees provider SDKs, keys, or raw provider responses. Adapters implement:

```ts
interface ImageGenerationProvider {
  id: string; label: string; model: string;
  capabilities: ProviderCapabilities;   // supportsReferenceImage/editing/transparentBackground
  testConnection(): Promise<ProviderStatus>;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
  editImage?(req: ImageEditRequest): Promise<ImageGenerationResult>;
}
```

Character/prop results then enter an independent capability cascade: validate native alpha; ask the same image provider to isolate the source when `supportsImageEditing`; call the user's optional `BackgroundRemovalProvider`; and only then try the conservative local heuristic. Every candidate must contain meaningful mixed alpha, visible foreground, non-full-frame background removal, and usable bounds before it can become a stored derivative.

## Implemented adapters

### Gemini (`src/ai/providers/gemini.ts`) — the real provider

- Models: `gemini-2.5-flash-image` by default (override with `IMAGE_MODEL`).
- **Reference images supported natively**: character reference images are sent as `inline_data` parts, which is what powers "generate another pose/expression of the same character". Consistency is provider-dependent and the UI says so — it is never claimed as guaranteed.
- Synchronous request/response; 90 s timeout; bounded response reads.
- Declares image editing and implements the second pass through the same `generateContent` surface. Gemini is not declared as native-alpha capable; returned bytes must still pass actual alpha validation.

### Generic REST (`src/ai/providers/genericRest.ts`)

- Any OpenAI-compatible `POST {base}/images/generations` endpoint (`response_format: b64_json`).
- Declares `referenceImage: false` — the UI adapts (no "preserve character" claims) instead of pretending.
- Base URL passes the SSRF guard at construction time.

### ComfyUI (`src/ai/providers/comfyui.ts`) — local self-hosted, coded not declarative

A dedicated coded adapter for a local ComfyUI instance, not a `providerType: "custom"` configuration — `providerType: "comfyui"`, its own `imageTypes` entry and `DEFAULT_BASE_URLS` fallback (`http://127.0.0.1:8188`) in `providerSession.ts`, and its own `IMAGE_PROTOCOLS` entry in `AiSettingsDialog.tsx`.

- **Why not Custom API**: ComfyUI's `GET /history/{prompt_id}` nests its result under a key equal to the submitted `prompt_id` — a hyphenated UUID. `customApi/jsonPath.ts`'s `getAtPath` only parses plain identifier keys and numeric `[N]` indices; a hyphenated dynamic key can't be expressed as a static declarative path at all. And a real ComfyUI workflow graph (several KB) doesn't reliably fit the 6000-char request-template cap or the ~3500-char total cookie budget. `comfyui.ts` reads the dynamic key with plain object property access (`body[promptId]`), never through `getAtPath`.
- **Scope (v1)**: standard checkpoint-only txt2img — `buildWorkflow` builds the graph server-side from typed fields (prompt, negative prompt, width/height, checkpoint filename as `model`) instead of accepting user-supplied JSON.
- **No built-in auth**: ComfyUI itself has none; `resolveApiKey` in `providerSession.ts` allows an empty key for `providerType === "comfyui"` the same way it already does for Custom API's `auth.mode === "none"`. An optional key, if set, is sent as `Authorization: Bearer` for setups behind an authenticating reverse proxy.
- `testConnection()` pings ComfyUI's own `/system_stats` (cheap, real, side-effect-free) rather than performing a real generation.
- Local-only in practice: `baseUrl` passes the same SSRF guard as every other adapter, so `http://127.0.0.1:8188` only resolves when `ALLOW_PRIVATE_NETWORKS=1` and `NODE_ENV !== "production"` — see `docs/HOW_TO_RUN.md` §5b.
- **v2 additions — LoRA chaining, reference-image/img2img, sampler tuning**:
  - `ProviderConfig.comfyui?: ComfyUiExtraConfig` (`src/server/comfyui/config.ts`) holds steps/cfg/samplerName/scheduler and up to `MAX_COMFYUI_LORAS` (4) `{name, strength}` entries. Nothing here is secret (unlike `backupApiKeys`), so it needs no dedicated mutation endpoint: it round-trips through `ProviderSummary` and is resubmitted wholesale on every AI Settings save, the same way `rotationStrategy` already is. **Scope cut**: a ComfyUI provider configured as a *fallback* (`FallbackProviderConfig`) does not carry `comfyui` extras — fallback candidates always run v1 defaults.
  - `buildWorkflow` chains `LoraLoader` nodes (ids `20`-`23`) from the checkpoint when `extra.loras` is non-empty, feeding KSampler's `model` and both `CLIPTextEncode`'s `clip` from the last chain link instead of the checkpoint directly. `LoraLoader`'s two independent strengths (`strength_model`/`strength_clip`) are intentionally collapsed into one `strength` field per entry.
  - `capabilities.supportsReferenceImage: true`, `reference: {transport: "provider-native", maxImages: 1}`. `generateImage` uploads `request.referenceImages[0]` via `POST {base}/upload/image` (multipart, mirrors `genericRest.ts`'s `buildEditsFormData` Blob/FormData pattern) FIRST, then builds an img2img graph: `LoadImage` (ids `30`) using the **server's own returned name** (never the client-sent filename — ComfyUI auto-dedupes/renames on collision) → `ImageScale` (id `32`, resizes to `request.width`/`height` — without this the output resolution would silently follow the reference image's native size instead, since nothing downstream re-scales provider output) → `VAEEncode` (id `31`) feeding KSampler's `latent_image` with a fixed `denoise: 0.6`.
  - No live ComfyUI instance was reachable while building this — `/upload/image`'s response shape and the exact `LoraLoader`/`ImageScale` field names should be spot-checked against a running instance; a malformed node/field surfaces as ComfyUI's own `/prompt` 400 (already handled), not silent wrong output.
- **v3 additions — dropdown discovery for LoRA/ControlNet-model fields (first of three planned v3 PRs; real masked inpainting and ControlNet land in follow-up PRs)**:
  - `fetchObjectInfoOptions(config, nodeClass, inputName)` in `comfyui.ts` — reuses this file's own SSRF-guarded fetch plumbing (never a second, raw outbound path) to `GET {base}/object_info/{nodeClass}` and extract a COMBO/enum input's option list (e.g. every LoRA filename ComfyUI can see). `POST /api/provider/comfyui-object-info` (new route, `nodeClass`/`inputName` zod-enum-restricted, not an open node-name probe) exposes it, returning `{options: []}` on any failure/mismatch — same best-effort philosophy as `provider/models/route.ts`'s existing OpenAI-compatible model discovery.
  - `AiSettingsDialog.tsx`'s LoRA rows editor gets a "Fetch LoRAs" button populating a `<datalist>` the name inputs already reference via `list=` — free text stays the fallback (ComfyUI might be offline, or the list stale), same pattern the existing Model field's own datalist already uses. **Chromium quirk**: once a `list` attribute is present, the input's ARIA role changes from `textbox` to `combobox` — relevant for e2e locators, not application code.
  - **A real, separate bug found and fixed while building this**: `readSessionConfig`'s own `hasCredential` check (used on every cookie *read*) had never been taught the "comfyui has no built-in auth" exception that `resolveApiKey` (used on *write*/save) already had — so a legitimately-saved keyless ComfyUI config silently read back as "not configured" on every subsequent page load, despite saving successfully. Two independent credential-requiredness checks for the same concept, only one of which got updated when ComfyUI's write path was built — now both branches carry `providerType === "comfyui"`, and a regression test round-trips a saved config through `readSessionConfig` specifically (not just `buildProviderConfig`) so this can't silently regress again.

## Capabilities drive the UI

`/api/provider/status` returns safe Agent, Image Generation, and Background Removal summaries plus image capabilities (never keys). The generator and processing cascade use the canonical `supportsReferenceImage`, `supportsImageEditing`, and `supportsTransparentBackground` flags instead of inferring capabilities from prompt wording.

## Background-removal BYOK

Background removal is a third independent provider kind with its own encrypted HttpOnly cookie. AI Settings offers a remove.bg quick preset and a declarative Custom API mapping (URL or base64 reference, response URL/base64, sync or polling). The user supplies only that provider's endpoint/key in the UI. `APP_ENCRYPTION_KEY` remains a one-time operator infrastructure secret used to encrypt all user BYOK cookies; it is never a user provider key. Optional `BACKGROUND_REMOVAL_*` environment variables are deployment-wide fallbacks only.

## Prompt composition

`src/ai/promptTemplates.ts` converts semantic requests (character/pose/expression/background/prop + descriptions) into provider-neutral prompts — creator vocabulary in, provider strings out, in exactly one place. It is isomorphic: the dialog shows a prompt preview with the same code the executor uses.

## Multi-key and multi-provider rotation

A `ProviderConfig` (agent or image) may carry `backupApiKeys: string[]` —
extra keys for the *same* provider/model — and/or `fallbackProviders:
FallbackProviderConfig[]` — entirely different vendors/endpoints (up to
`MAX_FALLBACK_PROVIDERS`, each with its own model and optionally its own
`backupApiKeys`). When either is present, `providerRegistry.ts` and
`agent/providers/registry.ts` transparently wrap the adapter they build with
`withRotation.ts` (image) / `withRotation.ts` (agent); with neither
configured this is a no-op that returns the plain adapter. Every caller of
`createImageProvider`/`createAgentProvider` benefits automatically — no call
site needs to know rotation exists.

Shared core in `src/server/providerRotation.ts` (framework/HTTP-agnostic —
it only ever handles `ProviderConfig` variants and a status code):

- **Candidate pool** (`buildCandidates`): the primary key, then each of its
  backups, then each fallback provider with each of *its* backups in turn —
  a flat chain, never a tree (a fallback cannot have its own fallbacks). A
  `(providerType, model, key)` triple is only ever tried once; the same key
  against a *different* model is not a duplicate (some providers meter rate
  limits per model); a key-less candidate (custom API, auth mode "none") is
  never deduped against another key-less one.
- **Failure classification** from the HTTP status every adapter already
  normalizes to (`gemini.ts`/`genericRest.ts`/`agent/providers/http.ts`):
  `429` → rate limit (cool down, rotate), `402` → out of credit (cool down
  much longer, rotate), `401` → this key is bad (rotate, no point retrying
  it), anything else → fatal.
- **Fatal is provider-scoped, not chain-stopping** (`nextCandidateIndex`): a
  fatal error (bad prompt, malformed request, a genuinely broken 5xx) would
  repeat identically on every OTHER key for the *same* provider — those are
  skipped without retrying — but must not block trying a later, genuinely
  different fallback provider, which gets its own real attempt. If nothing
  but same-provider candidates remain, rotation stops there instead of
  wasting calls.
- **Cooldown**: in-process, keyed by (kind, provider, model, key) — scoped
  to the model too, since several providers meter quota per model. Prefers
  a provider-sent `Retry-After` (`src/server/retryAfter.ts`) over the
  configured blind guess, clamped to 15 minutes.
- **Starting order** (`ProviderConfig.rotationStrategy`): `round_robin`
  (default) advances a cursor shared per `kind` (agent/image — a session has
  exactly one rotation pool per kind, however many providers it spans) so
  consecutive requests fan out across every key/provider instead of only
  reaching backups reactively once the primary fails. `sequential` always
  tries the primary first. `random` shuffles the ready candidates.

`testConnection()` is deliberately NOT rotated — it always checks the exact
key the user just typed, never a backup/fallback standing in for it.

In-process only: state resets on restart. That is a real optimization for
`npm run dev` (one long-lived process) and a documented, accepted trade-off
on serverless — not durable state, matching the equivalent design in the
sibling Manga-Translator-Extension project this was ported from.

Configured in AI Settings under "Advanced — rotation & fallback" (per
provider card, agent and image only — background removal is out of scope
for now). Backup keys and fallback providers are secrets like the primary
key: never returned to the browser, never in a `ProviderSummary` — only
safe counts/identity (`backupKeyCount`, and per fallback its `providerType`/
`name`/`model`/`backupKeyCount`). Because they can never be read back, the
AI Settings UI always resubmits the whole fallback list together on save
(no partial per-entry key updates) — see the `FallbackProvidersEditor`
component's doc comment in `AiSettingsDialog.tsx` for the exact UX. The
whole `ProviderConfig` (primary + backups + fallbacks + their backups)
still lives in one ~4KB session cookie; `buildProviderConfig` fails loudly
with a clear message if a configuration grows too large instead of silently
truncating it — trim a custom request template, a backup key, or a fallback
provider.

## Async providers

Most adapters are synchronous; the abstraction leaves room for job-based providers via the `asyncGeneration` capability flag, with a polling loop living inside that adapter's `generateImage`, behind the same interface — no editor changes. A full shared job queue is deliberately not built (YAGNI until more than one adapter needs it).

Custom API's own declarative polling (`src/server/customApi/config.ts`'s `pollingSchema`) covers self-hosted local models that fit a plain "submit → fixed-path task id → poll a fixed-path status → fixed-path result" shape — see `docs/HOW_TO_RUN.md` §5b for Ollama/LM Studio (agent, sync OpenAI-compatible) and Automatic1111 (image, sync base64 response) working today with zero new code, gated by `ALLOW_PRIVATE_NETWORKS=1` in `outboundFetch.ts`.

**ComfyUI doesn't fit that declarative shape** (see "Implemented adapters" above for the full reason: a dynamic history-lookup key, and an oversized workflow graph), which is why `comfyui.ts` is a real coded adapter with its own hand-written poll loop instead — the first adapter in this codebase where `asyncGeneration: true` is backed by genuinely async, non-declarative code rather than the shared `pollingSchema` mechanism.

## Agent planning providers

Agent adapters share a concise-plan contract rather than exposing vendor response shapes to the editor. OpenAI-compatible planning requests stream Chat Completions with JSON response mode and a 2,048-token ceiling. The SSE normalizer accumulates content and streamed function arguments, ignores provider reasoning text, preserves safe finish/status metadata, and converts a tool-call-only response into the canonical Manga Studio plan before schema and scope validation.

Recognized hybrid Qwen models use non-thinking mode for latency-sensitive routine planning. Model names explicitly identifying a thinking model or QwQ are left unchanged. These flags and response quirks stay in the OpenAI-compatible/Custom agent adapters; the planner and command runtime remain vendor-neutral.

## Live AI (call log)

A "Live AI" panel (top bar → `LiveAiPanel.tsx`) shows the actual request sent
to whichever provider handled a call and the actual response — for image
generation (`/api/generate`, `assets/edit`, `assets/upload`,
`assets/remove-background`, `puppet/reconstruct`) and both agent planning
paths (`/api/agent`, `/api/agent/direct`, `/api/agent/parse-novel`) — the
exact prompt/system-prompt text, not just the stage-timing metadata
`trace`/`AgentTrace` already logged to the server console for diagnostics.

- **Capture point**: each of those routes calls `recordLiveCall`
  (`src/server/callLog.ts`) with a redacted/truncated summary of what it
  sent and what came back — deliberately at the ROUTE, not inside the
  provider adapters or the rotation wrapper, so it reflects the logical
  request the studio made rather than every internal rotation retry.
  `truncateForLog` bounds any single field (default 4000 chars) so an
  in-memory log entry can never balloon on a huge prompt.
- **Getting prompt/completion text out of the agent planners**: `trace`
  fires many times per call and is logged wholesale to the server console
  on every stage, so it's the wrong channel for multi-KB prompt text.
  `planAgentRun`/`planCreativeDirection` instead accept an optional
  `onExchange` callback (`AgentExchange` in `agent/providers/types.ts`)
  that fires at most twice per call — prompt built, completion received —
  purely for a caller that wants the content.
- **Session-scoped, not global**: entries are kept in a per-`sessionTag`
  in-memory bucket (`src/server/sessionTag.ts` — a random, non-secret,
  HttpOnly cookie `middleware.ts` ensures exists before any route runs) so
  one visitor's prompts are never visible to another's Live AI panel on a
  shared deployment. Idle buckets are evicted after 2 hours.
- **Polled, not pushed**: `GET /api/live/log` returns the current session's
  entries; the panel polls it every ~1.5s while open. A long-lived SSE/
  WebSocket connection would get cut off mid-generation by a serverless
  platform's function-duration limit — polling behaves identically in
  `npm run dev` and on Vercel. `POST /api/live/clear` empties the session's
  log.
- **What is NOT logged**: raw image bytes (only `mimeType`/whether a
  reference was used/the URL — memory-bounded, and the asset library
  already shows the image itself), and never any API key/credential.
- **Usage stats, not cost**: every `recordLiveCall` also updates a
  `UsageStats` counter per session — total calls/successes/failures and a
  breakdown by (kind, route, provider, model), unbounded (unlike the
  40-entry `entries` ring buffer) but still reset by a server restart, no
  more durable than the rest of this module. `GET /api/live/usage` returns
  it; the Live AI panel shows it as a collapsible summary. Deliberately
  never a dollar figure — BYOK means this process only ever sees the call
  itself, never a bill, so there is nothing honest to convert a call count
  into.

## Generation rules

1. Results land in the **library** first (with provenance metadata + a Generation History record) — never directly on the canvas.
2. Regeneration never overwrites: same-slot results stack as variations in the character browser.
3. Failures are recorded in Generation History with safe error messages.
4. Safe failures include a request ID and may include provider/model/HTTP/endpoint-path metadata; credentials and full provider configurations never cross the server boundary.
