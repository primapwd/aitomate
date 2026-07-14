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
  T2.8 (scenario chaining in `lib/runner/chaining.ts` — `runSetup`/
  `checkSessionMarker` extracted out of background.ts and unit-tested with
  fakeBrowser, same pattern as step-executor.ts, since this decision logic
  — chain-depth guard, marker skip, plain-language "Setup failed:" messages
  — is too significant to leave untested as background "integration glue".
  `meta.sessionMarker` is checked as a single-shot assertion with no retry
  and a short timeout — it answers "is the session active right now", not
  "wait for it to become active"; session expiry is the expected eventual
  outcome, not a transient failure, so retrying it the way a normal assert
  step does would burn 30s+ per setup-guarded run for nothing. One level of
  chaining only — a setup declaring its own setup is rejected).
  T3.1 (`lib/runner/llm/provider.ts` — OpenAI-compatible + Anthropic-compatible
  adapters. Three distinct reasoning-model shapes, not one: OpenAI o1/o3 use
  `max_completion_tokens` + `reasoning_effort`; DeepSeek-R1/deepseek-reasoner
  are OpenAI-compatible but still use plain `max_tokens`; Anthropic extended
  thinking is a `thinking: {budget_tokens}` block, and its response answer is
  the first `type: "text"` content block, not `content[0]`. An empty
  completion is a thrown error, not a silently-returned empty string — a
  reasoning model can exhaust its budget on hidden reasoning tokens before
  producing an answer. The response cache key includes provider+model+effort,
  not just prompt, so switching config can't return a stale answer),
  T3.2 (`lib/runner/value-resolver.ts` resolves `dynamic/ai` via an injected
  `LlmGenerateFn` — but that alone doesn't make it runnable. The actual wiring
  to a real provider is `lib/runner/llm/resolve-provider.ts`'s
  `buildLlmGenerate()`, threaded through `executeStepWithRetry`/`runSetup` from
  `background.ts`. A resolver module existing in isolation is not the same as
  the feature working — check the call site actually passes the callback),
  T3.3 (LLM provider settings UI in `components/views/SettingsView.tsx` +
  vault message protocol in `lib/vault/messages.ts`. The popup and background
  each run their own `Vault` instance (separate JS realms, no shared
  in-memory key) over the same `browser.storage` — a plain `initialize()`
  call from background after the popup already created the vault hits the
  "already exists" guard and throws, leaving the background instance's key
  unset (i.e. still locked) even though the UI reports success. Fixed via
  `unlockOrInitialize()` in `lib/vault/vault.ts`, which falls back to
  `unlock()` once the vault already exists — the two instances derive the
  same key from the same passphrase+salt, so this always succeeds. Minimum
  passphrase length is 8, not 4 — this vault guards API keys).
  T2.9 (Build view "Save to library" — `handleSave` in `BuildView.tsx` calls
  `upsertScenario` (`lib/import-export.ts`), which matches by
  `scenario.meta.name` and replaces on collision — no export-then-import
  round trip. A blank scenario name defaults to `"Untitled Scenario"`
  (`buildScenarioObject`), so two unnamed saves collide by default; the
  first shipped version overwrote silently with no warning. Fixed by
  checking `findScenarioByName` before saving and gating the overwrite
  behind `window.confirm` — a declined confirm shows a distinct
  "not saved" message instead of the same green "Saved ✓" a real save
  gets (Constitution: fail loud, fail clear — a success indicator must
  never mask a destroyed scenario)).
- Next: T2.10 (Run view "Run suite" — sequential batch execution across
  stored scenarios). Closes the remaining gap between the shipped UI and
  spec FR-5 found after T3.3 review; see spec changelog 0.3.1. T4.2 (Run
  view run-report UI) follows after.
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

## Common Mistakes (read before starting a task)

Patterns caught in review across T2.2–T2.8, most repeated first. Check your
own diff against this list before calling a task done.

- **Decision logic written in an entrypoint instead of `lib/` with a test.**
  `entrypoints/background.ts` and `entrypoints/content.ts` are integration
  glue (wiring + browser APIs) — not the place for anything with a branch a
  reviewer would need to reason about. If it has an if/switch that encodes a
  rule (a guard, a retry policy, a message-shape decision), it belongs in
  `lib/` with a `.test.ts` sibling, even if it needs `fakeBrowser` to test
  (see `step-executor.ts`, `chaining.ts`). Repeated in T2.2 (DOM helpers),
  T2.3 (value resolution), T2.8 (setup chaining) — each time the fix was the
  same extraction.
- **Dead or half-finished code left in place.** A cache that's written but
  never read, a comment describing behavior the code doesn't actually do, a
  leftover reasoning note — delete it or wire it up, don't ship it half-done.
  (T2.2 had a dead reduce call + stray reasoning comment; T2.8 had a `Set`
  that was populated but never consulted.)
- **Plain-language errors leak internals.** Never put a task/ticket ID
  (`"not implemented (T3.2)"`) or a raw selector in a message a PO/QA sees.
  Simple mode never shows selector syntax at all — only Advanced does
  (Constitution: fail loud, fail clear). Caught in T2.3 and T2.6.
  Also don't retry/poll a check that answers "is this true right now" (a
  session marker, a precondition) the same way you'd retry a flaky action —
  if the expected eventual state is "false", retrying just burns time (T2.8).
- **A new broadcast channel doesn't reach every listener.** This codebase
  has two: `tabs.sendMessage` (content script in a specific tab) and
  `runtime.sendMessage` (popup/side panel, not tab-scoped). Adding a UI that
  listens on the runtime channel means the background sender needs a
  matching broadcast there too, tagged with `tabId` so a panel can filter to
  its own tab — don't assume the existing tab-scoped broadcast covers a new
  UI surface. Caught in T2.6 (recorder state) and T2.7 (runner state).
- **State-machine edge cases not walked through.** Before shipping a
  reducer/loop with persisted state, trace: What if this runs twice
  concurrently? What if the service worker restarts mid-run (storage.session
  persists, in-memory control maps don't)? What if the input is empty? Each
  of these had a real bug in T2.2 (stale control map, permanent "playing"
  lock, zero-step scenario stuck).
- **New `lib/` file shipped without a paired `.test.ts`.** Even glue-ish
  code (import/export, message builders) gets a test if it lives in `lib/` —
  it's the thing that makes it reviewable without re-deriving the logic by
  eye. Caught in T2.7 (`import-export.ts` initially had zero tests).
- **A silent overwrite dressed up as a success message.** An upsert-by-name
  save (or any "create or replace" action) must not show the same success
  UI for "created new" and "destroyed an existing one" — confirm before the
  destructive path, or at least say which one happened. Caught in T2.9
  (`upsertScenario`'s default `"Untitled Scenario"` name meant two unnamed
  saves silently clobbered each other, both showing "Saved ✓").

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
