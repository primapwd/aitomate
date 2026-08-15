# Spec-Kit: Aitomate
### Browser Extension for Collaborative, AI-Assisted Test Automation

Version: 0.3.5 (Draft)
Date: 2026-08-15
Author: Prima Putra
Target build method: Spec-Driven Development (SDD) with Claude Code / Codex / OpenCode

> Changelog 0.3.5: navigate-step placeholder guard generalized — it only ever
> checked for a literal unresolved `{{BASE_URL}}`, so any other `{{...}}`
> token (typo'd, or copy-pasted from another tool) silently "navigated"
> nowhere real and reported `passed: true`, surfacing as an unrelated "no
> content script" error on the *next* step (same failure class as the
> Base URL bug in `docs/decisions.md`). Now any unresolved `{{...}}` fails
> the step loud. Root cause: `resolveUrl` only ever substitutes
> `{{BASE_URL}}` — FR-3's broader "environment variable placeholders" and
> "Environment profiles" (name → variable map, Run view selector) were
> never built, only this one hardcoded token. Added as T2.14 below since it
> wasn't previously tracked as its own task.
>
> Changelog 0.3.4: FR-5 report capture implemented — `screenshotOnFailure`,
> `consoleErrors`, `networkErrors` were rendered by the report model but
> never populated (hollow pipeline). Now: page errors (uncaught exceptions,
> unhandled rejections, resource load failures) via a MAIN-world content
> script (`capture.content.ts`) forwarded over `postMessage` to the
> isolated-world relay and persisted by the background (content scripts
> cannot access `storage.session`); network errors via background
> `webRequest` observation (`onErrorOccurred` + `onCompleted` ≥ 400;
> requires `webRequest` permission + `<all_urls>` host permissions);
> screenshot via `captureVisibleTab` at run end on failure (best-effort).
> The postMessage relay validates origin + shape, so cross-origin frames
> cannot forge report entries (same-origin page scripts can — a postMessage
> token would be page-observable; the sound out-of-band secret is a
> documented follow-up if reports become formal evidence).
> Page `console.error()` *calls* are not captured in v1 — the
> `consoleErrors` field carries the page errors that surface red in a
> console.
>
> Changelog 0.2.0: framework-agnostic scope (no longer Laravel-only), UI switched
> to React, plugin system downscoped to declarative JSON for v1, CI/Pest
> integration moved to post-MVP backlog, MCP replaced by a purpose-built local
> bridge CLI, config import/export added, scenario chaining added, shadow DOM /
> iframe handling added, assertion set defined, license fixed to MIT, milestones
> restructured (MVP / M2 / M3 / backlog), repo structure aligned to WXT
> conventions.
>
> Changelog 0.3.0: testing strategy added (§3.8: Vitest + WxtVitest unit tests,
> Playwright E2E smoke harness); environment profiles clarified (FR-3);
> PO can create/modify scenarios via Build Simple mode; session marker decided
> (per setup scenario); LLM adapters decided (OpenAI-compatible +
> Anthropic-compatible).
>
> Changelog 0.3.1: T3.1–T3.3 (LLM provider abstraction, dynamic(ai) resolver,
> provider settings UI) done. Two gaps found between the shipped Build/Run
> views and this spec — §3.8 says Build Simple mode offers "save/export
> scenario" (only export existed) and FR-5 says run modes are "single
> scenario, suite (sequential)" (only single-scenario run existed) — tracked
> as new tasks T2.9/T2.10.
>
> Changelog 0.3.2: T2.9 (save-to-library) and T2.10 (run suite) done. Three
> more gaps/additions found in the Build view: (1) FR-1 says the recorder
> captures "navigation" as a step, but the `navigate` step builder is dead
> code — never called from the content script, so URL navigation during a
> recording never becomes a step; tracked as new task T2.13. (2) Build
> Simple mode has no way to add a step manually (outside of
> recording) — not previously in scope anywhere in this spec; new task
> T2.11. (3) Clicking a step in the Build view has no way to highlight/
> locate the corresponding element on the live page, making it hard to
> verify a recorded/edited selector actually targets the right element; new
> task T2.12.
>
> Changelog 0.3.3: T2.13 done — recorded navigation now produces a `navigate`
> step (FR-1 gap from 0.3.2 closed).

---

## 0. How to Use This Spec-Kit

This document follows the Spec-Driven Development (SDD) pattern used by tools like
GitHub Spec-Kit, Claude Code, and OpenCode. It is split into layers:

1. **Constitution** — non-negotiable principles that guide every decision.
2. **Specify** — what we are building and why (product spec).
3. **Plan** — how we are building it (technical architecture).
4. **Tasks** — breakdown into implementable, agent-friendly units.

When feeding this into an AI coding agent, paste one section at a time
(Constitution -> Specify -> Plan -> Tasks) or reference this file directly if the
agent supports long-context ingestion. Keep this file updated as the source of truth;
if a chat conversation contradicts this file, this file wins.

---

## 1. Constitution (Guiding Principles)

- **Low-code first, code-friendly second.** Every feature usable by a Product Owner
  via UI must also be scriptable/extensible by a Developer via code or plugin.
- **Framework-agnostic target.** Aitomate tests any website or web application —
  server-rendered (Laravel Blade, Rails, Django, plain HTML) or SPA (Vue, React,
  Svelte, Angular). No feature may assume a specific backend or frontend framework;
  framework-specific behavior (e.g., React controlled inputs) is handled as a
  compatibility adapter, never as a core assumption.
- **Portable scripts.** Test scenarios are plain, human-readable, diffable files
  (JSON) that can live in the same git repo as the application code.
