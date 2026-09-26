# Aitomate

**Collaborative, AI-assisted test automation — right in your browser.**

Aitomate is an open-source browser extension (Chrome, Edge, Firefox) that lets
developers record UI test scenarios once, commit them to the repo as plain JSON,
and lets QA engineers and Product Owners run — or even build — those same
scenarios without writing a line of code.

> **Status: MVP in active development.** The extension supports recording,
> editing, saving, importing/exporting, and running scenarios, including suites,
> AI-assisted values, and run reports. Unfocused runs are still outstanding;
> database support, team configuration sharing, and plugins are planned. See
> [Roadmap](#roadmap).

## Why

Teams need UI tests that non-developers can actually run. Existing options are
either developer-only (Playwright, Selenium), locked to a vendor cloud, or
can't fill forms with anything smarter than fixed strings. Aitomate aims for:

- **Record once, run anywhere.** Scenarios are portable `.aitomate.json` files —
  human-readable, git-diffable, committed next to your app code.
- **Smart form filling.** Implemented modes are:
  - **Static** — fixed value.
  - **Dynamic** — random pick from a list, or **AI-generated** from a natural-language
    prompt ("realistic Indonesian full name") via your configured LLM provider or a
    compatible local model. Database values through a local, read-only bridge are
    planned, not implemented yet.
- **Framework-agnostic.** Tests any website: server-rendered (Laravel Blade, Rails,
  Django) or SPA (React, Vue, Svelte, Angular). Handles React controlled inputs,
  hydration waits, open shadow DOM, and same-origin iframes.
- **Built for three personas.** Developers get an advanced build view; QA and
  Product Owners get a simple recorder, plain-language step lists, and pass/fail
  reports — no selectors, no stack traces.
- **Zero-setup baseline.** A static-only scenario runs immediately after install —
  no accounts, no keys, no configuration.
- **Local secret storage.** LLM keys are kept in the encrypted local vault and never
  stored in scenario files. Encrypted team configuration sharing is planned.

## How it works

```
Record in browser ──► .aitomate.json in your repo ──► Anyone replays it
                          │
                          ├─ Static / random values: built in
                          ├─ AI values: configured LLM provider (cloud or local)
                          └─ DB values: planned local read-only bridge
```

## Development

Requirements: Node ≥ 22, pnpm ≥ 11.

```bash
pnpm install
pnpm dev              # WXT dev mode with HMR (Chrome)
pnpm build            # production build → apps/extension/output/chrome-mv3/
pnpm build:firefox    # Firefox build   → apps/extension/output/firefox-mv2/
pnpm test             # all workspace tests (Vitest)
pnpm typecheck        # tsc --noEmit across packages
```

Load the built extension: `chrome://extensions` → enable Developer mode →
**Load unpacked** → select `apps/extension/output/chrome-mv3`.

### Repository layout

```
apps/extension/     WXT extension app (React + TypeScript)
packages/schema/    @aitomate/schema — Zod schemas for scenario files (the contract)
AGENTS.md           Guide for AI coding agents working on this repo
```

## Roadmap

- **M1 — MVP**: recorder, replay engine, Static/Dynamic/AI resolvers, assertions,
  scenario chaining, suites, run reports, onboarding, and environment profiles are
  implemented. Unfocused runs (running in a non-active tab) remain to be done.
- **M2 — Database & team config**: `aitomate-bridge` CLI (read-only MySQL/MariaDB +
  PostgreSQL), database resolver, encrypted config import/export, and team manifest
  support. Not implemented yet.
- **M3 — Plugins & release**: declarative JSON plugins (custom actions), store
  packaging, persona-specific documentation, and server-rendered and SPA examples.
  Not implemented yet.
- **Backlog**: standalone CI runner (Playwright-based) + Pest integration,
  TypeScript plugin SDK, multi-tab flows, cross-origin iframe support, deeper
  scenario chaining, SQLite bridge support, and visual regression.

## Contributing

AI coding agents should start with [`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE) © Prima Putra
