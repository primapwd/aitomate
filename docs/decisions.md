# Decisions & Task History

Detailed, chronological record of what shipped per task, plus the bugs found
and fixed along the way — the "why" behind design choices, not just the
"what". `AGENTS.md`'s Status section links here; keep that section to
one-liners and put narrative detail here instead.

- T1.1 scaffold.
- T1.2 scenario schema + tests.
- T1.3 encrypted vault in `apps/extension/lib/vault/` + Vitest/WxtVitest infra.
- T1.4 popup + side-panel shell with Build/Run/Settings nav in
  `components/AppShell.tsx`; side-panel opened via popup button →
  `lib/sidepanel.ts` — NOT `setPanelBehavior`, which is dead when
  `default_popup` is set; Build Simple/Advanced toggle persisted via
  `lib/ui-prefs.ts`.
- T1.5 Playwright E2E smoke harness in `apps/extension/e2e/` — chromium
  persistent context via `--load-extension`, needs `--headless=new` for the
  MV3 service worker to start headless; `pnpm test:e2e` builds then runs it;
  root `pnpm test` runs Vitest across workspaces then e2e.
- T2.1 content-script recorder in `lib/recorder/` + `entrypoints/content.ts`
  — selector generation, shadow/frame path, CSRF exclusion, and the
  pause-on-navigate/new-tab session machine are pure and unit-tested; DOM
  wiring and background message routing are integration glue, exercised via
  the build + e2e smoke, not unit tests. Recordings persist per tab in
  `storage.session` via `lib/recorder/store.ts` — worker memory alone dies
  with the MV3 service worker's ~30s idle teardown.
- T2.2 runner in `lib/runner/` + background orchestration loop — state
  machine, per-step retry/backoff, smart-wait via MutationObserver, per-tab
  run store in `storage.session`; step execution in `entrypoints/content.ts`
  is frame-gated: with `allFrames: true` only the frame matching the step
  selector's `framePath` may respond, or a wrong-frame "not found" wins the
  sendMessage race.
- T2.3 value resolvers in `lib/runner/value-resolver.ts` — static +
  dynamic/array (random|sequential); resolved once in the background before
  the retry loop so the content script only ever sees a static resolver and
  retries reuse the same value; unimplemented modes (ai/database/param) fail
  the step with a plain-language error instead of throwing — `runSequence`
  expects a StepResult, never a rejection; sequential counters are in-memory
  keyed by `JSON.stringify(values)`, reset on SW restart by design.
- T2.4 playback hardening — `setNativeValue` in `lib/runner/dom.ts` uses the
  native prototype setter + input/change dispatch so React/Vue controlled
  inputs register fills; checkbox/radio go through `setNativeChecked`
  (click-based — their state is `checked`, not `value`); upload replay
  builds a `DataTransfer` from fixtures bundled in `public/fixtures/`, which
  must stay listed in `web_accessible_resources` (wxt.config.ts, MV2 + MV3
  shapes) or the content-script fetch is blocked; recorder now emits
  `upload` steps for file inputs with the file name as a placeholder
  fixtureRef.
- T2.5 all 9 FR-7 assertions executable in `executeAssert` — each polls via
  `waitForAssertion` in `lib/runner/dom.ts` until true or timeout (default
  10s, `step.options.timeoutMs` overrides — note the same knob also bounds
  the pre-step DOM-stability wait); failures produce plain-language
  expected-vs-actual messages.
- T2.6 Build view step editor in `components/views/build/` — record/stop/
  resume controls, step list with reorder/delete, Advanced-only edits for
  static fill values, URLs and timeouts; Simple mode never shows raw
  selector syntax (Constitution). Background broadcasts
  `aitomate:recorder:state-change` (with tabId — an open panel must ignore
  other tabs) to popup/side panel on every state change AND every captured
  step, so an open side panel updates live; step edits go back via
  `aitomate:recorder:set-steps`/`update-step`. Popup/sidepanel mount in
  StrictMode — never latch a `mounted` ref false in effect cleanup without
  re-setting it true in the effect body. Advanced mode edits selector
  (strategy+value), resolver (static/array/ai/database presets), assertion
  params, URL/wait/fixture, timeout/retry; the dynamic-array value list uses
  a local-draft JSON input (a controlled input bound to JSON.stringify is
  uneditable — intermediate keystrokes are invalid JSON). Assertion *kind*
  is not switchable and per-step session marker has no schema field yet —
  both deferred, marker to T2.8.