- **Cross-browser by default.** Never rely on a Chrome-only API without a fallback
  or graceful degradation for Firefox/Edge.
- **Extensible, not monolithic.** Core engine stays small; new actions, data
  sources, and assertions are added via a plugin mechanism, not by modifying core.
- **Data source agnostic.** Static, dynamic/random, AI-generated, and live-database
  values must all resolve through the same internal "Value Resolver" interface.
- **Zero-setup baseline.** A static-only scenario must import and run with no
  configuration at all — no passphrase, no connectors, no API keys. Setup cost is
  only paid by the features that need it (AI, Database).
- **Security by default.** Credentials, DB connection strings, and API keys are
  never stored inside the shareable scenario file; they live in a local encrypted
  vault and are referenced by name.
- **Fail loud, fail clear.** Non-technical users (PO/QA) must get plain-language
  error messages, not stack traces.

---

## 2. Specify — Product Specification

### 2.1 Problem Statement

Teams building web applications — regardless of stack (Laravel/Blade, Vue, React,
or any other server-rendered or SPA framework) — need a browser-based test
automation tool that:
- Lets **developers** record test scripts once and commit them to the repo.
- Lets **Product Owners and QA Engineers** run those same scripts without writing code.
- Fills forms using static values, randomized/dynamic values, AI-generated values,
  or real data pulled from the application's database.
- Works across Chromium browsers and Firefox.
- Is open source, self-hostable, and extensible via plugins/scripts — not locked
  into a vendor's cloud service.

Laravel + Blade/Vue/React apps are the first-class reference targets (they drive
the examples and compatibility testing), but nothing in Aitomate is specific to
them.

### 2.2 Personas

| Persona | Technical Level | Primary Actions |
|---|---|---|
| Developer | High (web dev, Git) | Records scripts, defines dynamic/AI/DB value rules, commits scripts to repo, configures and exports team config bundles |
| QA Engineer | Medium | Imports scripts, runs test suites, tweaks static values via UI, reviews run reports, files bugs with attached run logs |
| Product Owner | Low/Non-technical | Imports scripts and config bundles, runs scenarios on their own laptop, reads pass/fail results; can also record new scenarios and modify existing ones through the simplified Build UI (no code, no raw selectors — recorder + plain-language step list) |

### 2.3 Goals

1. Extension installable on Chrome, Edge, and Firefox (Manifest V3, WebExtensions API).
2. Recorder mode: capture clicks, inputs, navigation, waits — like Automa's recorder.
3. Scenario files are exportable/importable as versionable JSON, committable to Git
   alongside the application project (e.g., `tests/aitomate/*.aitomate.json`).
4. Field-filling engine supports 3 modes per field: Static, Dynamic (array/random or
   AI-generated), Database (live query via local bridge).
5. Static-only scenarios run with **zero setup** — install, import, run.
6. Team config (LLM provider settings + DB connector profiles) is exportable and
   importable as an encrypted bundle so developers can onboard QA/PO machines in
   one step.
7. Plugin mechanism (declarative in v1) lets teams add custom actions without
   touching core code.
8. UI is task-oriented per persona: a "Run" view separate from a "Build" view.
   Run is the default. Build is available to every persona in two modes —
   **Simple** (recorder + plain-language step list; what PO/QA use to create or
   tweak scenarios without code) and **Advanced** (raw selectors, resolver
   config, plugin management; the developer surface).

### 2.4 Non-Goals (MVP)

- Native mobile app testing (mobile web via responsive viewport is in-scope; native
  app automation is out).
- Visual regression testing (screenshot diffing) — may be a future plugin.
- Load/performance testing.
- **Multi-tab and popup-window flows** (OAuth popups, print dialogs, `window.open`
  targets). Recorder pauses and warns when the flow leaves the recorded tab.
  Post-MVP candidate.
- **CI / headless execution and Pest integration.** Explicitly deferred to the
  post-MVP backlog (see §4, Backlog). The scenario schema is the contract that
  makes this possible later without rework: a future standalone runner
  (recommended: Playwright-based) consumes the same `.aitomate.json` files.
- Full replacement for Playwright/Selenium for complex multi-service E2E; MVP
  targets single-browser, single-tab, single-app UI flows.

### 2.5 Functional Requirements

#### FR-1: Recorder
- Start/stop recording from extension popup or side panel.
- Captures: navigation, clicks, input/change events (text, select, checkbox, radio,
  file upload placeholder), keypress (Enter/Tab), waits (explicit + implicit smart-wait
  on DOM stability), scroll-into-view before interaction.
  - ~~**Known gap (0.3.2):** the `navigate` step builder exists but is not yet
    wired into the content script's capture path — URL navigation during a
    recording does not currently produce a `navigate` step. Fix tracked as~~
    Fixed 0.3.3: same-origin navigation while recording produces a `navigate`
    step; cross-origin navigation still pauses recording per FR-1's next
    bullet, unchanged.
    T2.13 (see §4).
- Each captured step stores: action type, target selector (with fallback selector
  strategies: `data-testid` > `id` > `aria-label` > CSS path > text content), input
  value or value reference, timestamp/order.
- Recorder pauses automatically on tab navigation to a different origin, prompting
  the developer to confirm continuation (avoids catching noise from unrelated tabs).
- Recorder pauses and warns when interaction opens a new tab/window (multi-tab is
  out of MVP scope).
- Common anti-noise exclusions built in (e.g., hidden inputs such as CSRF token
  fields are auto-excluded from recording).

#### FR-2: Field Fill Modes
Each recorded input field can be configured with one of three resolver types:

