# Aitomate — Agent Guide

Browser extension for collaborative, AI-assisted test automation. Works on any
web app (server-rendered or SPA); Laravel apps are the reference targets, not a
dependency.

**Source of truth: `aitomate-spec-kit.md` (v0.3.0).** If anything here or in a
conversation contradicts the spec, the spec wins. Update the spec when a design
decision changes; bump its version and changelog.

## Status

- Done: T1.1 (scaffold), T1.2 (scenario schema + tests), T1.3 (encrypted vault
  in `apps/extension/lib/vault/` + Vitest/WxtVitest infra), T1.4 (popup +
  side-panel shell with Build/Run/Settings nav in `components/AppShell.tsx`;
  side-panel opened via popup button → `lib/sidepanel.ts` — NOT
  `setPanelBehavior`, which is dead when `default_popup` is set; Build
  Simple/Advanced toggle persisted via `lib/ui-prefs.ts`).
- Next: T1.5 (Playwright E2E smoke harness — unit-test infra already in place).
- Task list and milestone breakdown: spec §4.

## Commands

Run from repo root (pnpm workspaces):

| Command | What |
|---|---|
| `pnpm install` | install all workspaces |
| `pnpm dev` | WXT dev mode (Chrome, HMR) |
| `pnpm build` | production build → `apps/extension/.output/chrome-mv3/` |
| `pnpm build:firefox` | Firefox build → `.output/firefox-mv2/` |
| `pnpm test` | all workspace tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` everywhere (runs `wxt prepare` first) |

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`.

## Structure

```
apps/extension/          WXT app (React 19 + TS). WXT conventions are load-bearing:
  entrypoints/           file locations here define the manifest
    background.ts        service worker — runner state machine (T2.2)
    content.ts           recorder + playback DOM layer (T2.1, T2.4)
    popup/               React popup UI
  lib/vault/             encrypted secrets vault (AES-GCM + PBKDF2; entry names
                         are plaintext by design — see module doc)
  wxt.config.ts          manifest config (permissions, modules)
packages/schema/         @aitomate/schema — Zod schemas + TS types (THE contract)
  src/                   selector, resolver, assertion, step, scenario, parse
  test/                  fixtures incl. spec §3.3 example; must always parse
```

Planned (not yet created): `packages/bridge` (M2, local DB sidecar), `examples/`,
`docs/` — see spec §6.

## Hard Constraints

- **Schema is the cross-package contract.** Any change to `packages/schema` must
  keep the spec §3.3 example parsing, update the spec, and consider
  `schemaVersion` compatibility. Never put credentials/secrets fields in
  scenario or plugin schemas — secrets live only in the vault (spec FR-3, FR-9).
- **Cross-browser:** use `browser.*` (WXT polyfill), never `chrome.*`. No
  Chrome-only API without fallback. Firefox side panel = `sidebar_action`, not
  `sidePanel`.
- **MV3 CSP:** no `eval`, no remote code, no dynamic plugin code — v1 plugins are
  declarative JSON only (spec FR-4).
- **Static-only scenarios need zero setup** — no passphrase/config prompts on
  that path (Constitution: zero-setup baseline).
- **Errors shown to PO/QA are plain language**, never stack traces or raw
  selectors (Constitution: fail loud, fail clear).
- License: MIT.

## Tooling Notes

- Zod v4 (`zod@^4`) — use v4 APIs (`z.core.$ZodIssue`, discriminated unions
  compose/nest). TypeScript 7.
- `apps/extension/tsconfig.json` extends generated `./.wxt/tsconfig.json`; run
  `pnpm typecheck` (or `wxt prepare`) after changing entrypoints so generated
  types refresh.
- pnpm build-script approvals live in `pnpm-workspace.yaml` (`allowBuilds`). If
  install prints "Run pnpm approve-builds", add the package there instead.
- Do not add a `postinstall: wxt prepare` script — it breaks first install
  (wxt bin not linked yet).
- Firefox build warns about missing `browser_specific_settings.id` — add a real
  add-on ID before store submission (T6.4).

## Testing

- Unit: Vitest per package (`pnpm test`). Schema package: valid + invalid
  fixture per schema variant.
- Extension unit tests (once T1.5 lands): Vitest + `WxtVitest` plugin from
  `wxt/testing` (fake `browser.*` APIs via @webext-core/fake-browser).
- E2E smoke (T1.5): Playwright chromium persistent context loading the built
  extension. Chromium-only; Firefox is a manual pre-release check.
- Definition of done for engine tasks: unit tests included, `pnpm test`,
  `pnpm typecheck`, and `pnpm build` all pass.
