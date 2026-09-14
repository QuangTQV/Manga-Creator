# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, and others) working in
this repository. Read this before making changes. `CLAUDE.md` points here and
adds only Claude Code-specific notes — this file is the source of truth.

## What this project is

Kumanga — a local-first, bring-your-own-key (BYOK) AI manga creation harness.
AI generates reusable assets (characters as pose × expression collections,
backgrounds, props); a non-destructive panel editor composes them into pages;
a natural-language **Manga Agent** drives the same editor through validated
tool calls. No account system, no bundled model, no vendor lock-in.

This is a fork of `BotTony329/mangaharness`. **License is MIT with a mandatory
attribution clause** (see `LICENSE` + `NOTICE.md`): every copy, fork, and
derivative must keep the BotTony329 credit in `README.md`, `NOTICE.md`, and
the in-app UI (`Studio.tsx`). Never remove or dilute this during refactors,
rebrands, or "cleanup" passes.

## Repo layout

```
/                    npm workspace root — scripts proxy into manga-studio/
├── manga-studio/    the actual Next.js app (all real source lives here)
│   ├── src/
│   │   ├── domain/      pure document model, commands, validation, camera math — no IO
│   │   ├── editor/      zustand store + command dispatch — the ONLY mutation path
│   │   ├── services/    application services — UI and Agent BOTH call these
│   │   ├── ai/           provider registry (server-side only)
│   │   ├── server/       credential/session handling, outbound fetch security boundary
│   │   ├── app/api/      HTTP routes (generate, assets/edit, agent, agent/direct, provider status)
│   │   ├── agent/        shared planning vocabulary + provider plumbing (agent V3 depends on this)
│   │   ├── agent-v2/     execution engine (orchestrator, per-domain step processors)
│   │   ├── agent-v3/     current agent entry point — contract/director/resolution/routing/verification
│   │   └── storage/      IndexedDB (projects) + objectStore (images: Vercel Blob or local .data/)
│   └── docs/             deep-dive docs (ARCHITECTURE, AGENT_ARCHITECTURE, AI_PROVIDER_*, DECISIONS, ...)
├── ARCHITECTURE.md   top-level module boundaries + the agent pipeline diagram — read this first
├── docs/RELEASE_FREEZE_V0.1.md   known-good baseline, invariants, freeze rule — read this second
└── CONTRIBUTING.md   short contributor checklist
```

`src/app/api/agent/direct/route.ts` is the live agent entry point
(`agent-v3/director/creativeDirector` → `agent-v2` orchestrator). Treat
`agent/`, `agent-v2/`, `agent-v3/` as three cooperating layers of one system,
not three competing implementations — do not "consolidate" them without
understanding `ARCHITECTURE.md` first.

## Hard architecture rules (enforced by `manga-studio/src/services/architecture.test.ts`)

1. **Editor Core does not depend on Agent.** Dependency direction is strictly
   agent → services → domain. Never import an agent module from `domain/`,
   `editor/`, or `services/`.
2. **Agent never bypasses Application Services.** It must not import provider
   adapters, the generation HTTP client, or storage directly — only through
   `src/services/*`.
3. **UI and Agent share one service layer.** Never hand-roll a second code
   path to an API route for something a service already does.
4. Runtime IDs are owned by deterministic harness logic, never produced or
   invented by LLM output. LLM output is untrusted semantic intent, always
   validated (zod contracts) before it touches domain commands.
5. Provider secrets never enter project documents or client-readable state.
6. Local edits always create a NEW asset with provenance; originals never
   mutate in place.
7. An agent run commits as a whole transaction or rolls back; one Undo
   reverts an entire agent run.

If a change would violate any of these, stop and flag it instead of working
around the boundary test.

## Setup and commands

Requires Node.js 18.18+ (20+ LTS recommended). Run everything from the repo
root — it proxies into `manga-studio/` via npm workspaces.

```bash
npm install
cp .env.example .env.local   # optional — the editor works with no AI key
npm run dev                  # http://localhost:3000
```

| Command | Scope |
|---|---|
| `npm test` | Full vitest suite: domain, geometry, security, agent (includes all security tests — no separate command needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm run build` | production build |

**Before finishing any change**, all four must pass:
`npm test && npm run typecheck && npm run lint && npm run build`.

Add a regression test for every bug fix and every behavior change. Do not
merge a change to security-sensitive code without a targeted test for it.

## Security-sensitive areas — extra care, extra tests

Changes touching any of the following require targeted regression testing,
not just the default suite passing incidentally:

- `manga-studio/src/server/outboundFetch.ts` — centralized SSRF/egress boundary; all server-side outbound requests must go through it
- `manga-studio/src/server/providerSession.ts`, `secretBox.ts` — provider session + secret storage (AES-256-GCM, HttpOnly cookies)
- `manga-studio/src/app/api/**` — API routes
- `manga-studio/src/assets/**` — upload & processing entry points
- `manga-studio/src/storage/objectStore.ts` — object storage / dev file server (path traversal risk)
- project import logic
- CSP / security headers in `manga-studio/next.config.ts`

Never bypass an existing security protection to make a provider integration
"just work" — fix the adapter, not the boundary.

## Scope discipline — v0.1 is release-frozen

Per `docs/RELEASE_FREEZE_V0.1.md`, v0.1 is frozen. **Only these justify an
unprompted fix:** P0/P1 security vulnerability, data loss, project
corruption, app cannot start, core generation completely unavailable, or a
release/install blocker.

Everything else — UX improvements, camera/staging enhancements, provider
compatibility edge cases, new tones/effects/Agent features, code cleanup,
architectural elegance, performance optimization — is backlog, not a silent
fix. If you notice one of these while working on something else, mention it;
do not fold it into an unrelated change or start implementing it without the
user asking.

The `docs/RELEASE_FREEZE_V0.1.md` "Known Limitations" section lists things
that are intentionally incomplete (e.g. generative local editing is
provider-untested, no `create_interaction` agent tool, no Object→prop UI
path). Don't treat these as bugs to fix on sight.

## Coding conventions

- TypeScript 5, functional React components, Next.js 15 (App Router) / React 19.
- Domain and services layers are pure/IO-free where the layout above says so — keep them that way.
- Brand assets (`public/brand/*.svg`) are generated from `scripts/build-brand.mjs` — never hand-edit the SVGs; edit the script and regenerate.
- Provider adapters live in `src/ai/providers/`; each new adapter needs its own contract test alongside `adapterContract.test.ts` / `referenceContract.test.ts`.

## Where to look for more

- `ARCHITECTURE.md` (root) — module boundaries, full agent pipeline diagram
- `docs/RELEASE_FREEZE_V0.1.md` (root) — baseline, invariants, freeze rule, known limitations
- `manga-studio/docs/AGENT_ARCHITECTURE.md` — tools, skills, planner, executor detail
- `manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md` / `AI_PROVIDER_SECURITY.md` — provider abstraction, key handling, SSRF, redaction
- `manga-studio/docs/EDITOR_MODEL.md` — source assets vs. instances, panel viewport, undo model
- `manga-studio/docs/DECISIONS.md` — architecture decision records
- `CONTRIBUTING.md` (root) — short contributor checklist