a. **Static**
   - Fixed value defined by developer at authoring time.
   - Example: `{"type": "static", "value": "john@example.com"}`
   - Requires zero configuration to run.

b. **Dynamic**
   - Sub-mode "array": developer supplies an array of candidate values; engine picks
     one at random (or sequentially, per config) each run. Zero configuration.
   - Sub-mode "ai": developer supplies a natural-language instruction (e.g.,
     "generate a realistic Indonesian full name") and a schema hint (type: name,
     email, phone, address, free-text with constraints e.g. max length, format regex).
     Engine calls a configured LLM provider to generate the value at run time.
     Requires an LLM provider config (importable, see FR-9).
   - Example: `{"type": "dynamic", "mode": "ai", "prompt": "realistic email address",
     "constraints": {"format": "email"}}`

c. **Database**
   - Developer defines a query reference (SQL SELECT template with named params,
     stored as a "Data Source" entry, not raw credentials in the scenario file).
   - At run time, engine calls the local Aitomate Bridge (see Plan 3.4) that executes
     the query against the target DB and returns a row/value.
   - Example: `{"type": "database", "dataSourceRef": "app_users", "query":
     "SELECT email FROM users WHERE role = :role LIMIT 1", "params": {"role":
     "student"}}`
   - Requires a DB connector profile (importable, see FR-9).

- All 3 modes resolve through a single internal interface `ValueResolver.resolve(field
  context) -> string | number | boolean`, so future modes (e.g., "API" mode calling
  an external REST endpoint) can be added without breaking the schema.

#### FR-3: Scenario File Format (Import/Export)
- File extension: `.aitomate.json` (human-readable, git-diffable).
- Versioned schema (`schemaVersion` field) for backward compatibility.
- Contains: metadata (name, description, target app URL/base path, tags), optional
  setup-scenario reference (see FR-10), steps array, data sources referenced by
  name (not inline secrets), environment variable placeholders (e.g., `{{BASE_URL}}`).
- Secrets/connection strings are NEVER stored in the scenario file; they are
  resolved from the local encrypted vault, matched by `dataSourceRef` name.
- **Environment profiles**: `{{BASE_URL}}`-style placeholders resolve from local,
  non-secret environment profiles (name → variable map) managed in the Run view's
  environment selector. Profiles are plain data (no secrets) and may be listed in
  the team manifest (FR-9) so an importing user knows which profiles to create.
- Export: single scenario or a full suite (folder of scenarios) as a `.zip` or
  a folder structure mirroring `tests/aitomate/`.

