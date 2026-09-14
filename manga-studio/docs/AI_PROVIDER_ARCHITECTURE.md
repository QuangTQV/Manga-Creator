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

## Capabilities drive the UI

`/api/provider/status` returns safe Agent, Image Generation, and Background Removal summaries plus image capabilities (never keys). The generator and processing cascade use the canonical `supportsReferenceImage`, `supportsImageEditing`, and `supportsTransparentBackground` flags instead of inferring capabilities from prompt wording.

## Background-removal BYOK

Background removal is a third independent provider kind with its own encrypted HttpOnly cookie. AI Settings offers a remove.bg quick preset and a declarative Custom API mapping (URL or base64 reference, response URL/base64, sync or polling). The user supplies only that provider's endpoint/key in the UI. `APP_ENCRYPTION_KEY` remains a one-time operator infrastructure secret used to encrypt all user BYOK cookies; it is never a user provider key. Optional `BACKGROUND_REMOVAL_*` environment variables are deployment-wide fallbacks only.

## Prompt composition

`src/ai/promptTemplates.ts` converts semantic requests (character/pose/expression/background/prop + descriptions) into provider-neutral prompts — creator vocabulary in, provider strings out, in exactly one place. It is isomorphic: the dialog shows a prompt preview with the same code the executor uses.

## Multi-key rotation

A `ProviderConfig` (agent or image) may carry `backupApiKeys: string[]` —
extra keys for the *same* provider/model. When present, `providerRegistry.ts`
and `agent/providers/registry.ts` transparently wrap the adapter they build
with `withRotation.ts` (image) / `withRotation.ts` (agent); with none
configured this is a no-op that returns the plain adapter. Every caller of
`createImageProvider`/`createAgentProvider` benefits automatically — no call
site needs to know rotation exists.

Shared core in `src/server/providerRotation.ts` (framework/HTTP-agnostic —
it only ever handles `ProviderConfig` variants and a status code):

- **Candidate pool**: the primary key, then each backup, deduped.
- **Failure classification** from the HTTP status every adapter already
  normalizes to (`gemini.ts`/`genericRest.ts`/`agent/providers/http.ts`):
  `429` → rate limit (cool down, rotate), `402` → out of credit (cool down
  much longer, rotate), `401` → this key is bad (rotate, no point retrying
  it), anything else → fatal (would fail identically on every candidate —
  stop immediately instead of burning through the whole chain).
- **Cooldown**: in-process, keyed by (kind, provider, model, key) — scoped
  to the model too, since several providers meter quota per model. Prefers
  a provider-sent `Retry-After` (`src/server/retryAfter.ts`) over the
  configured blind guess, clamped to 15 minutes.
- **Starting order** (`ProviderConfig.rotationStrategy`): `round_robin`
  (default) advances a per-pool cursor so consecutive requests fan out
  across every key instead of only reaching backups reactively once the
  primary fails — two keys on the same free-tier cap roughly double
  effective throughput this way. `sequential` always tries the primary
  first. `random` shuffles the ready candidates.

`testConnection()` is deliberately NOT rotated — it always checks the exact
key the user just typed, never a backup standing in for it.

In-process only: state resets on restart. That is a real optimization for
`npm run dev` (one long-lived process) and a documented, accepted trade-off
on serverless — not durable state, matching the equivalent design in the
sibling Manga-Translator-Extension project this was ported from.

Configured in AI Settings under "Advanced — multi-key rotation" (per
provider card, agent and image only — background removal is out of scope
for now). Backup keys are secrets like the primary key: never returned to
the browser, never in a `ProviderSummary` — only a safe `backupKeyCount`.

## Async providers

The current adapters are synchronous. The abstraction leaves room for job-based providers (`asyncGeneration` capability flag); a polling loop would live inside that adapter's `generateImage`, behind the same interface — no editor changes. A full job queue is deliberately not built (YAGNI until a provider requires it).

## Agent planning providers

Agent adapters share a concise-plan contract rather than exposing vendor response shapes to the editor. OpenAI-compatible planning requests stream Chat Completions with JSON response mode and a 2,048-token ceiling. The SSE normalizer accumulates content and streamed function arguments, ignores provider reasoning text, preserves safe finish/status metadata, and converts a tool-call-only response into the canonical Manga Studio plan before schema and scope validation.

Recognized hybrid Qwen models use non-thinking mode for latency-sensitive routine planning. Model names explicitly identifying a thinking model or QwQ are left unchanged. These flags and response quirks stay in the OpenAI-compatible/Custom agent adapters; the planner and command runtime remain vendor-neutral.

## Generation rules

1. Results land in the **library** first (with provenance metadata + a Generation History record) — never directly on the canvas.
2. Regeneration never overwrites: same-slot results stack as variations in the character browser.
3. Failures are recorded in Generation History with safe error messages.
4. Safe failures include a request ID and may include provider/model/HTTP/endpoint-path metadata; credentials and full provider configurations never cross the server boundary.
