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
  Simple/Advanced toggle persisted via `lib/ui-prefs.ts`), T1.5 (Playwright
  E2E smoke harness in `apps/extension/e2e/` — chromium persistent context
  via `--load-extension`, needs `--headless=new` for the MV3 service worker
  to start headless; `pnpm test:e2e` builds then runs it; root `pnpm test`
  runs Vitest across workspaces then e2e), T2.1 (content-script recorder in
  `lib/recorder/` + `entrypoints/content.ts` — selector generation, shadow/
  frame path, CSRF exclusion, and the pause-on-navigate/new-tab session
  machine are pure and unit-tested; DOM wiring and background message
  routing are integration glue, exercised via the build + e2e smoke, not
  unit tests. Recordings persist per tab in `storage.session` via
  `lib/recorder/store.ts` — worker memory alone dies with the MV3
  service worker's ~30s idle teardown), T2.2 (runner in `lib/runner/` +
  background orchestration loop — state machine, per-step retry/backoff,
  smart-wait via MutationObserver, per-tab run store in `storage.session`;
  step execution in `entrypoints/content.ts` is frame-gated: with
  `allFrames: true` only the frame matching the step selector's `framePath`
  may respond, or a wrong-frame "not found" wins the sendMessage race),
  T2.3 (value resolvers in `lib/runner/value-resolver.ts` — static +
  dynamic/array (random|sequential); resolved once in the background before
  the retry loop so the content script only ever sees a static resolver and
  retries reuse the same value; unimplemented modes (ai/database/param) fail
  the step with a plain-language error instead of throwing — `runSequence`
  expects a StepResult, never a rejection; sequential counters are in-memory
  keyed by `JSON.stringify(values)`, reset on SW restart by design),
  T2.4 (playback hardening — `setNativeValue` in `lib/runner/dom.ts` uses
  the native prototype setter + input/change dispatch so React/Vue
  controlled inputs register fills; checkbox/radio go through
  `setNativeChecked` (click-based — their state is `checked`, not `value`);
  upload replay builds a `DataTransfer` from fixtures bundled in
  `public/fixtures/`, which must stay listed in `web_accessible_resources`
  (wxt.config.ts, MV2 + MV3 shapes) or the content-script fetch is blocked;
  recorder now emits `upload` steps for file inputs with the file name as a
  placeholder fixtureRef), T2.5 (all 9 FR-7 assertions executable in
  `executeAssert` — each polls via `waitForAssertion` in `lib/runner/dom.ts`
  until true or timeout (default 10s, `step.options.timeoutMs` overrides —
  note the same knob also bounds the pre-step DOM-stability wait); failures
  produce plain-language expected-vs-actual messages), T2.6 (Build view step
  editor in `components/views/build/` — record/stop/resume controls, step
  list with reorder/delete, Advanced-only edits for static fill values, URLs
  and timeouts; Simple mode never shows raw selector syntax (Constitution).
  Background broadcasts `aitomate:recorder:state-change` (with tabId — an
  open panel must ignore other tabs) to popup/side panel on every state
  change AND every captured step, so an open side panel updates live;
  step edits go back via `aitomate:recorder:set-steps`/`update-step`.
  Popup/sidepanel mount in StrictMode — never latch a `mounted` ref false
  in effect cleanup without re-setting it true in the effect body.
  Advanced mode edits selector (strategy+value), resolver (static/array/
  ai/database presets), assertion params, URL/wait/fixture, timeout/retry;
  the dynamic-array value list uses a local-draft JSON input (a controlled
  input bound to JSON.stringify is uneditable — intermediate keystrokes are
  invalid JSON). Assertion *kind* is not switchable and per-step session
  marker has no schema field yet — both deferred, marker to T2.8).
  T2.7 (`lib/import-export.ts` — single-scenario export builds a schema-valid
  `.aitomate.json` from recorded steps + meta (name/description/baseUrl/tags);
  import validates via `safeParseScenario`, stores in `storage.local` under
  `aitomate:scenarios`; Run view lists/runs/deletes stored scenarios and
  re-enables its Run button via the `aitomate:runner:state` runtime
  broadcast, which carries `tabId` — panels must filter their own tab.
  Suite export is a hand-rolled ZIP (`buildSuiteZip`, store method, no
  external dep) — verified byte-for-byte against `unzip`/Python `zipfile`;
  filenames are deduped when scenario names sanitize to the same string,
  e.g. two scenarios both named "Login Test" or non-ASCII names that all
  collapse to `___`).
- Next: T2.8 (scenario chaining + `meta.sessionMarker`), T4.2 (Run view
  run-report UI; runs driven via `aitomate:runner:play|pause|resume|stop`).
- Task list and milestone breakdown: spec §4.

## Commands

Run from repo root (pnpm workspaces):

| Command | What |
|---|---|
| `pnpm install` | install all workspaces |
| `pnpm dev` | WXT dev mode (Chrome, HMR) |
| `pnpm build` | production build → `apps/extension/.output/chrome-mv3/` |
| `pnpm build:firefox` | Firefox build → `.output/firefox-mv2/` |
| `pnpm test` | all workspace tests (Vitest) + Playwright E2E smoke |
| `pnpm --filter aitomate-extension test:e2e` | build + run E2E smoke only |
| `pnpm typecheck` | `tsc --noEmit` everywhere (runs `wxt prepare` first) |

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`.

## Structure

```
apps/extension/          WXT app (React 19 + TS). WXT conventions are load-bearing:
  entrypoints/           file locations here define the manifest
    background.ts        service worker — recorder session store (T2.1) +
                         runner state machine (T2.2)
    content.ts           recorder DOM layer (T2.1) + playback (T2.4)
    popup/               React popup UI
  lib/recorder/           selector generation (testid>id>aria>css>text),
                         shadow/frame path, CSRF/hidden exclusion, pause-on-
                         navigate/new-tab session machine, message protocol
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
- Extension unit tests: Vitest + `WxtVitest` plugin from `wxt/testing` (fake
  `browser.*` APIs via @webext-core/fake-browser); `vitest.config.ts` excludes
  `e2e/**` so Playwright specs don't get picked up by Vitest.
- E2E smoke: Playwright, `apps/extension/e2e/`, chromium persistent context
  loading the built extension via `--load-extension` (needs `--headless=new`
  for the MV3 background service worker to start under headless Chromium).
  Covers: extension loads (manifest + service worker), popup renders the
  Build/Run/Settings shell. Chromium-only; Firefox is a manual pre-release
  check. A third smoke case — a bundled static-only scenario running green
  against a local demo page — lands once the runner + a demo target exist.
- Definition of done for engine tasks: unit tests included, `pnpm test`,
  `pnpm typecheck`, and `pnpm build` all pass.
