# Aitomate

**Collaborative, AI-assisted test automation — right in your browser.**

Aitomate is an open-source browser extension (Chrome, Edge, Firefox) that lets
developers record UI test scenarios once, commit them to the repo as plain JSON,
and lets QA engineers and Product Owners run — or even build — those same
scenarios without writing a line of code.

> ⚠️ **Status: early development.** The scenario schema and project scaffold are
> in place; the recorder and runner are being built. Not yet usable. See
> [Roadmap](#roadmap).

## Why

Teams need UI tests that non-developers can actually run. Existing options are
either developer-only (Playwright, Selenium), locked to a vendor cloud, or
can't fill forms with anything smarter than fixed strings. Aitomate aims for:

- **Record once, run anywhere.** Scenarios are portable `.aitomate.json` files —
  human-readable, git-diffable, committed next to your app code.
- **Smart form filling.** Each field resolves its value through one of three modes:
  - **Static** — fixed value.
  - **Dynamic** — random pick from a list, or **AI-generated** from a natural-language
    prompt ("realistic Indonesian full name") via your own LLM key or a local model.
  - **Database** — live value from your app's database through a local, read-only
    bridge. Credentials never enter the scenario file.
- **Framework-agnostic.** Tests any website: server-rendered (Laravel Blade, Rails,
  Django) or SPA (React, Vue, Svelte, Angular). Handles React controlled inputs,
  hydration waits, open shadow DOM, and same-origin iframes.
- **Built for three personas.** Developers get an advanced build view; QA and
  Product Owners get a simple recorder, plain-language step lists, and pass/fail
  reports — no selectors, no stack traces.
- **Zero-setup baseline.** A static-only scenario runs immediately after install —
  no accounts, no keys, no configuration.
- **Team onboarding in one file.** LLM/DB settings export as an encrypted bundle;
  a teammate imports it with a passphrase and is ready to run.

## How it works

```
Record in browser ──► .aitomate.json in your repo ──► Anyone replays it
                          │
                          ├─ Static / random values: built in
                          ├─ AI values: your LLM provider (cloud or local)
                          └─ DB values: local read-only bridge (npx aitomate-bridge)
```

## Development

Requirements: Node ≥ 22, pnpm ≥ 11.

```bash
pnpm install
pnpm dev              # WXT dev mode with HMR (Chrome)
pnpm build            # production build → apps/extension/.output/chrome-mv3/
pnpm build:firefox    # Firefox build   → apps/extension/.output/firefox-mv2/
pnpm test             # all workspace tests (Vitest)
pnpm typecheck        # tsc --noEmit across packages
```

Load the built extension: `chrome://extensions` → enable Developer mode →
**Load unpacked** → select `apps/extension/.output/chrome-mv3`.

### Repository layout

```
apps/extension/     WXT extension app (React + TypeScript)
packages/schema/    @aitomate/schema — Zod schemas for scenario files (the contract)
AGENTS.md           Guide for AI coding agents working on this repo
```

## Roadmap

- **M1 — MVP**: recorder, replay engine, Static/Dynamic/AI resolvers, assertions,
  scenario chaining, run reports, onboarding wizard. *(in progress)*
- **M2 — Database & team config**: `aitomate-bridge` CLI (read-only MySQL/MariaDB +
  PostgreSQL), database resolver, encrypted config import/export.
- **M3 — Plugins & release**: declarative JSON plugins (custom actions), store
  packaging, docs, demo apps.
- **Backlog**: headless CI runner (Playwright-based) + Pest integration,
  TypeScript plugin SDK, multi-tab flows, visual regression.

## Contributing

AI coding agents should start with [`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE) © Prima Putra
