# Aitomate — Agent Guide

Browser extension for collaborative, AI-assisted test automation. Works on any
web app (server-rendered or SPA); Laravel apps are the reference targets, not a
dependency.

**Source of truth: `aitomate-spec-kit.md` (v0.3.2).** If anything here or in a
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
  T2.10 (Run view "Run all" — `lib/runner/suite.ts`'s `runSuite` is pure
  orchestration written test-first (TDD): given scenario refs + an injected
  `runOne` callback + a stop signal, it runs sequentially, aggregates a
  per-scenario pass/failed/skipped report, and never touches
  `browser.storage` or knows how a scenario actually executes — same
  separation as `chaining.ts`'s `SetupLookup`. `background.ts` wires the
  real callback by calling `runSequence` per scenario — do not duplicate
  `runSequence`'s step loop inline in the suite handler; the first
  implementation attempt copy-pasted the whole loop instead of reusing the
  function (`runSequence` now returns `{passed, error, results}` instead of
  `void` specifically so it can be reused this way). Suite stop is a
  separate `suiteControl` map from the per-scenario `runControl` — stopping
  a suite must set both: `runControl`'s `stopped` flag to cut the in-flight
  scenario short, and `suiteControl`'s flag so `runSuite` skips the rest.
  RunView's single-run state listener must ignore
  `aitomate:runner:state` broadcasts while `suiteRunning` is true — each
  scenario inside a suite broadcasts its own 'done' on the same tab, and
  without the guard the first one resets `runTabId` to `null`, so the
  final `suite-state` message (matched by `tabId === runTabId`) never
  arrives and the UI is stuck on "Running…" forever).
  T2.11 (Build view "Add step manually" — `lib/build/manual-step.ts`'s
  `buildManualStep(action, id)` builds a blank step of a given type; pure
  and unit-tested, id is passed in rather than generated inside so the
  function needs no `crypto` stubbing to test. The first junior draft
  generated ids from a module-level counter in `StepList.tsx` — that
  resets to 0 every time the popup unmounts (i.e. every time it's closed),
  so a second popup session could mint the same id as an already-persisted
  step, corrupting stepId-keyed matching in the runner. Fixed by generating
  with `crypto.randomUUID()` in `BuildView.tsx`'s `addStep`, at the call
  site, not inside the pure builder. The "+ Add step" row is Advanced-mode
  only (`StepList.tsx`) — a step needing a selector/URL/pattern is
  unfixable in Simple mode (only Fill's static value is Simple-editable
  per T2.6), so offering "add" there would create an uncompletable step.
  Blank fields fail schema validation (`selector.value`/`navigate.url`/
  `urlMatches.pattern` are all `min(1)`) but `buildScenarioObject` never
  validated before this — `handleSave`/`handleExport` now call
  `findIncompleteStep` (`lib/import-export.ts`) first and block with a
  plain-language "Step N (action) is missing …" message instead of saving/
  exporting a scenario that will only fail later, silently, on re-import or
  at runtime).
  T2.12 (Build view "Locate on page" — a "👁 Locate" button per step sends
  `aitomate:runner:locate-element` straight to the content script
  (`browser.tabs.sendMessage`, bypassing background — there's no run state
  to track, so no need to route through it), which scrolls the element
  into view and flashes its outline via `handleLocateElement` in
  `content.ts`. `stepSelector(step): Selector | undefined` — which step
  variant carries a selector, and which field — used to live duplicated in
  two places (`content.ts`'s frame-routing switch, and a sloppy
  `(step as any).selector || (step as any).forSelector` in `BuildView.tsx`);
  it's now one exported function in `lib/runner/dom.ts`, unit-tested, and
  both callers import it. Two real bugs the first junior draft had: (1) the
  `locate-element` case in `content.ts`'s message switch had no
  `sameFramePath` guard — `execute-step` and `wait-for-dom` both check it
  (every frame receives the message under `allFrames: true`; only the
  addressed frame may respond, per T2.2), but this case answered from every
  frame, so an iframe-targeted selector could race and report the wrong
  frame's "not found". (2) `BuildView.tsx` sent the message with the
  response cast away and never read it — the content script's plain-
  language "Element not found: …" error had nowhere to go, so a wrong
  selector produced a silent no-op instead of feedback, defeating the
  feature's entire purpose. Also: the "Locate" button now only renders when
  `stepSelector(step)` is non-empty (`StepList.tsx`) — a `navigate` step or
  a `wait` step with only `durationMs` has nothing to locate, so it no
  longer shows a button that does nothing when clicked).
  T2.13 (recorder navigation-step fix — `captureNavigation` in
  `lib/recorder/capture.ts` combines `reduceSession` + `buildNavigateStep`
  into one pure, TDD'd function; `background.ts`'s `webNavigation.onCommitted`
  handler now calls it instead of reducing the session and pushing the step
  inline. Same recurring pattern as T2.2/T2.3/T2.8: decision logic — push a
  step or not, based on session status and whether the URL actually changed —
  belongs in `lib/` with a test, not inline in an entrypoint. `buildNavigateStep`
  itself wasn't dead per se; `background.ts` was duplicating its shape by hand
  instead of calling it).
  T4.1 (`lib/runner/report.ts`'s `buildRunReport` — pure, TDD'd first: zips a
  scenario's `Step[]` against the `StepResult[]` `runSequence` already
  produces, keyed by `stepId` (not index — immune to any future reordering).
  The runner is fail-fast (`runner-session.ts`'s `STEP_FAIL` -> `'error'`), so
  `results` can be shorter than `steps`; steps with no matching result are
  reported `'skipped'`, not dropped, so a PO/QA can see what never ran.
  `passed` requires every step to have a result AND every result to have
  passed — an incomplete run (stopped early) counts as not passed even with
  zero actual failures. `screenshotOnFailure` is dropped unless the report
  failed. Does not capture anything itself — no `captureVisibleTab`, no
  console/network listeners — that's background.ts's job when it wires this
  in; this function only shapes data the caller already collected, same
  separation as `suite.ts`'s injected `runOne`. First draft typed
  `RunReportStep.action` as `string` via an `as string` cast instead of
  `Step['action']`, throwing away the literal union for no reason — fixed).
  T4.2 (Run view run-report UI — `background.ts`'s `runSequence` now calls
  `buildRunReport` after every single-scenario run and broadcasts it via a
  new `aitomate:runner:run-report` runtime message; `RunView.tsx` renders a
  pass/fail summary + per-step list, Advanced toggle reveals stepId/error/
  attempts/durationMs. Real bug found: `background.ts` broadcasts the final
  session `state` (done/error — which `RunView` uses to null out `runTabId`)
  *before* broadcasting the run-report for the same run. If React re-renders
  (applying that null) before the run-report message arrives, matching it on
  `runTabId` state drops the report — flaky, timing-dependent, same
  "state-machine edge case" category as T2.2's stale-control-map bug. Fixed
  with a `runTabIdRef` updated synchronously wherever a run starts, used only
  for the run-report match — sidesteps the React re-render timing race
  entirely).
  T4.3 (`lib/runner/report-export.ts` — `buildReportJson`/`buildReportHtml`/
  `buildReportFilename`, TDD'd first; pure string builders, no DOM access
  (mirrors `import-export.ts`'s `buildScenarioJson`/`buildSuiteZip` split —
  `downloadReport` is the separate DOM-touching wrapper, same as
  `downloadJson`). The HTML export is a real XSS surface: a step's `error`
  can echo page/assertion text and `scenarioName` is user-typed, and this
  file gets opened directly in a browser or attached to a bug ticket — every
  such field is escaped (`esc()`) before landing in the HTML string, verified
  by dedicated tests injecting `<script>`/`<img onerror>` payloads. Only
  style nit found: `buildReportFilename`'s sanitize regex dropped `-` from
  the allowed charset, unlike `buildSuiteZip`'s `[^a-zA-Z0-9_-]` — fixed to
  match).
  T4.4 (`lib/onboarding.ts`'s `reduceOnboarding` + `scenarioNeedsConfig`,
  TDD'd first — same reducer shape as `session.ts`/`runner-session.ts`.
  `scenarioNeedsConfig` is the single gate deciding whether the wizard's
  config step shows at all: a static/dynamic-array-only scenario skips
  straight to `complete` (Constitution: zero-setup baseline — no passphrase/
  connector prompt for a scenario that doesn't need one). `OnboardingWizard`
  (`components/OnboardingWizard.tsx`) drives the reducer and persists
  `aitomate:onboarding` to `storage.local` on completion/skip. Two real bugs
  in the first draft: (1) `RunView.tsx` and the wizard each independently
  read the same `aitomate:onboarding` storage key to decide visibility —
  two sources of truth for one flag, prone to drift if either check changes
  without the other. Fixed by making the wizard own its visibility
  end-to-end (mount-check + hide-on-complete); `RunView` now always renders
  it unconditionally. (2) A scenario imported *during* onboarding
  (`saveScenario`, called from inside the wizard) never appeared in
  `RunView`'s scenario list until the popup was reopened — the wizard
  bypasses `RunView`'s own import flow, so nothing triggered a refresh.
  Fixed by having `onComplete` call `RunView`'s `refresh()`).
  T4.5 (Firefox/Edge polyfill audit — `lib/cross-browser-audit.test.ts`
  scans `entrypoints/`, `lib/`, `components/` for direct `chrome.*` usage
  (Hard Constraint: `browser.*` only), currently green, guards regression.
  `lib/sidepanel.test.ts` locks in the T1.4 side-panel adapter's Chrome/
  Firefox fallback — that adapter shipped without a test of its own; this
  closes the gap. Both are verification/regression tests, not new product
  logic — the actual Firefox/Edge build + manual load-unpacked check is
  still a manual step, not something a unit test can cover).
  Base URL / `{{BASE_URL}}` resolution (found + fixed during manual MVP
  testing against `examples/demo-ssr/`): the spec (FR-3) always described
  `{{BASE_URL}}`-style placeholders, but no step-executor code ever resolved
  them — a scenario using the placeholder just navigated to the literal
  string. `resolveUrl` in `step-executor.ts` now does the substitution;
  `RunView.tsx` gained an optional "Base URL" input threaded through
  `RunnerCommand.play` -> `background.ts` (merged into `scenario.meta.baseUrl`
  before `runSequence`) -> `executeStepWithRetry`. Two things fixed on top of
  the initial patch: (1) `chaining.ts`'s `runSetup` never received `baseUrl`
  at all, so a setup scenario's own navigate steps (e.g. a login page) were
  silently skipped by the substitution the main scenario got — same
  "new orchestration path doesn't thread a needed value through" shape as
  past bugs; fixed by adding a `baseUrl` param to `runSetup` and passing
  `scenario.meta.baseUrl` from `background.ts`. (2) the original replace
  used a *string* replacement (`url.replace(pattern, baseUrl)`) — `$&`/`$$`/
  `` $` ``/`$'` are special in a string replacement, so a base URL
  containing a literal `$` would corrupt the resolved URL; fixed with a
  replacer *function* instead, which inserts the value literally.
  Manual testing against `examples/demo-ssr/` also surfaced: (1) a run-all
  (suite) never merged the Base URL override at all — only the single-run
  `play` handler did, same "new param, one call site" shape, this time one
  layer up at the message-protocol level (`aitomate:runner:play-suite` had
  no `baseUrl` field); (2) `executeNavigation` silently reported
  `passed: true` for a navigate step whose URL still contained a literal
  `{{BASE_URL}}` — `tabs.update` doesn't reject a non-absolute URL, so the
  real failure surfaced one step later as an unrelated "no content script"
  error instead of on the navigate step that actually caused it; fixed by
  failing that step directly with a plain-language message instead of
  limping forward; (3) the actual root cause once both of those were fixed:
  `RunView.tsx`'s `handleRun` was a `useCallback` with an **empty dependency
  array**, closing over `baseUrl`'s first-render value (`''`) forever —
  every run sent `baseUrl: undefined` regardless of what the field showed.
  `useCallback`/`useEffect` dependency arrays are a real functional claim,
  not bookkeeping — get one wrong and it's exactly as silent as a
  parameter never threaded to a call site, just one layer up the stack.
  Also added: live step progress in the Run view (`stepProgress` state,
  matched via `runTabIdRef` so it keeps updating during a suite run same as
  the run-report match) — before this, the UI only said "Running…" with no
  indication of which step was executing; `RunnerSessionState` already
  carried `currentStepIndex`/`totalSteps`, broadcast on every step, but
  nothing in the UI read it.
- Next: remaining spec §4 milestone items (Milestone 2: database/bridge,
  Milestone 3: plugins & release — see spec §4).
- Task list and milestone breakdown: spec §4.

## Commands

Run from repo root (pnpm workspaces):

| Command | What |
|---|---|
| `pnpm install` | install all workspaces |
| `pnpm dev` | WXT dev mode (Chrome, HMR) |
| `pnpm build` | production build → `apps/extension/output/chrome-mv3/` |
| `pnpm build:firefox` | Firefox build → `output/firefox-mv2/` |
| `pnpm test` | all workspace tests (Vitest) + Playwright E2E smoke |
| `pnpm --filter aitomate-extension test:e2e` | build + run E2E smoke only |
| `pnpm typecheck` | `tsc --noEmit` everywhere (runs `wxt prepare` first) |

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/output/chrome-mv3` (no leading dot — `wxt.config.ts` sets
`outDir: 'output'`, overriding WXT's dotfile default; a stray `.output/`
directory left from before that override was set is a stale, never-rebuilt
fossil — delete it, don't load unpacked from it).

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
  T2.3 (value resolution), T2.8 (setup chaining), T2.13 (navigation-step
  capture) — each time the fix was the same extraction.
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
  lock, zero-step scenario stuck). Also watch ordering across *two separate*
  broadcasts for the same event: if one message's handler resets a piece of
  state (e.g. a tabId used for matching) and a second, related message
  arrives shortly after, whether the second message still matches depends on
  React re-render timing, not message order — a race, not a guarantee.
  Caught in T4.2 (`run-report` broadcast sent after the `state` broadcast
  that nulls `runTabId`; fixed with a ref updated synchronously instead of
  relying on the state value).
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
- **A new orchestration path copy-pastes an existing one instead of reusing
  it.** If a function already runs a scenario/step loop (`runSequence`),
  adding a second execution mode (e.g. suite/batch) means calling it, not
  re-typing its body inline in a new message handler — two copies of the
  same state machine will drift the first time one gets a bugfix the other
  doesn't. If the existing function returns `void`, that's a sign it needs
  to start returning an outcome so it *can* be reused. Caught in T2.10 (the
  first suite-runner draft duplicated all of `runSequence`'s step loop
  inside the `play-suite` handler).
- **A new UI capability offered in a mode that can't complete it.** Before
  adding a button/action, check both Simple and Advanced editors actually
  support finishing what it starts — don't gate the *entry point* without
  checking the *edit path* matches. Caught in T2.11 (a Simple-mode "add
  step" button created steps with an empty selector, but Simple mode only
  lets you edit a Fill step's static value — no way to ever fill in that
  selector without switching modes first).
- **Save/export writes data without validating it against the schema
  first.** `buildScenarioObject`/`saveScenario`-style writes are not the
  same as `safeParseScenario`-style imports — only import was ever
  validated. A caller-generated object (manual step, template, etc.) can
  violate a `min(1)` constraint and get written/exported silently, failing
  only later on re-import or at runtime with a confusing error. Caught in
  T2.11 — fixed with `findIncompleteStep`, checked before save/export, not
  by relying on the schema to reject it downstream.
- **Client-generated ids from in-memory/module state instead of a durable
  or authoritative source.** A module-level counter (or any counter that
  lives only in the current JS realm) resets whenever that realm reloads —
  for a popup, that's every time the user closes and reopens it. If the
  list it's numbering persists across reloads (e.g. `storage.session`), the
  reset counter can mint an id that collides with one already saved. Prefer
  `crypto.randomUUID()`, or route through whatever component already owns
  authoritative id assignment (here, background's `nextStepId`). Caught in
  T2.11 (`step-manual-N` counter in `StepList.tsx`).
- **A new `all_frames` message case skips the frame guard every other case
  has.** With `allFrames: true`, every frame in the tab receives a runner
  command — `execute-step` and `wait-for-dom` both check `sameFramePath`/
  `framePath` before responding, or the wrong frame can win the
  `sendMessage` response race. Adding a new content-script message case
  needs the same check, every time — it's not a one-off fix, it's a
  standing rule for this file. Caught in T2.12 (`locate-element` answered
  from every frame unconditionally).
- **A response the sender never reads.** Sending a message and not awaiting/
  checking its result is only safe when the callee truly can't fail. If the
  content script can report `{found: false, error}`, something must surface
  that error — a `sendMessage` call decorated with `as any` and discarded is
  a sign the response was designed but the sender forgot to use it. Caught
  in T2.12 (`BuildView.tsx`'s "Locate" button ignored the found/error
  response entirely, so a bad selector produced a silent no-op instead of
  the plain-language error the content script had already built).
- **A new parameter is threaded to only one call site of a shared
  function.** `step-executor.ts`'s `executeStepWithRetry` is called from
  both `background.ts` (main scenario steps) and `chaining.ts`'s `runSetup`
  (setup-scenario steps) — adding a new optional param (e.g. `baseUrl`) to
  the function's signature and only updating the main-scenario call site
  leaves the other caller silently passing `undefined`, no type error, no
  test failure unless a test specifically exercises that second path. Grep
  every call site of a function before considering a new parameter "wired
  up". Caught when reviewing an in-progress `{{BASE_URL}}` resolution patch
  (`runSetup` never got the new `baseUrl` param, so a setup scenario's own
  navigate step silently skipped substitution). Same pattern resurfaced one
  layer up: `runSequence` got `scenario.meta.baseUrl` threaded through
  correctly, but the suite runner (`play-suite` handler in `background.ts`,
  reusing `runSequence` via `runSuite`'s injected callback per T2.10) called
  it with the raw stored scenario, never merging the Run view's Base URL
  override in first — "Run all" silently ignored Base URL while a single
  "Run" of the same scenario worked, since only the `play` handler merged
  it. `aitomate:runner:play-suite` didn't even have a `baseUrl` field on its
  message type at all. Found via manual testing: `{{BASE_URL}}/index.html`
  logged unresolved in the debug console, which pointed straight at a
  missing merge rather than a real "content script not injected" bug the
  error message ("Could not establish connection") suggested at first
  glance. Chasing this down also surfaced a real fail-loud gap: even after
  both merge sites were fixed, `executeNavigation` (`step-executor.ts`)
  still silently reported `passed: true` for a `navigate` step whose URL
  still contained a literal `{{BASE_URL}}` — `tabs.update` doesn't reject a
  non-absolute URL string, it just navigates nowhere real, so the actual
  failure surfaced one step later as an unrelated-looking "no content
  script" error on the *next* step, not on the navigate step that actually
  caused it. Fixed by checking for a leftover `{{BASE_URL}}` in the resolved
  URL and failing that step directly with a plain-language message, instead
  of letting the run limp forward on a URL that never went anywhere. That
  fail-loud fix is what finally surfaced the *actual* root cause: even with
  Base URL typed and the side panel open (ruling out "popup closed and reset
  the input"), the failure persisted — because `RunView.tsx`'s `handleRun`
  (the single-scenario "Run" button) was a `useCallback` with an **empty
  dependency array** closing over `baseUrl`. It captured the input's
  first-render value (`''`) forever; every subsequent run sent
  `baseUrl: undefined` no matter what the field showed on screen, since
  `useCallback([])` never picks up the state's current value on re-render.
  `handleRunAll` didn't have this bug (its deps already included `baseUrl`
  from the suite fix above) — only the more commonly-used single-Run path
  did. Fixed by adding `baseUrl` to `handleRun`'s dependency array. Lesson:
  `useCallback`/`useEffect` dependency arrays are not optional bookkeeping —
  an empty array is a real functional claim ("this closure never needs
  today's state"), and it's exactly as easy to get wrong silently as any of
  the "parameter threaded to only one call site" bugs above, just at the
  React-hook layer instead of the function-signature layer.
- **Two components independently read the same persisted flag to decide
  the same thing.** If a parent and child both read the same
  `storage.local`/`storage.session` key to each separately decide
  visibility/state, that's two sources of truth for one fact — they will
  drift the first time one side's check changes without the other's. Let
  the component that owns the behavior (usually the child) own the whole
  decision — mount check *and* hide-on-complete — and have the parent
  render it unconditionally. Caught in T4.4 (`RunView.tsx` and
  `OnboardingWizard.tsx` both read `aitomate:onboarding` independently).

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