- T2.7 `lib/import-export.ts` — single-scenario export builds a schema-valid
  `.aitomate.json` from recorded steps + meta (name/description/baseUrl/
  tags); import validates via `safeParseScenario`, stores in `storage.local`
  under `aitomate:scenarios`; Run view lists/runs/deletes stored scenarios
  and re-enables its Run button via the `aitomate:runner:state` runtime
  broadcast, which carries `tabId` — panels must filter their own tab. Suite
  export is a hand-rolled ZIP (`buildSuiteZip`, store method, no external
  dep) — verified byte-for-byte against `unzip`/Python `zipfile`; filenames
  are deduped when scenario names sanitize to the same string, e.g. two
  scenarios both named "Login Test" or non-ASCII names that all collapse to
  `___`.
- T2.8 scenario chaining in `lib/runner/chaining.ts` — `runSetup`/
  `checkSessionMarker` extracted out of background.ts and unit-tested with
  fakeBrowser, same pattern as step-executor.ts, since this decision logic —
  chain-depth guard, marker skip, plain-language "Setup failed:" messages —
  is too significant to leave untested as background "integration glue".
  `meta.sessionMarker` is checked as a single-shot assertion with no retry
  and a short timeout — it answers "is the session active right now", not
  "wait for it to become active"; session expiry is the expected eventual
  outcome, not a transient failure, so retrying it the way a normal assert
  step does would burn 30s+ per setup-guarded run for nothing. One level of
  chaining only — a setup declaring its own setup is rejected.
- T3.1 `lib/runner/llm/provider.ts` — OpenAI-compatible + Anthropic-compatible
  adapters. Three distinct reasoning-model shapes, not one: OpenAI o1/o3 use
  `max_completion_tokens` + `reasoning_effort`; DeepSeek-R1/deepseek-reasoner
  are OpenAI-compatible but still use plain `max_tokens`; Anthropic extended
  thinking is a `thinking: {budget_tokens}` block, and its response answer is
  the first `type: "text"` content block, not `content[0]`. An empty
  completion is a thrown error, not a silently-returned empty string — a
  reasoning model can exhaust its budget on hidden reasoning tokens before
  producing an answer. The response cache key includes provider+model+effort,
  not just prompt, so switching config can't return a stale answer.
- T3.2 `lib/runner/value-resolver.ts` resolves `dynamic/ai` via an injected
  `LlmGenerateFn` — but that alone doesn't make it runnable. The actual
  wiring to a real provider is `lib/runner/llm/resolve-provider.ts`'s
  `buildLlmGenerate()`, threaded through `executeStepWithRetry`/`runSetup`
  from `background.ts`. A resolver module existing in isolation is not the
  same as the feature working — check the call site actually passes the
  callback.
- T3.3 LLM provider settings UI in `components/views/SettingsView.tsx` +
  vault message protocol in `lib/vault/messages.ts`. The popup and
  background each run their own `Vault` instance (separate JS realms, no
  shared in-memory key) over the same `browser.storage` — a plain
  `initialize()` call from background after the popup already created the
  vault hits the "already exists" guard and throws, leaving the background
  instance's key unset (i.e. still locked) even though the UI reports
  success. Fixed via `unlockOrInitialize()` in `lib/vault/vault.ts`, which
  falls back to `unlock()` once the vault already exists — the two
  instances derive the same key from the same passphrase+salt, so this
  always succeeds. Minimum passphrase length is 8, not 4 — this vault
  guards API keys.
