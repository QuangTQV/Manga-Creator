# CLAUDE.md

This project's agent instructions live in **[AGENTS.md](AGENTS.md)** — read
it first; it is the single source of truth (repo layout, architecture rules,
commands, security-sensitive areas, and the v0.1 scope-freeze policy that
governs what you may fix unprompted).

Notes specific to working here as Claude Code:

- Prefer the `Edit` tool over shell `sed`/sandboxed rewrites for changes
  inside `manga-studio/src/` — the codebase relies on TypeScript types and
  the architecture boundary test (`manga-studio/src/services/architecture.test.ts`)
  to catch layering mistakes; run `npm run typecheck` and `npm test` after
  edits rather than assuming a change is safe.
- Treat `.env.local`, anything under `manga-studio/.data/`, and provider API
  keys entered through AI Settings as secrets — never print, log, or commit
  them, and never include them in a summary back to the user.
- `NOTICE.md` and the BotTony329 attribution in `README.md` / `Studio.tsx`
  are a license condition, not boilerplate — do not remove them even if asked
  to "clean up" branding, unless the user explicitly wants to fork under a
  new license (flag that as a licensing decision, not a code change).
- This is a fork the user (llmblockchain@gmail.com) intends to build on top
  of as their own manga-creation assistant project. Favor small, reviewable
  changes and ask before large architectural rewrites — see the freeze policy
  in AGENTS.md for what counts as in-scope vs. backlog.