#### FR-4: Plugin Mechanism (v1: Declarative)
Browser-extension constraints (MV3 CSP forbids eval/remote code; extensions have
no filesystem access to a repo's `.aitomate/plugins/` folder) rule out loading
arbitrary TypeScript plugins at runtime. Therefore:

- **v1 (this spec): declarative plugins.** A plugin is a JSON file
  (`*.aitomate-plugin.json`) imported through the extension UI (file picker or
  drag-drop), declaring:
  - `name`, `version`, `description`.
  - **Custom actions**: named, parameterized macros composed of built-in step
    primitives (navigate, fill, click, wait, assert). Example: a "Login" action
    that takes `email`/`password` params and expands to a fixed step sequence.
  - **Custom assertion presets**: named combinations of built-in assertions.
- Plugin JSON files are committable to the app repo (e.g., `.aitomate/plugins/`)
  and shared the same way scenario files are — via import, not filesystem access.
- **v2 (future): full TypeScript plugin SDK** with typed extension points
  (actions, resolvers, assertions, reporters), pre-bundled at build time or
  sandbox-executed. Kept in backlog; the declarative format is designed so a
  declarative plugin remains valid under the v2 model.

#### FR-5: Execution & Reporting
- Run modes: single scenario, suite (sequential).
- Runs execute in a real browser tab. An "unfocused run" mode executes in a
  non-active tab so the user can keep working in another window — this is
  best-effort background execution, **not** true headless (MV3 requires a live
  tab for content scripts).
- Each run produces a report: step-by-step pass/fail, screenshot on failure,
  console/network error capture, duration.
- Reports exportable as JSON/HTML for attaching to bug tickets.
- Non-technical PO/QA view: simplified pass/fail summary with expandable steps,
  no raw selectors/code shown by default (toggle "Advanced view" to reveal).
- Flaky-step retry: configurable retry count + backoff per step.

#### FR-6: Target-App Compatibility (Framework-Agnostic)
The selector and interaction engine must work on any website. Specifically:

- **Server-rendered pages** (Laravel Blade, Rails, Django, static HTML): stable
  `name`/`id` attributes; hidden framework fields (e.g., CSRF tokens)
  auto-excluded from recording.
- **SPA pages** (Vue, React, Svelte, Angular): async-rendered elements — recorder
  and runner wait for DOM stability before capture/interaction; configurable
  per-step "wait for element" strategy tolerates hydration delays.
- **React-controlled inputs**: values set via native input event dispatch (native
  setter + `input` event), not plain `.value =` assignment, so synthetic event
  systems register the change. Same technique covers Vue `v-model` and similar.
- **Shadow DOM**: selector engine pierces *open* shadow roots for both recording
  (composed-path capture) and playback (recursive shadow-root querying). Selector
  schema supports a shadow-piercing path (array of selector hops). *Closed*
  shadow roots are a documented limitation (step fails with a clear message).
- **Iframes**: same-origin iframes supported — selector schema carries an optional
  `framePath`; content script binds into child frames (`all_frames`).
  Cross-origin iframes are a documented limitation for MVP (recorder warns when
  interaction happens inside one).
- **File uploads**: recorder captures a file-upload step as a placeholder; at
  playback, the runner attaches a file via the `DataTransfer` technique
  (programmatic `FileList` assignment + `change` event). MVP supports files
  bundled/imported into the extension (small fixtures); arbitrary local file
  paths are a documented limitation of the browser sandbox.

#### FR-7: Assertion Set (Built-in)
Minimum built-in assertions, all usable as steps:

| Assertion | Checks |
|---|---|
| `elementVisible` | element exists and is visible |
| `elementNotVisible` | element absent or hidden |
| `textContains` | element's text contains substring (case-insensitive option) |
| `textEquals` | element's text equals value (trimmed) |
| `inputValue` | form control's current value equals/matches |
| `urlMatches` | current URL matches pattern (glob or regex) |
| `elementCount` | number of matches for selector =, >=, <= n |
| `elementEnabled` / `elementDisabled` | control's disabled state |

Assertions share the same selector schema (including shadow/iframe paths) and the
same retry/timeout config as interaction steps. Custom assertion *presets* can be
added via declarative plugins (FR-4); new assertion *primitives* require the v2
plugin SDK.

#### FR-8: Cross-Browser Support
- Built with WXT framework targeting Manifest V3 for Chrome/Edge and the
  Firefox-compatible manifest variant WXT generates automatically.
- Avoid Chrome-only APIs (prefer `browser.*` namespace via WXT's polyfill).
- Side panel: Chrome/Edge use the `sidePanel` API; Firefox uses `sidebar_action`.
  WXT abstracts the manifest differences; the UI layer must not assume one API —
  a thin adapter selects the available panel mechanism, with popup as the
  universal fallback.
- Test build matrix: Chrome (stable), Edge (stable), Firefox (stable + ESR).

#### FR-9: Config Import/Export (Team Sharing)
- All machine-level configuration — LLM provider settings (provider, base URL,
  model, API key) and DB connector profiles (bridge address, connector names,
  credentials) — is stored in the local encrypted vault (see NFR Security).
- **Export**: user selects which entries to include and sets a *share passphrase*;
  the extension produces a single encrypted bundle file
  (`*.aitomate-config` — AES-GCM, key derived from the passphrase via PBKDF2).
- **Import**: recipient opens the bundle, enters the share passphrase; entries
  merge into their local vault. Designed so a developer configures once and
  onboards every QA/PO machine with one file + one passphrase.
- The bundle is safe to send over normal team channels *only as ciphertext*; the
  passphrase must travel out-of-band. UI copy must say this plainly.
- A **non-secret team manifest** (`.aitomate/connectors.json`) listing required
  connector *names and types only* (no credentials) is committable to the repo,
  so the extension can tell an importing user exactly which config entries they
  are missing for a given scenario suite.
- Recommended practice (documented, and warned in UI): DB credentials shared this
  way should belong to a **read-only database user** on a non-production database.

#### FR-10: Scenario Chaining (Setup Scenarios)
- A scenario may declare `setup: { "scenarioRef": "<name-or-relative-path>" }`.
- The runner executes the setup scenario first (e.g., "Login as admin"), in the
  same tab/session, and only proceeds if it passes; a setup failure is reported
  as "Setup failed", distinct from the scenario's own failure.
- One level of chaining in MVP (a setup scenario may not declare its own setup);
  deep chaining is a post-MVP consideration.
- **Session marker (decided: defined per setup scenario).** A setup scenario may
  declare an optional `sessionMarker` in its `meta` — a single cheap assertion
  that answers "is this session still active?":

  ```json
  "meta": {
    "name": "login-as-student",
    "sessionMarker": {
      "assertion": "elementVisible",
      "selector": { "strategy": "testid", "value": "user-menu" }
    }
  }
  ```

  Suite behavior: before re-running a setup that already ran earlier in the
  suite, the runner evaluates its `sessionMarker`; if it passes, setup is
  skipped. If the setup scenario declares no marker, setup is always re-run
  (safe default). Mixed suites (different setups per scenario) stay correct
  because each setup carries its own marker. There is no suite-level/global
  marker setting.

### 2.6 Non-Functional Requirements

- **Zero-setup baseline:** a static-only scenario (Static + Dynamic-array resolvers,
  built-in assertions) must run immediately after install + import — no passphrase,
  no keys, no bridge.
- **Usability:** PO persona must be able to import and run a scenario within
  5 minutes of first install, with zero documentation reading (onboarding
  tooltip/wizard on first run).
- **Performance:** Recorder must not introduce more than ~50ms input lag on
  recorded pages.
- **Security:** DB credentials and LLM API keys stored via `browser.storage.local`
  with an app-level encryption layer (WebCrypto AES-GCM). The vault passphrase is
  requested only when a scenario actually needs vault-backed features (AI/DB) —
  never as an install-time requirement.
- **Reliability:** Flaky-step retry mechanism (configurable retry count + backoff)
  for elements that render asynchronously.
- **Licensing:** **MIT** for everything in this repo — extension, schema package,
  bridge CLI, and declarative plugin format. (Decided; was an open question.)

---

## 3. Plan — Technical Architecture

### 3.1 Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Extension framework | WXT | Cross-browser MV3/MV2 output, Vite-based HMR, React support via `@wxt-dev/module-react` |
| UI framework | React + TypeScript | Matches your existing stack |
| UI components | shadcn/ui (Radix-based) | Accessible components out of box, copy-paste ownership model |
| State management | Zustand | Lightweight, standard React pairing for extension-scale state |
| Scenario storage format | JSON (schemaVersion-tagged) | Git-diffable, human-readable, easy for LLMs to generate/parse |
| Local secrets vault | WebCrypto (AES-GCM, PBKDF2) + `browser.storage.local` | No secrets in git, per-machine encrypted, powers config export bundles |
| DB connectivity | **Aitomate Bridge** — small companion CLI (Node, run via `npx aitomate-bridge`), read-only REST over localhost | Purpose-built, simpler than MCP for this use case (see 3.4); MIT, ships in this monorepo |
| LLM connectivity | Two adapters: OpenAI-compatible HTTP + Anthropic-compatible HTTP | OpenAI-compatible covers OpenAI, OpenRouter, LM Studio, Ollama (its OpenAI-compat endpoint), vLLM, etc. — cloud + local with just two adapters |
| Plugin mechanism (v1) | Declarative JSON plugins imported via UI | Works within MV3 CSP + no-filesystem constraints |
| Monorepo tooling | pnpm workspaces | Extension + schema + bridge share types |

Deferred (backlog): TypeScript plugin SDK; standalone CI runner (recommended:
Playwright-based, consuming the same `.aitomate.json`); Pest/Composer integration
wrapping that runner.

### 3.2 High-Level Architecture

```

+------------------------------------------------------+
|                  Aitomate Extension (WXT)              |
|  +----------------+   +------------------+            |
|  |  Popup / Side   |   |  Background      |            |
|  | Panel UI (React)|<->|  Service Worker   |            |
|  |  - Build view    |   |  - Scenario runner|            |
|  |  - Run view      |   |  - Value Resolver |            |
|  +----------------+   |  - Plugin registry |            |
|                        +--------+---------+            |
|                                 |                        |
|                         Content Script                   |
|              (DOM interaction, recorder,                  |
|               shadow-DOM/iframe piercing)                 |
+------------------------------------------------------+
|                          |
v                          v
+-------------------+     +--------------------------+
|  Local Secrets     |     |  Aitomate Bridge (local)  |
|  Vault (encrypted) |     |  npx aitomate-bridge       |
|  + config          |     |  read-only REST,           |
|    import/export   |     |  localhost + token         |
+-------------------+     +------------+-------------+
                                        |
                                        v
                              Target App's Database

+-----------------------------------------+
|  LLM Provider Abstraction                 |
|  - Cloud: OpenAI-compatible / Anthropic    |
|  - Local: Ollama / LM Studio (HTTP)        |
+-----------------------------------------+

```

### 3.3 Scenario File Schema (Draft)

```json
{
  "schemaVersion": "1.0",
  "meta": {
    "name": "Checkout Flow - Guest User",
    "description": "Validates guest checkout with random product",
    "baseUrl": "{{BASE_URL}}",
    "tags": ["checkout", "guest"]
  },
  "setup": {
    "scenarioRef": "login-as-student"
  },
  "dataSources": [
    {
      "name": "app_users",
      "type": "database",
      "connectorRef": "mysql-primary"
    }
  ],
  "steps": [
    {
      "id": "step-1",
      "action": "navigate",
      "url": "/checkout"
    },
    {
      "id": "step-2",
      "action": "fill",
      "selector": { "strategy": "testid", "value": "email-input" },
      "resolver": {
        "type": "database",
        "dataSourceRef": "app_users",
        "query": "SELECT email FROM users WHERE role = :role LIMIT 1",
        "params": { "role": "student" }
      }
    },
    {
      "id": "step-3",
      "action": "fill",
      "selector": { "strategy": "css", "value": "#promo-code" },
      "resolver": {
        "type": "dynamic",
        "mode": "array",
        "values": ["PROMO10", "PROMO20", "NOPROMO"]
      }
    },
    {
      "id": "step-4",
      "action": "fill",
      "selector": {
        "strategy": "css",
        "value": "textarea[name=notes]",
        "shadowPath": ["checkout-widget", "note-editor"],
        "framePath": []
      },
      "resolver": {
        "type": "dynamic",
        "mode": "ai",
        "prompt": "short delivery note, max 15 words, casual tone",
        "provider": "configured-default"
      }
    },
    {
      "id": "step-5",
      "action": "click",
      "selector": { "strategy": "text", "value": "Place Order" }
    },
    {
      "id": "step-6",
      "action": "assert",
      "assertion": "elementVisible",
      "selector": { "strategy": "testid", "value": "order-success-banner" }
    },
    {
      "id": "step-7",
      "action": "assert",
      "assertion": "urlMatches",
      "pattern": "**/orders/*"
    }
  ]
}
```

Selector object fields: `strategy` (`testid | id | aria | css | text`), `value`,
optional `shadowPath` (ordered list of shadow-host selectors to pierce), optional
`framePath` (ordered list of same-origin iframe selectors to descend into).

### 3.4 Database Connectivity — Aitomate Bridge

The extension cannot open raw DB sockets (browser sandbox). Instead of adopting
MCP (which is designed for LLM tool-calling and adds protocol overhead this use
case doesn't need), Aitomate ships its own tiny companion CLI:

- **`aitomate-bridge`** — a Node CLI in this monorepo, started with
  `npx aitomate-bridge` (or a global install). On start it:
  1. Reads connector profiles from a local config (or receives them from the
     extension on pairing — credentials never leave the machine).
  2. Prints a one-time pairing token; the user pastes it into the extension
     Settings once (or scans via `http://localhost:<port>/pair` handshake).
  3. Exposes a minimal REST API on `localhost` (default port, configurable):
     `POST /query { connectorRef, sql, params }` → rows. Every request requires
     the session token.
- **Read-only enforced in the bridge**: SQL is parsed and rejected unless it is a
  single SELECT statement; additionally, docs recommend a read-only DB user.
- Supported drivers v1: MySQL/MariaDB and PostgreSQL (both via well-maintained
  Node drivers; effort difference is small). SQLite as fast-follow.
- `dataSourceRef` in the scenario file maps to a connector profile name; the
  extension's vault stores which bridge/connector serves that name.
- Fallback: if the bridge is unreachable, engine surfaces a PO-friendly
  error ("Database connection not available — ask a developer to check your
  local setup") rather than a raw connection error.
- Future option: an MCP adapter mode on the same bridge, if MCP-ecosystem
  interop becomes useful. Not in MVP.

### 3.5 LLM Provider Abstraction

- Interface: `LLMProvider.generate(prompt: string, constraints?: object): Promise<string>`.
- Built-in adapters (v1, decided): **OpenAI-compatible HTTP** and
  **Anthropic-compatible HTTP**. The OpenAI-compatible adapter covers cloud
  (OpenAI, OpenRouter, …) and local runtimes (Ollama, LM Studio, vLLM) since they
  all expose OpenAI-compatible endpoints — no separate local adapter needed;
  "local" is just a base-URL setting.
- Configured per-machine (not per-scenario) so the same scenario file works
  whether a teammate uses a cloud key or a local model — resolved by
  `"provider": "configured-default"` in the schema. Config is shareable via the
  encrypted config bundle (FR-9).
- Caching layer (optional) to avoid re-generating identical AI values across
  reruns within the same session, saving API cost/time.

### 3.6 Declarative Plugin Format (v1)

```json
{
  "pluginSchemaVersion": "1.0",
  "name": "acme-shortcuts",
  "version": "1.0.0",
  "description": "Team shortcuts for the Acme app",
  "actions": [
    {
      "name": "login",
      "label": "Login with email/password",
      "params": [
        { "name": "email", "type": "string" },
        { "name": "password", "type": "string", "secret": true }
      ],
      "steps": [
        { "action": "navigate", "url": "/login" },
        { "action": "fill", "selector": { "strategy": "id", "value": "email" },
          "resolver": { "type": "param", "name": "email" } },
        { "action": "fill", "selector": { "strategy": "id", "value": "password" },
          "resolver": { "type": "param", "name": "password" } },
        { "action": "click", "selector": { "strategy": "css", "value": "button[type=submit]" } },
        { "action": "assert", "assertion": "urlMatches", "pattern": "**/dashboard" }
      ]
    }
  ],
  "assertionPresets": [
    {
      "name": "loggedIn",
      "label": "User is logged in",
      "assertions": [
        { "assertion": "elementVisible", "selector": { "strategy": "testid", "value": "user-menu" } }
      ]
    }
  ]
}
```

- Imported via UI (file picker / drag-drop); files live in the app repo (e.g.,
  `.aitomate/plugins/`) and are shared like scenario files.
- Custom actions appear as composite blocks in the Build view and expand to
  primitive steps at run time.
- v2 (backlog): TypeScript plugin SDK with programmatic extension points
  (actions, resolvers, assertions, reporters). The declarative format stays
  forward-compatible.

### 3.7 Testing Strategy (Extension's Own Tests)

Distinct from the product's purpose (running user scenarios) — this is how
*Aitomate itself* is tested.

- **Unit/component tests: Vitest.** WXT ships first-class Vitest support via
  `WxtVitest` plugin from `wxt/testing`: it polyfills WebExtension APIs with
  `@webext-core/fake-browser` (in-memory `browser.storage`, messaging, tabs),
  applies the project's Vite config, and enables WXT auto-imports in tests.
  Targets: runner state machine, value resolvers, selector generation/lookup
  (jsdom/happy-dom for DOM logic), vault crypto (WebCrypto available in Node),
  React components.
- **Schema tests: plain Vitest** in `packages/schema` — valid/invalid fixtures
  for every step/resolver/assertion variant; the spec's §3.3 example must always
  parse. Schema is the cross-package contract, so it gets the strictest coverage.
- **E2E smoke tests: Playwright** (`chromium` persistent context with the built
  extension loaded via `--load-extension`). Covers: extension loads, popup
  renders, a bundled static-only scenario runs green against a local demo page.
  Chromium-only (Playwright cannot load extensions in Firefox); Firefox coverage
  stays manual per release (FR-8 test matrix). Note: this Playwright usage is a
  *test harness for the extension itself* — unrelated to the backlog idea of a
  Playwright-based CI runner for user scenarios.
- Every milestone task that adds engine logic includes its unit tests; E2E smoke
  runs at least once per phase completion.

### 3.8 UI/UX Structure by Persona

| View | Audience | Contents |
| :-- | :-- | :-- |
| Build — Simple mode | PO / QA (and anyone) | Recorder start/stop, plain-language step list (reorder, delete, edit static values), save/export scenario — no raw selectors or resolver internals |
| Build — Advanced mode | Developer | Full step editor, selector picker, resolver config (static/dynamic/AI/DB), session-marker config, plugin import/manager |
| Run | All (PO-first) | Scenario picker (import), environment selector (base URL, connector profile), Run button, live progress, pass/fail report |
| Settings | All (scoped) | LLM provider config, DB connector profiles, bridge pairing, config import/export (encrypted bundle), theme, advanced/simple view toggle |

- Default view on install: **Run** (least intimidating for PO). Build opens in
  Simple mode by default; Advanced mode is a toggle (persisted per user).
- First-run wizard: import scenario → (only if scenario needs it) import config
  bundle → run.

---

## 4. Tasks — Milestones & Implementation Breakdown

Each task is scoped to be handed independently to an AI coding agent.

### Milestone 1 — MVP
*Recorder + replay + Static/Array/AI resolvers + reporting. No DB, no plugins.*

**Phase 1: Foundation**
- [x] T1.1: Scaffold WXT monorepo (pnpm workspaces): `apps/extension` with React +
  TypeScript (`@wxt-dev/module-react`), MV3 manifest targeting Chrome, Edge, Firefox.
- [x] T1.2: `packages/schema`: scenario JSON schema as Zod + generated TS types
  (steps, selectors incl. `shadowPath`/`framePath`, resolvers, assertions, setup ref).
- [x] T1.3: Local encrypted vault (WebCrypto AES-GCM + PBKDF2 wrapper around
  `browser.storage.local`); lazy passphrase prompt (only when AI/DB features used).
- [x] T1.4: Popup/side-panel shell with Build/Run/Settings navigation; side-panel
  adapter (Chrome `sidePanel` / Firefox sidebar / popup fallback).
- [x] T1.5: Testing infrastructure: ~~Vitest + `WxtVitest` in `apps/extension`,
  Vitest in `packages/schema`~~ (done with T1.2/T1.3), Playwright E2E smoke
  harness (chromium + `--load-extension`); root `pnpm test` runs all.

**Phase 2: Recorder & Core Engine**
- [x] T2.1: Content script recorder: click/input/navigation capture with
  multi-strategy selector generation (testid > id > aria > css > text),
  open-shadow-DOM composed-path capture, same-origin iframe support
  (`all_frames`), CSRF/hidden-input auto-exclusion, new-tab warning.
- [x] T2.2: Background service worker: scenario runner state machine (idle,
  recording, playing, paused, error) + per-step retry/backoff + smart-wait
  (DOM stability) before each step.
- [x] T2.3: Value Resolver interface + Static and Dynamic(array) modes.
- [x] T2.4: Playback interaction layer: native event dispatch for controlled
  inputs (React/Vue), shadow-piercing + frame-descending element lookup,
  `DataTransfer`-based file upload replay (bundled fixtures).
- [x] T2.5: Built-in assertion set (FR-7) as executable steps.
- [x] T2.6: Step editor UI (Build view) with Simple mode (plain-language step
  list: reorder, delete, edit static values) and Advanced mode (edit selector,
  resolver, assertions, session marker per step).
- [x] T2.7: Import/Export scenario as `.aitomate.json` (+ suite as zip).
- [x] T2.8: Scenario chaining: `setup.scenarioRef` execution, setup-failure
  reporting, `meta.sessionMarker` skip (per FR-10; re-run when marker absent).
- [x] T2.9: Build view "Save to library" — persist the recorded scenario to
  `storage.local` directly (`saveScenario`, already used by import), no
  export-then-import round trip. Per §3.8, Build Simple mode's action set is
  "save/export scenario" — only export shipped in T2.6.
- [x] T2.10: Run view "Run suite" — execute all (or a selected subset of)
  stored scenarios sequentially in one action, aggregating a per-scenario
  pass/fail summary. Per FR-5, run modes are "single scenario, suite
  (sequential)" — only single-scenario run shipped in T2.7.
- [x] T2.11: Build view "Add step manually" — insert a new step into the
  scenario without recording it (e.g. an "Add step" button offering
  click/fill/navigate/wait/assert), editable through the same Simple/
  Advanced editors T2.6 already ships. Not previously scoped anywhere in
  this spec; gap found 0.3.2.
- [x] T2.12: Build view "Locate on page" — clicking a step (or an explicit
  action on it) highlights/scrolls to the corresponding element in the
  active tab, so a PO/QA/dev can visually confirm the step's selector
  targets the right element before running it. Requires a content-script
  message to resolve + flash/outline the element (reuse the shadow/frame-
  piercing lookup from T2.4); no-match surfaces a plain-language "Element
  not found on this page" instead of failing silently. Gap found 0.3.2.
- [x] T2.13: Recorder navigation-step fix — wire the existing
  `buildNavigateStep` builder into the content script's capture path so
  same-tab URL navigation during a recording produces a `navigate` step
  (per FR-1); currently the builder is unused dead code. Gap found 0.3.2.
- [ ] T2.14: Environment profiles (FR-3) — generalize the single hardcoded
  `{{BASE_URL}}` substitution into FR-3's full "environment variable
  placeholders" scheme: named, non-secret environment profiles (name →
  variable map) managed via a Run view environment selector, so a scenario
  can reference more than one placeholder (e.g. `{{BASE_URL}}`,
  `{{API_HOST}}`) instead of only a single free-text Base URL override.
  `resolveUrl`/`executeNavigation` (`step-executor.ts`) and the Run view's
  Base URL field only ever handled the one token; 0.3.5 made any *other*
  unresolved `{{...}}` fail loud instead of silently mis-navigating, but
  did not add the ability to actually resolve one. Gap found 0.3.5.

**Phase 3: AI Resolver**
- [x] T3.1: LLM Provider abstraction + OpenAI-compatible and Anthropic-compatible
  adapters (configurable base URL covers local runtimes like Ollama/LM Studio).
- [x] T3.2: Dynamic(ai) resolver with prompt + constraint schema + optional
  session cache.
- [x] T3.3: LLM provider settings UI + PO-friendly error handling for AI failures.

**Phase 4: Reporting & PO/QA UX**
- [x] T4.1: Run report data model (step results, screenshots on failure, timing,
  console/network errors).
- [x] T4.2: Run view UI: simplified pass/fail summary + expandable step detail
  (Advanced toggle reveals selectors).
- [x] T4.3: Export report as JSON/HTML.
- [x] T4.4: First-run onboarding wizard (zero-setup static path).
- [x] T4.5: Firefox/Edge build verification + polyfill audit.

### Milestone 2 — Database & Team Config
- [ ] T5.1: `packages/bridge` → `aitomate-bridge` CLI: connector profiles,
  pairing token, localhost REST `POST /query`, SELECT-only SQL guard;
  MySQL/MariaDB + PostgreSQL drivers.
- [ ] T5.2: Extension-side bridge client + pairing flow in Settings.
- [ ] T5.3: Database resolver + connector profile management UI.
- [ ] T5.4: Config import/export: encrypted bundle (share passphrase, PBKDF2 +
  AES-GCM), selective export, merge-on-import; out-of-band passphrase warning copy.
- [ ] T5.5: Non-secret team manifest support (`.aitomate/connectors.json`):
  detect + report missing connector configs per scenario suite.
- [ ] T5.6: PO-friendly error handling for bridge/DB failures.

### Milestone 3 — Plugins & Release
- [ ] T6.1: Declarative plugin format (Zod schema in `packages/schema`).
- [ ] T6.2: Plugin import UI + registry; composite actions in Build view;
  expansion to primitive steps at runtime.
- [ ] T6.3: Sample plugin: parameterized "Login" action for the demo app.
- [ ] T6.4: Cross-browser packaging scripts (WXT build + zip per store).
- [ ] T6.5: Documentation (Dev/QA/PO personas separately); MIT license files.
- [ ] T6.6: Example targets: one server-rendered demo (Laravel Blade) + one SPA
  demo (React or Vue) with sample scenarios + sample plugin + team manifest.

### Backlog (Post-MVP, not scheduled)
- Standalone CI runner consuming `.aitomate.json` (recommended: Playwright-based)
  + Pest/Composer wrapper for Laravel teams + CI pipeline examples.
- TypeScript plugin SDK (programmatic actions/resolvers/assertions/reporters).
- Multi-tab / popup-window flows.
- Cross-origin iframe support.
- Deep scenario chaining (setup-of-setup).
- SQLite driver for the bridge; MCP adapter mode for the bridge.
- Visual regression plugin.

---

## 5. Open Questions (To Resolve Before/During Development)

1. **Bridge pairing UX:** one-time token paste vs. localhost handshake page —
   pick during T5.2 design.
2. **Versioning/migration strategy** for `.aitomate.json` schemaVersion changes
   over time (breaking changes handling).
Resolved since 0.2.0 initial draft:
- ~~Session-marker mechanism for chaining skip~~ → defined per setup scenario
  (`meta.sessionMarker`, optional); no marker = always re-run setup; no global
  suite-level marker (FR-10).
- ~~LLM providers for v1~~ → two adapters: OpenAI-compatible + Anthropic-compatible.
  Local runtimes (Ollama, LM Studio, vLLM) ride the OpenAI-compatible adapter via
  configurable base URL — no separate adapter needed.

Resolved since 0.1.0:
- ~~Plugin loading security model~~ → v1 declarative JSON plugins; TS SDK deferred (FR-4).
- ~~CI execution bridge~~ → dropped from MVP; backlog recommends Playwright-based runner.
- ~~Multi-database scope~~ → MySQL/MariaDB + PostgreSQL in M2; SQLite backlog.
- ~~Team collaboration on connector profiles~~ → non-secret team manifest +
  encrypted config bundles (FR-9).
- ~~Licensing~~ → MIT for everything in the repo.

---

## 6. Repo Structure (WXT-Aligned)

pnpm-workspace monorepo. The extension app follows WXT's conventional layout
(`entrypoints/`, `wxt.config.ts`); shared code lives in workspace packages.

```
aitomate/
|-- apps/
|   `-- extension/                 # WXT project (React + TS)
|       |-- entrypoints/
|       |   |-- background.ts      # service worker: runner state machine
|       |   |-- content.ts         # recorder + playback content script
|       |   |-- popup/             # popup UI (React)
|       |   |   |-- index.html
|       |   |   `-- main.tsx
|       |   `-- sidepanel/         # side panel UI (React)
|       |       |-- index.html
|       |       `-- main.tsx
|       |-- components/            # shared React components (shadcn/ui)
|       |-- lib/                   # runner, resolvers, vault, bridge client
|       |-- stores/                # Zustand stores
|       |-- assets/
|       |-- public/                # static files copied as-is (icons)
|       `-- wxt.config.ts
|-- packages/
|   |-- schema/                    # Zod schemas + TS types: scenario, plugin, report
|   `-- bridge/                    # aitomate-bridge CLI (Node, REST over localhost)
|-- examples/
|   |-- demo-ssr/                  # server-rendered demo target (Laravel Blade)
|   `-- demo-spa/                  # SPA demo target (React or Vue)
|-- docs/
|   |-- for-developers.md
|   |-- for-qa.md
|   `-- for-product-owners.md
|-- pnpm-workspace.yaml
|-- LICENSE                        # MIT
`-- aitomate-spec-kit.md           # this file (source of truth)
```

Notes:
- WXT auto-generates the manifest from `entrypoints/` — file names/locations in
  `apps/extension` are load-bearing, follow WXT conventions exactly.
- `packages/schema` is consumed by both the extension and the bridge (and by the
  future CI runner), keeping the scenario file format the single contract.

---

*End of Spec-Kit v0.3.5 — update this file as decisions are made; treat it as
the source of truth for AI coding agents working on this project.*