- T2.9 Build view "Save to library" — `handleSave` in `BuildView.tsx` calls
  `upsertScenario` (`lib/import-export.ts`), which matches by
  `scenario.meta.name` and replaces on collision — no export-then-import
  round trip. A blank scenario name defaults to `"Untitled Scenario"`
  (`buildScenarioObject`), so two unnamed saves collide by default; the
  first shipped version overwrote silently with no warning. Fixed by
  checking `findScenarioByName` before saving and gating the overwrite
  behind `window.confirm` — a declined confirm shows a distinct "not saved"
  message instead of the same green "Saved ✓" a real save gets (Constitution:
  fail loud, fail clear — a success indicator must never mask a destroyed
  scenario). Superseded by the slug-based dedupe further down — see there.
- T2.10 Run view "Run all" — `lib/runner/suite.ts`'s `runSuite` is pure
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
  RunView's single-run state listener must ignore `aitomate:runner:state`
  broadcasts while `suiteRunning` is true — each scenario inside a suite
  broadcasts its own 'done' on the same tab, and without the guard the
  first one resets `runTabId` to `null`, so the final `suite-state` message
  (matched by `tabId === runTabId`) never arrives and the UI is stuck on
  "Running…" forever.
- T2.11 Build view "Add step manually" — `lib/build/manual-step.ts`'s
  `buildManualStep(action, id)` builds a blank step of a given type; pure
  and unit-tested, id is passed in rather than generated inside so the
  function needs no `crypto` stubbing to test. The first junior draft
  generated ids from a module-level counter in `StepList.tsx` — that resets
  to 0 every time the popup unmounts (i.e. every time it's closed), so a
  second popup session could mint the same id as an already-persisted step,
  corrupting stepId-keyed matching in the runner. Fixed by generating with
  `crypto.randomUUID()` in `BuildView.tsx`'s `addStep`, at the call site,
  not inside the pure builder. The "+ Add step" row is Advanced-mode only
  (`StepList.tsx`) — a step needing a selector/URL/pattern is unfixable in
  Simple mode (only Fill's static value is Simple-editable per T2.6), so
  offering "add" there would create an uncompletable step. Blank fields
  fail schema validation (`selector.value`/`navigate.url`/
  `urlMatches.pattern` are all `min(1)`) but `buildScenarioObject` never
  validated before this — `handleSave`/`handleExport` now call
  `findIncompleteStep` (`lib/import-export.ts`) first and block with a
  plain-language "Step N (action) is missing …" message instead of saving/
  exporting a scenario that will only fail later, silently, on re-import or
  at runtime.
- T2.12 Build view "Locate on page" — a "👁 Locate" button per step sends
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
  longer shows a button that does nothing when clicked.
- T2.13 recorder navigation-step fix — `captureNavigation` in
  `lib/recorder/capture.ts` combines `reduceSession` + `buildNavigateStep`
  into one pure, TDD'd function; `background.ts`'s `webNavigation.onCommitted`
  handler now calls it instead of reducing the session and pushing the step
  inline. Same recurring pattern as T2.2/T2.3/T2.8: decision logic — push a
  step or not, based on session status and whether the URL actually changed
  — belongs in `lib/` with a test, not inline in an entrypoint.
  `buildNavigateStep` itself wasn't dead per se; `background.ts` was
  duplicating its shape by hand instead of calling it.
- T4.1 `lib/runner/report.ts`'s `buildRunReport` — pure, TDD'd first: zips a
  scenario's `Step[]` against the `StepResult[]` `runSequence` already
  produces, keyed by `stepId` (not index — immune to any future reordering).
  The runner is fail-fast (`runner-session.ts`'s `STEP_FAIL` -> `'error'`),
  so `results` can be shorter than `steps`; steps with no matching result
  are reported `'skipped'`, not dropped, so a PO/QA can see what never ran.
  `passed` requires every step to have a result AND every result to have
  passed — an incomplete run (stopped early) counts as not passed even with
  zero actual failures. `screenshotOnFailure` is dropped unless the report
  failed.
- T4.2 Run view run-report UI — `background.ts`'s `runSequence` now calls
  `buildRunReport` after every single-scenario run and broadcasts it via a
  new `aitomate:runner:run-report` runtime message; `RunView.tsx` renders a
  pass/fail summary + per-step list, Advanced toggle reveals stepId/error/
  attempts/durationMs. Real bug found: `background.ts` broadcasts the final
  session `state` (done/error — which `RunView` uses to null out `runTabId`)
  *before* broadcasting the run-report for the same run. If React
  re-renders (applying that null) before the run-report message arrives,
  matching it on `runTabId` state drops the report — flaky, timing-
  dependent, same "state-machine edge case" as T2.2's stale-control-map bug.
  Fixed with a `runTabIdRef` updated synchronously wherever a run starts,
  used only for the run-report match — sidesteps the React re-render timing
  race entirely.
- T4.3 `lib/runner/report-export.ts` — `buildReportJson`/`buildReportHtml`/
  `buildReportFilename`, TDD'd first; pure string builders, no DOM access.
  The HTML export is a real XSS surface: a step's `error` can echo
  page/assertion text and `scenarioName` is user-typed, and this file gets
  opened directly in a browser or attached to a bug ticket — every such
  field is escaped (`esc()`) before landing in the HTML string, verified by
  dedicated tests injecting `<script>`/`<img onerror>` payloads.
- T4.4 `lib/onboarding.ts`'s `reduceOnboarding` + `scenarioNeedsConfig`,
  TDD'd first — same reducer shape as `session.ts`/`runner-session.ts`.
  `scenarioNeedsConfig` is the single gate deciding whether the wizard's
  config step shows at all: a static/dynamic-array-only scenario skips
  straight to `complete` (Constitution: zero-setup baseline). Two real bugs
  in the first draft: (1) `RunView.tsx` and the wizard each independently
  read the same `aitomate:onboarding` storage key to decide visibility —
  fixed by making the wizard own its visibility end-to-end. (2) A scenario
  imported *during* onboarding never appeared in `RunView`'s scenario list
  until the popup was reopened — fixed by having `onComplete` call
  `RunView`'s `refresh()`.
- T4.5 Firefox/Edge polyfill audit — `lib/cross-browser-audit.test.ts` scans
  `entrypoints/`, `lib/`, `components/` for direct `chrome.*` usage (Hard
  Constraint: `browser.*` only). `lib/sidepanel.test.ts` locks in the T1.4
  side-panel adapter's Chrome/Firefox fallback.

## Base URL / `{{BASE_URL}}` resolution

Found + fixed during manual MVP testing against `examples/demo-ssr/` — the
spec (FR-3) always described `{{BASE_URL}}`-style placeholders, but no
step-executor code ever resolved them.

1. `resolveUrl` in `step-executor.ts` does the substitution; `RunView.tsx`
   gained an optional "Base URL" input threaded through `RunnerCommand.play`
   -> `background.ts` -> `executeStepWithRetry`.
2. `chaining.ts`'s `runSetup` never received `baseUrl` at all, so a setup
   scenario's own navigate steps (e.g. a login page) were silently skipped
   by the substitution the main scenario got.
3. The original replace used a *string* replacement
   (`url.replace(pattern, baseUrl)`) — `$&`/`$$`/`` $` ``/`$'` are special
   in a string replacement, so a base URL containing a literal `$` would
   corrupt the resolved URL; fixed with a replacer *function* instead.
4. A run-all (suite) never merged the Base URL override at all — only the
   single-run `play` handler did; `aitomate:runner:play-suite` had no
   `baseUrl` field on its message type at all.
5. `executeNavigation` silently reported `passed: true` for a navigate step
   whose URL still contained a literal `{{BASE_URL}}` — `tabs.update`
   doesn't reject a non-absolute URL, so the real failure surfaced one step
   later as an unrelated "no content script" error instead of on the
   navigate step that actually caused it; fixed by failing that step
   directly with a plain-language message.
6. The actual root cause once both of those were fixed: `RunView.tsx`'s
   `handleRun` was a `useCallback` with an **empty dependency array**,
   closing over `baseUrl`'s first-render value (`''`) forever — every run
   sent `baseUrl: undefined` regardless of what the field showed.
   `handleRunAll` didn't have this bug (its deps already included
   `baseUrl`) — only the more commonly-used single-Run path did.
7. Live step progress added to the Run view (`stepProgress` state, matched
   via `runTabIdRef` so it keeps updating during a suite run same as the
   run-report match) — `RunnerSessionState` already carried
   `currentStepIndex`/`totalSteps`, broadcast on every step, but nothing in
   the UI read it.
8. Base URL, part 2 (PO/dev handoff): `packages/schema`'s `meta.baseUrl` and
   `BuildView.tsx`'s scenario-authoring "Base URL" field already existed
   and already round-tripped through export/import — a dev could already
   bake a default into the `.aitomate.json`. The actual gaps were UI-only:
   nothing told a PO a scenario already had a saved default, and the Run
   view's override itself reset to `''` every popup/side-panel reopen.
   Fixed: `ui-prefs.ts` gained a `runBaseUrl` field, loaded on mount and
   saved on every change; the scenario list shows "(uses saved Base URL: …)"
   when the override field is empty.

## Edit-existing-scenario

Run view "Edit" button → loads into Build view. There was previously no way
to revise an already-imported/saved scenario at all — only fresh recordings
ever populated `BuildView.tsx`'s `steps`. `AppShell.tsx` owns
`editScenarioId` (lifted state — crosses both views) set by `RunView`'s
"Edit" button and consumed by a `BuildView` effect that: fetches the entry
via `getScenarioById`, pushes `entry.scenario.steps` through
`aitomate:recorder:set-steps` for the current tab, *then* sets local state.
The set-steps push isn't optional — `BuildView`'s own `refresh()` effect
re-fetches `steps` from that same per-tab recorder store on every unrelated
recorder broadcast; setting only local React state would get silently
clobbered by the next broadcast.

Found via manual testing of this feature: a `wait` step's Duration (ms)
field in `StepCard.tsx` vanished entirely the moment its value was cleared.
Cause: the field's visibility was conditioned on
`step.durationMs !== undefined` — the very value it edits. Fixed by gating
on `!step.forSelector` instead. Also closed a related gap in
`findIncompleteStep`: a wait step with neither `durationMs` nor
`forSelector` previously saved/exported silently as a no-op step.

## Scenario slugs

`packages/schema`'s `scenarioMetaSchema` gained an optional `slug` field —
a stable kebab-case id, distinct from the human-editable `name`, meant to
be what the library actually dedupes on. Kept optional so older exported
files and the spec §3.3 fixture keep parsing unmodified;
`effectiveSlug(scenario)` derives an equivalent slug from `name` (via
`lib/slug.ts`'s `slugify()`) for any scenario that never had one persisted.

This closed a real duplicate-scenario bug: `RunView.tsx`'s import flow and
`OnboardingWizard.tsx`'s import both called plain `saveScenario`
(unconditional insert, no dedupe check at all), so importing the same file
twice silently created two duplicate library entries. Fixed by adding one
shared `saveScenarioDeduped(scenario, confirmOverwrite)` in
`import-export.ts` and routing all three write paths (`BuildView.handleSave`,
`RunView.handleImport`, `OnboardingWizard.handleImportScenario`) through it.
`BuildView.tsx` gained a Slug field that auto-derives from Name via
`slugify()` until the user edits the slug directly.

## Recorder stop drops steps

Bug report: user records several steps, clicks Stop, and the Build view's
step list (and the saved scenario) comes back empty — none of the performed
actions were captured.

Root cause: `content.ts`'s `sendStep()` is a fire-and-forget
`browser.runtime.sendMessage()` call — no `await`, no ack. `background.ts`'s
`step-captured` handler gated on `recording.session.status === 'recording'`
before appending a step. Stop is a separate message
(`aitomate:recorder:stop`) sent from the popup/side panel, and nothing
serializes it against in-flight `step-captured` messages from the content
script. If Stop's handler ran first (flipping `status` to `'idle'` and
broadcasting), a `step-captured` message already in flight for the last
action(s) arrived afterward and was silently dropped by the status guard —
no error, no step, and depending on how quickly the user stopped after their
last action, this could eat most or all of the session.

Fix: `RecorderSessionState` gained a `generation: number` field, bumped only
on `START` (`reduceSession`, `lib/recorder/session.ts`). `content.ts`'s
`sendStep()` now stamps the step-captured message with
`recorderState.generation` (its locally mirrored copy, updated by the
`aitomate:recorder:state` broadcast). `background.ts`'s handler compares
`message.generation === recording.session.generation` instead of checking
`status` — a step captured just before Stop still matches the current
generation (Stop doesn't bump it) and gets appended, while a stray step from
a since-replaced (Stop → Start again) session has a stale generation and is
correctly rejected. `STOP`/`RESUME` were changed to spread the prior state
(`{ ...state, status: 'idle' }`) instead of constructing a fresh object, so
`generation` (and `originUrl`) survive those transitions — `RESUME`
explicitly clears `pauseReason` to keep its existing contract.

## Run-report capture (FR-5)

Closed the hollow-pipeline gap from the T4.1 review: `screenshotOnFailure`,
`consoleErrors`, and `networkErrors` were rendered by the report model and
both exporters but nothing ever populated them — a failed run's report
always showed empty arrays and no screenshot. Now real:

- **Page errors** (`consoleErrors` field): a MAIN-world content script
  (`entrypoints/capture.content.ts` — WXT registers `*.content.ts` scripts
  as content scripts; `content-*.ts` is NOT a recognized pattern and builds
  an unregistered chunk) listens for page-world `error` (capture-phase, so
  resource load failures are seen too) and `unhandledrejection` and
  forwards over `postMessage` to the isolated-world `content.ts`, which
  relays to the background. Why MAIN world: an isolated-world `error`
  listener does NOT receive page-world uncaught exceptions — verified
  empirically on MV3 (page-world listener saw the throw; the isolated
  buffer stayed empty). Manifest content scripts also bypass page CSP.
  Top frame only (with `allFrames: true`, every frame would forward the
  same tab's errors; iframe errors are a documented v1 limitation). Page
  `console.error()` *calls* are NOT captured (v1) — the field carries what
  surfaces red in a console: uncaught exceptions, unhandled rejections,
  failed resource loads.
  PostMessage forgery hardening: the relay validates origin + shape
  (`parseCaptureMessage` in capture.ts) — a cross-origin frame (ad embed,
  other-extension iframe) cannot forge entries into the report. Same-origin
  page scripts (XSS, first-party bugs) still can: the MAIN world has NO
  extension API access (verified empirically — `browser.runtime` is
  undefined there, so the MAIN script cannot message the background
  directly and the relay is necessary), and both the MAIN script and page
  scripts run in the same page context, so a token carried over
  `postMessage` is page-observable and forgeable — theater. The sound fix,
  if reports ever become formal evidence, is a per-load secret delivered
  out-of-band (`scripting.executeScript` args + `tabs.sendMessage`), not a
  postMessage token; documented in `parseCaptureMessage`.
- **Network errors**: background `webRequest` observation —
  `onErrorOccurred` (failures) + `onCompleted` with status ≥ 400. Requires
  the `webRequest` permission and `<all_urls>` host permissions
  (wxt.config.ts) — a real manifest/trust cost, but FR-5's promise was the
  bigger lie, so the spec promise won. Passive observation only, no
  blocking.
- **Plumbing**: the background persists both writers' entries into a
  tab-scoped ring buffer in `storage.session` (`lib/runner/capture.ts`,
  100-entry cap). Content scripts CANNOT access `storage.session` (MV3
  rejects with "Access to storage is not allowed from this context" — only
  extension pages and the service worker are trusted contexts), so the
  page-error relay sends `aitomate:runner:capture-entry` via
  `runtime.sendMessage` and the background keys it by `sender.tab.id` —
  this also eliminated the earlier `get-tab-id` bootstrap round trip, which
  had its own bug: it returned a raw number, and the Chrome/Firefox
  `onMessage` contract only honors a Promise (or `true` + manual
  `sendResponse`) — a raw return value is ignored and `sendMessage`
  resolves `undefined`, silently killing the collectors (the switch's only
  non-Promise case). Background reads the buffer at report time, windows it
  to `[startedAt, finishedAt]`, clears it, and passes the split
  page/network lists into `buildRunReport`.
- **Screenshot**: `captureVisibleTab(tab.windowId)` at run end, only when
  the run failed, best-effort (a permission miss must never fail the run).
  Requires the run tab to be the active tab of its window (`activeTab`
  grant) — real usage satisfies this (popup opened on the target tab, which
  is exactly the tab the Run view runs in); automated e2e can't simulate
  the toolbar-click grant, so the screenshot path is unit-tested and
  manual-verified, not e2e-asserted.
- **Verified end-to-end**: temp e2e specs ran (1) a scenario navigating to
  a 404 — the failed run's `report.networkErrors` contained
  `HTTP 404: http://localhost:8081/missing.html` (webRequest → buffer →
  report); (2) a page that throws mid-run — `report.consoleErrors`
  contained the thrown error, proving the MAIN-world → postMessage →
  relay → background path. The e2e also surfaced the pre-existing cost of
  a failing assert (10s poll × 3 retries) — not changed here. Flake note:
  three unit tests originally asserted real elapsed time
  (`durationMs >= 1/250`), which intermittently read 0 under worker load
  (frozen `performance.now`) — now all three mock the clock deterministically.

## Smart-wait probe + honest step timing (runner reliability)

Trigger: a manual MVP run of `examples/demo-ssr/test-ssr.aitomate.json`
(`Demo_SSR___Sign_Up_Full_Flow-report.json`, committed red at repo root)
failed at `s02` — the first fill after a navigate — with
`DOM stability check failed: Error: Could not establish connection.
Receiving end does not exist.`, `attempts: 3`, `durationMs: 0`. Two defects
in `lib/runner/step-executor.ts` were confirmed by reading the code; a
clean headless e2e run of the same scenario then passed green (all 31
steps), showing the historical failure was environmental (demo server not
up / dev-mode SW teardown during the manual run) on top of the two real
bugs:

1. **The retry budget was shared between two failure classes that need
   different handling.** `wait-for-dom` ran inside every attempt. A
   rejection of that message always means "no content script listener
   right now" — the content-side stability wait never rejects (it resolves
   on stability or its own timeout, `content.ts`), so every rejection is a
   receiver-presence problem (post-navigation injection race, error page,
   extension reload). Listener presence is *eventual* when the page loads
   fine, so the correct response is time, not attempts — but the loop
   burned the action's 3 retries (with backoff) on it and never reached
   the actual action. Worse, nothing ever *made* the content script
   appear (no `scripting` permission). Fixed: `waitForDomStability` now
   re-probes the send every `CONTENT_SCRIPT_PROBE_MS` (300ms) until the
   step timeout; exhaustion throws `ContentScriptUnreachableError`, which
   fails the step fast with the real elapsed time instead of re-looping
   on a page that will never answer. Stop responsiveness preserved: the
   probe checks the stop signal and aborts via `RunAbortedError`.
   Follow-up: each probe passes the *remaining* budget
   (`timeoutMs - elapsed`) as the message's `timeoutMs`, not the full step
   timeout — the content script opens a stability window per send, so a
   full budget on every probe would stretch the effective horizon to
   ~2×timeoutMs (probe time + a fresh in-flight window); with the
   remaining budget the end-to-end horizon is exactly the step timeout
   (pinned by fake-timer tests asserting the per-probe payloads
   `[1000, 700, 400, 100]`).
2. **`durationMs: 0` was hardcoded** in the exhausted-retry return — the
   last attempt's measured time was discarded, so *every* failed DOM step
   reported 0ms regardless of the backoff actually spent (the historical
   run's 3 attempts really cost ~3.5s of wall time; the report said 0).
   Fixed: `durationMs` is now the step's total elapsed time across all
   attempts (success, exhausted, stopped, and fail-fast paths alike).

Tests: `step-executor.test.ts` gained probe-recovery (receiver-missing once
→ succeeds without consuming action attempts), fail-fast-on-unreachable
(attempts 1, not the full retry budget, honest `durationMs`),
probe-aborts-on-stop, and total-durationMs-on-exhaustion; the old
"sendMessage rejection as a failure" and "default retry count" tests were
reworked to the new semantics. E2E: a temp spec driving the real demo-ssr
run from the popup passed green and validated every step's `durationMs >
0`; deleted afterward — promoting it to the permanent third smoke case
(§3.7) still needs the Playwright harness to self-serve `examples/demo-ssr`
on 8081 rather than assuming an external server.

Also fixed en route: `smoke.spec.ts`'s popup assertions were stale against
the 0.4.1 UI redesign — it asserted an exact "Aitomate" heading and the old
empty-state copy, neither of which exists anymore (the app name moved to
banner text; the wizard owns the page's only heading). Now asserts the
banner text (`AI Test Automation`, exact) and the current empty-state copy.

## Build view "Pick element"

Gap: Build view had no way for a non-technical PO/QA to get a selector onto
a step without already knowing devtools/DOM inspection — T2.12's "Locate on
page" only goes the other direction (given a step's selector, highlight the
matching element to confirm it's right).

Added the reverse: a "Pick element" button per step (`StepCard.tsx`, next to
the existing Locate button, same icon family in green) sends
`{ type: 'aitomate:runner:pick-element' }` to the active tab's content
script (mirrors Locate's direct `tabs.sendMessage` pattern — no background
hop needed). `content.ts`'s `handlePickElement()` puts the page into a
one-shot picking mode: hover outlines whatever element is under the cursor,
the next click (captured, `preventDefault`/`stopPropagation`'d so the page
itself doesn't react) resolves with `generateSelector(target)` via
`element-picked`; Escape resolves `pick-cancelled`. Runs via the existing
`allFrames: true` content script instance in every frame — unlike
`execute-step`'s frame-guard requirement (one *known* target frame must
answer), picking has no known target frame in advance, so "whichever frame
the user actually clicks in" is the correct answer, not a race to guard
against. `BuildView.tsx` writes the returned selector into the step via the
existing `updateStep()` path (same one the Advanced selector editor uses),
so Simple mode users get a working selector without ever seeing selector
syntax.

## Navigate-step placeholder guard generalized

Found while reviewing FR-3 against the runner: `executeNavigation`'s guard
against an unresolved placeholder (`step-executor.ts`) only ever checked
`resolvedUrl.includes('{{BASE_URL}}')` — the literal token, not the general
case. `resolveUrl` itself also only ever substitutes that one token
(`url.replace(/\{\{BASE_URL\}\}/g, ...)`). Any *other* `{{...}}` placeholder
in a navigate step's URL — a typo, or a token copy-pasted from another
tool/spec example — was invisible to the guard: `tabs.update` doesn't reject
a non-absolute `{{APP_URL}}/...`-shaped string, so the step silently
reported `passed: true` and the *next* step failed with an unrelated-looking
"no content script" error, hiding the real cause. Exact same failure class
as the original Base URL bug (`docs/decisions.md` § Base URL, point 5) — the
fix there closed the one token it was chasing, not the shape of the bug.

Fixed by matching `/\{\{[^{}]+\}\}/` generically: any leftover `{{...}}`
after `resolveUrl` fails the step loud, with the actual token named in the
error, and a distinct message for the common `{{BASE_URL}}` case (points the
user at the Run view's Base URL field) vs. any other token (states plainly
that only `{{BASE_URL}}` is currently supported).

This surfaced a bigger, pre-existing gap: FR-3 (spec-kit) describes
"environment variable placeholders (e.g., `{{BASE_URL}}`)" resolved from
named "Environment profiles" (a `name → variable map`, managed via a Run
view environment selector) — a general mechanism, of which `{{BASE_URL}}`
was always meant to be one example, not the only one.
`packages/schema/src/scenario.ts`'s own doc comment already says
`{{ENV_VAR}}`. None of that was ever built — only the single hardcoded
`baseUrl` field/token exists in `RunView.tsx` and `step-executor.ts`, and it
was never tracked as its own task (Milestone 1 was marked fully `[x]`
without it). Added as **T2.14** (spec-kit 0.3.5, unchecked) rather than
silently building the full environment-profiles feature under this fix —
it's a real UI + schema-shape decision (multiple named profiles, a
selector, profile storage) that deserves its own scoping pass, not a
side effect of a one-line guard fix.
