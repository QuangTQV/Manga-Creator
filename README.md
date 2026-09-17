<p align="center">
  <img src="manga-studio/public/brand/kumanga-mark.svg#gh-light-mode-only" width="88" alt="Kumanga mark">
  <img src="manga-studio/public/brand/kumanga-mark-dark.svg#gh-dark-mode-only" width="88" alt="Kumanga mark">
</p>

# Kumanga — Open-Source, Local-First AI Manga Studio

**Kumanga is a free, open-source (MIT) AI manga creator that runs in your own
browser.** AI generates *reusable* assets — characters, poses, expressions,
backgrounds — a non-destructive editor composes them into manga pages, and a
natural-language **Manga Agent** can build whole panels for you. Bring your own
API key (BYOK); there is no account, no cloud lock-in, and no bundled model.

*Kuma* (bear) + *manga*. Originally created by
**[BotTony329](https://github.com/BotTony329)**; this fork is maintained by
**[QuangTQV](https://github.com/QuangTQV)**.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.3.0-8A2BE2)](https://github.com/QuangTQV/Manga-Creator/releases/tag/v0.3.0)
[![Tests](https://img.shields.io/badge/tests-1504%2F1504%20pass-brightgreen)](https://github.com/QuangTQV/Manga-Creator/releases/tag/v0.3.0)
[![Stack](https://img.shields.io/badge/Next.js%2015-TypeScript%205-black)](manga-studio/)

**[🌐 Website](https://kumanga-website.vercel.app/)** ·
**[🎬 Try the live studio](https://mangaharness.vercel.app)** ·
**[📚 Studio docs](manga-studio/README.md)** ·
**[🏛 Architecture](ARCHITECTURE.md)** ·
**[🏷 Releases](https://github.com/QuangTQV/Manga-Creator/releases)**

---

## What is Kumanga?

Kumanga is an AI manga harness built on one thesis: **AI creates reusable manga
assets; the creator composes those assets into manga.** Generation and
composition are separate systems, and you are always the director. Think
*Figma/Canva + manga editor + AI character studio + AI asset library* — plus a
Manga Agent that operates the same editor through natural-language prompts.

- **Stack**: Next.js 15 · React 19 · TypeScript 5 · npm workspaces
- **Status**: actively developed —
  [v0.3.0](https://github.com/QuangTQV/Manga-Creator/releases/tag/v0.3.0)
  released 2026-09-16, plus ongoing work since (local self-hosted AI,
  LoRA/ControlNet/IPAdapter, real masked inpainting — see below),
  1504/1504 tests passing, `npm audit` clean
  ([release notes](https://github.com/QuangTQV/Manga-Creator/releases/tag/v0.3.0) ·
  [v0.1 baseline report](docs/RELEASE_FREEZE_V0.1.md) for the original freeze this fork started from)
- **License**: MIT (keep [`NOTICE.md`](NOTICE.md) attribution on forks)

## Why not just prompt an image generator?

Because one-off images don't make a manga. A 20-page chapter needs the *same*
character, on-model, from panel to panel — plus framing, staging and dialogue
you control. Kumanga treats AI output as an **asset library, not a slot
machine**:

| Need | Generic image AI | Kumanga |
|---|---|---|
| Same character every panel | Re-prompt and pray | Reusable character assets — structured **poses × expressions** collections, reference-image-aware generation |
| Full shot → close-up | New generation each time | **Crop modes**: one full-body asset becomes a full, medium or close-up shot with **zero new generations** |
| Framing & staging | Not supported | Non-destructive panel editor (Figma-frame semantics); instances never modify their source asset |
| Whole-page help | — | **Manga Agent**: natural language → plan → validated tool calls → an editable page |
| Where it runs | Vendor cloud | Your machine (`localhost` out of the box); optional self-deploy |
| Cost & lock-in | Subscription | MIT, free, your own keys |

## What can it do?

- **Asset library, not one-off images.** Characters are structured collections
  (poses × expressions), browsable visually. Backgrounds, props and uploads are
  first-class reusable assets.
- **Non-destructive panel editor.** A panel is a clipping viewport; crop modes
  re-frame assets without new generations; instances never modify their source.
- **Real AI generation.** A provider abstraction with a Google Gemini adapter
  (reference-image aware, for character-consistent poses and expressions), a
  generic OpenAI-compatible REST adapter, a fully declarative Custom API
  adapter for any other vendor, and a dedicated **ComfyUI** adapter for
  running your own models locally or on rented/free GPU (see below).
- **Local, self-hosted image generation (ComfyUI).** Point Kumanga at your
  own ComfyUI instance — no cloud image API required. Supports LoRA
  chaining, ControlNet (pose/line-art guidance from a control image you
  supply), reference-image-aware generation, and real mask-aware local
  editing (inpainting), with IPAdapter automatically preserving a
  character's identity during an edit. See
  [docs/HOW_TO_RUN.md](docs/HOW_TO_RUN.md) for local setup, or running
  ComfyUI on Kaggle's free GPU quota and Azure OpenAI for the text agent.
- **Real local editing.** Paint a mask over any generated asset and ask the
  AI to redraw just that region — the rest of the pixels are guaranteed
  byte-identical to the original, regardless of what the provider actually
  returns.
- **Manga Agent.** Prompt → skill-guided plan → validated tool calls →
  execution through the same editor commands the manual UI uses.
- **Live AI.** A panel (top bar → "Live AI") showing the actual prompt sent
  to your connected provider and its raw response, live, for every image
  generation and Manga Agent call — scoped to your own browser, never
  visible to anyone else even on a shared deployment. Includes a usage
  summary (call counts and durations by provider/model, since the server
  started) — no dollar cost, since BYOK means this app never sees a bill.
- **Novel Import.** Paste a chapter (or a whole novel) and get a walkthrough
  of planned pages — the AI structures the prose into scenes and beats
  first, a deterministic pass decides page/panel boundaries from that, and
  you generate each page through the same Manga Agent as any other page,
  one at a time. Cross-checks the prose against characters already in your
  project, so a returning character gets matched instead of duplicated. See
  [docs/NOVEL_IMPORT.md](manga-studio/docs/NOVEL_IMPORT.md).
- **Continue an existing manga.** Bulk-import your own page images to keep
  working on a project you already started elsewhere, or resume any
  in-progress project with full character/style continuity.
- **Chapters.** Group pages into chapters, reorder them, and target a single
  chapter from export, print or translate.
- **Typography that behaves like lettering.** Speech bubbles auto-resize to
  fit their text as you type, and support a warp effect for shout/impact
  lettering.
- **Print-ready export & translation.** Export a page or the whole project
  to PNG, CBZ, or print-ready PDF-style pages with bleed and crop marks —
  or translate every lettered bubble into another language with one click,
  which creates a new project so your original stays untouched.
- **Persistence & export.** Projects survive refresh (IndexedDB + remote object
  storage for images); export one page to PNG at 1× / 2×, or the whole
  project as a CBZ (every page, in order — the standard format comic
  readers expect).

## How does the Manga Agent work?

You describe the page in plain language; the agent returns a finished,
fully-editable page region. The LLM acts as a creative director while code alone
owns state, identity and execution: prompts pass through a literal lock, one
server-side planning call, structural and semantic validation, project
resolution (names bound to real IDs), and a transactional executor with
rollback. Because agent runs go through ordinary editor commands, **one Undo
reverts a whole agent run** and every result stays hand-editable. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full pipeline.

## Which AI providers does it support? (BYOK)

Kumanga never ships a model key. Open **AI Settings** inside the app, pick a
standard, enter base URL + key + model, Test Connection, Save:

| Surface | Supported standards |
|---|---|
| Image generation | Google Gemini (reference-image aware) · any OpenAI-compatible REST endpoint · **ComfyUI** (local/self-hosted — LoRA, ControlNet, IPAdapter, real inpainting) · fully declarative Custom API for anything else |
| Manga Agent | OpenAI-compatible (works with Ollama/LM Studio locally too) · Anthropic-compatible · Gemini · Azure OpenAI (via Custom API) |

Want to run everything yourself — text through a cheap cloud API like Azure
OpenAI, image generation on a free GPU (e.g. a Kaggle notebook running
ComfyUI, tunneled out)? See
[docs/HOW_TO_RUN.md §5b/§5c](docs/HOW_TO_RUN.md) for exact setup steps.

Credentials are AES-GCM-encrypted into HttpOnly session cookies — never
client-readable, never stored in project data. Replace or forget them any time,
no redeploys.

**Multi-key and multi-provider rotation (optional).** Add backup API keys
for the same provider/model, and/or entirely different fallback providers
(own base URL, key and model each), in "Advanced — rotation & fallback" on
the Agent/Image cards. Generation automatically rotates across them on rate
limit, no credit, or an invalid key — round-robin by default, so several
free-tier keys multiply your effective throughput instead of sitting idle
until the primary fails — and falls through to a fallback provider entirely
once a provider (and all its keys) are exhausted. See
[docs/AI_PROVIDER_ARCHITECTURE.md](manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md#multi-key-and-multi-provider-rotation).

## Is my data private?

Yes — Kumanga is local-first. Projects, assets and generated images live in
your browser storage (IndexedDB, plus object storage for images when you deploy
it), not in our cloud. There is no account system. Everything works on
`localhost` out of the box; deploying to Vercel is optional, never required.
The deployment surface is audited: SSRF/redirect/size caps, object-storage
traversal and provider-session security all have dedicated test suites
(98/98 passing at the v0.1 freeze).

## Quick start

Requires Node.js 18.18+ (20+ LTS recommended for Next.js 15).

```bash
git clone https://github.com/QuangTQV/Manga-Creator.git
cd Manga-Creator
npm install
cp .env.example .env.local   # optional — the editor works without any AI key
npm run dev                  # http://localhost:3000
```

No registration, no account, no cloud setup. To use AI, add your own key in
**AI Settings** inside the app.

| Command | What it does |
|---|---|
| `npm run dev` | Start the studio at localhost |
| `npm run build` / `npm start` | Production build / serve it |
| `npm test` | Full test suite (domain, geometry, security, agent) |
| `npm run typecheck` / `npm run lint` | Static gates |

Bilingual (English/Vietnamese) step-by-step guide, env vars, and
troubleshooting: [docs/HOW_TO_RUN.md](docs/HOW_TO_RUN.md).

## FAQ

### Is Kumanga free?

Yes. Kumanga is open source under the MIT license — clone it, run it, fork it.
You supply your own AI API keys (BYOK), so there is no Kumanga subscription and
no bundled model. If you fork or reuse it, keep the attribution in
[`NOTICE.md`](NOTICE.md) intact.

### Do I need an account or an API key to try it?

No account, ever. The editor itself works with **no AI key at all** — you can
compose pages and explore the studio first. When you want AI generation or the
Manga Agent, open AI Settings and connect your own provider key.

### Where do my projects and API keys live?

Projects and assets live in your browser's IndexedDB (with object storage for
images on deployments); they survive refresh and never leave your environment
unless you deploy your own instance. API keys are AES-GCM-encrypted into
HttpOnly session cookies — they are never client-readable and never written
into project data, so exports and shares don't leak credentials.

### Can I keep a character consistent across panels?

That is the core design. Characters are structured collections of poses ×
expressions, and the Gemini adapter is reference-image aware: it generates new
poses and expressions *from* your existing character assets instead of
re-rolling from scratch. Framing changes (full / medium / close-up) don't
require any generation at all — crop modes re-frame the same asset.

### What if I don't like what the Manga Agent did?

Undo once. Agent runs execute through the same editor commands as the manual
UI, inside a transaction — a single Undo reverts the entire run, and everything
the agent produced remains fully hand-editable afterwards.

### How do I export my manga?

Pages export to PNG at 1× or 2×, the whole project to CBZ, or print-ready with
bleed and crop marks for professional printing. Project data stays in your
local storage, so you keep everything — projects, assets and generated
images — even if you stop using the app.

### Can I translate a finished project into another language?

Yes — "Translate Project" (top bar → More) sends every lettered bubble's
dialogue through your connected AI provider and creates a **new** project
with the translated text; your original, source-language project is never
modified. You can translate the whole project, one chapter, or just the
current page. Text baked directly into an image (e.g. sound effects) isn't
translated, only editable speech-bubble text.

### Can I continue a manga I already started?

Yes. Bulk-import your existing page images into a project to keep working on
them, and Novel Import checks new prose against characters already in the
project so a returning character is matched instead of recreated from
scratch.

### Can I deploy Kumanga instead of running it locally?

Yes, deploying (e.g. to Vercel) is optional and fully self-serve. Set
`APP_ENCRYPTION_KEY` (encrypts users' BYOK credentials — it contains no AI key
itself) and optionally `BLOB_READ_WRITE_TOKEN`; users' own BYOK settings
override any operator-default providers. A reference deployment runs at
[mangaharness.vercel.app](https://mangaharness.vercel.app).

### What is the current status of the project?

Actively developed. The latest tagged release is
[v0.3.0](https://github.com/QuangTQV/Manga-Creator/releases/tag/v0.3.0)
(2026-09-16); since then this fork has added local self-hosted image
generation (ComfyUI), LoRA/ControlNet/IPAdapter support, and real
mask-aware local editing. 1504/1504 tests passing, clean typecheck, lint
and build, and zero `npm audit` vulnerabilities. See the
[release notes](https://github.com/QuangTQV/Manga-Creator/releases) for
what shipped in each tagged version, and [ARCHITECTURE.md](ARCHITECTURE.md)
for module boundaries and the agent pipeline. The original v0.1 baseline
this fork started from is preserved at
[docs/RELEASE_FREEZE_V0.1.md](docs/RELEASE_FREEZE_V0.1.md) for reference.

### Can I run everything myself, without paying for cloud AI?

Yes. The Manga Agent works with any OpenAI-compatible endpoint, including
locally-run models (Ollama, LM Studio) or Azure OpenAI. Image generation
can run entirely on your own or rented GPU via a dedicated **ComfyUI**
adapter — including LoRA, ControlNet, IPAdapter-preserved local edits, and
real inpainting — with no cloud image API involved at all. See
[docs/HOW_TO_RUN.md](docs/HOW_TO_RUN.md) for exact setup, including a
walkthrough for running ComfyUI on Kaggle's free GPU quota.

## Repository layout

- `manga-studio/` — the Next.js app (editor core, agent, services, API routes).
  See the [studio README](manga-studio/README.md) for configuration details.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — module boundaries and the agent
  pipeline.
- [`docs/RELEASE_FREEZE_V0.1.md`](docs/RELEASE_FREEZE_V0.1.md) — the v0.1
  known-good baseline.

## License & attribution

Kumanga is MIT-licensed. Originally created by **[BotTony329](https://github.com/BotTony329)**;
this fork is maintained by **[QuangTQV](https://github.com/QuangTQV)**. If
you fork or reuse it, keep the attribution ([`NOTICE.md`](NOTICE.md)) intact
— the license requires it.
