# Aitomate — Agent Guide

Browser extension for collaborative, AI-assisted test automation. Works on any
web app (server-rendered or SPA); Laravel apps are the reference targets, not a
dependency.

**Source of truth: `aitomate-spec-kit.md` (v0.3.3).** If anything here or in a
conversation contradicts the spec, the spec wins. Update the spec when a design
decision changes; bump its version and changelog.

Detailed per-task history, design rationale, and bug post-mortems live in
**`docs/decisions.md`**, not here — this file stays a short onboarding guide.

## Status

Full narrative history, rationale, and bug post-mortems per task:
**`docs/decisions.md`**. Below is just the checklist.

- Done: T1.1 scaffold · T1.2 scenario schema · T1.3 encrypted vault ·
  T1.4 popup/side-panel shell · T1.5 Playwright E2E smoke · T2.1 recorder ·
  T2.2 runner state machine · T2.3 value resolvers · T2.4 playback hardening
  (React/Vue inputs, checkbox/radio, upload) · T2.5 FR-7 assertions ·
  T2.6 Build view step editor · T2.7 import/export + suite ZIP ·
  T2.8 scenario chaining/setup · T2.9 Build view save-to-library (superseded
  by slug-based dedupe) · T2.10 Run view "Run all" (suite) · T2.11 Build
  view "Add step manually" · T2.12 Build view "Locate on page" · T2.13
  recorder navigation-step fix · T3.1 LLM provider adapters · T3.2 AI
  resolver wiring · T3.3 LLM settings UI + vault message protocol ·
  T4.1 run-report data model · T4.2 Run view run-report UI · T4.3 report
  JSON/HTML export · T4.4 first-run onboarding wizard · T4.5 Firefox/Edge
  polyfill audit · Base URL / `{{BASE_URL}}` resolution (+ Run view
  progress, PO/dev handoff) · Edit-existing-scenario · Scenario slugs
  (dedupe by slug, not name) · Build view "Pick element" (devtools-style
  point-and-click selector capture, PO/QA-friendly) · recorder stop-drops-
  steps fix (generation-token guard, see Common Mistakes below).
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

Planned (not yet created): `packages/bridge` (M2, local DB sidecar) — see
spec §6. `examples/` (demo-ssr fixture) and `docs/` (decision history) both
already exist.

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
  function.** Grep every call site before considering a new parameter
  "wired up" — a shared function called from two places (e.g.
  `executeStepWithRetry` from both `background.ts` and `chaining.ts`'s
  `runSetup`) will silently pass `undefined` at the site you forgot, no
  type error, no test failure unless something exercises that path. Bit
  twice in the same feature at two different layers — function-signature
  (`runSetup` missing `baseUrl`) and message-protocol
  (`play-suite` missing a `baseUrl` field). Full story: `docs/decisions.md`
  § Base URL.
- **An empty `useCallback`/`useEffect` dependency array is a functional
  claim, not bookkeeping.** `[]` means "this closure never needs today's
  state" — get it wrong and a handler silently keeps reading a stale
  first-render value forever, exactly as silent as the call-site bug above,
  just at the React-hook layer. Caught when `RunView.tsx`'s `handleRun` kept
  sending `baseUrl: undefined` regardless of the input field's contents.
  Full story: `docs/decisions.md` § Base URL.
- **Two components independently read the same persisted flag to decide
  the same thing.** If a parent and child both read the same
  `storage.local`/`storage.session` key to each separately decide
  visibility/state, that's two sources of truth for one fact — they will
  drift the first time one side's check changes without the other's. Let
  the component that owns the behavior (usually the child) own the whole
  decision — mount check *and* hide-on-complete — and have the parent
  render it unconditionally. Caught in T4.4 (`RunView.tsx` and
  `OnboardingWizard.tsx` both read `aitomate:onboarding` independently).
- **A fire-and-forget content→background message racing a command that
  changes gate state.** `content.ts`'s `sendStep` never awaits its
  `sendMessage`; if a user's Stop click reaches `background.ts` first, a
  still-in-flight `step-captured` for the last action(s) arrives after
  `session.status` has already flipped to `'idle'`, and a status-based guard
  silently drops it — no error, no step, and it looks like recording "didn't
  work" rather than a timing bug. Status is the wrong thing to gate on here;
  use a monotonic token (bumped only on Start) so a message can be told
  "still belongs to this session" independent of whether Stop has already
  been processed. Caught in the recorder (`step-captured` dropped trailing
  steps on Stop); fixed with `RecorderSessionState.generation`. Full story:
  `docs/decisions.md` § Recorder stop drops steps.

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
