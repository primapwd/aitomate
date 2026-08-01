# Aitomate Demo — Sign Up Form

Static, dependency-free HTML fixture for manually testing the extension.
No build step — serve it with anything:

```bash
python3 -m http.server 8081 --directory examples/demo-ssr
# or (avoid if you also need urlMatches on a ".html" URL — see caveat below)
npx serve examples/demo-ssr -l 8081
```

Then open `http://localhost:8081/index.html`, load the unpacked extension,
and record against it. Port 8081 (not 8080) sidesteps a clash with
`pnpm dev`'s own server, and matches the Base URL baked into
`test-ssr.aitomate.json` (see below).

`npx serve` rewrites URLs by default (`cleanUrls`): `/index.html` redirects
to `/`, `/success.html` redirects to `/success` — the `.html` suffix never
survives. That breaks any `urlMatches` assertion pattern that ends in
`.html`, and can silently drop query params through the redirect too.
`python3 -m http.server` does no rewriting at all, so prefer it if your
scenario asserts on exact URLs.

## What it exercises

| Feature | Element(s) |
|---|---|
| Static fill (text/email) | `full-name-input`, `email-input` |
| Select | `role-select` |
| Radio group | `plan-basic`, `plan-pro` |
| Checkbox | `subscribe-checkbox`, `show-advanced-checkbox` |
| Textarea | `notes-textarea` |
| File upload | `avatar-upload` |
| CSRF auto-exclusion (FR-1) | hidden `_csrf` field — should never appear as a step |
| `elementEnabled`/`elementDisabled` | `advanced-toggle-btn` — disabled until `show-advanced-checkbox` is checked |
| `elementVisible`/`elementNotVisible` | `advanced-panel` — hidden until `show-advanced-checkbox` is checked |
| `elementCount` | `feature-item` — 3 matches |
| Navigation + `urlMatches` | form submits (GET) to `success.html` |
| `textContains`/`textEquals`/`inputValue` | `success-banner`, `submitted-*` (echoes form values as query params) |
| New-tab pause warning (FR-1) | `external-link` (`target="_blank"`) |

## Suggested first scenario

1. Start recording on `index.html`.
2. Fill `full-name-input`, `email-input`; select a `role-select` option;
   pick `plan-pro`; check `subscribe-checkbox`.
3. Click `submit-button` (navigates to `success.html`).
4. Assert `elementVisible` on `success-banner`.
5. Assert `urlMatches` on `**/success.html*`.
6. Assert `textContains` on `submitted-full_name` for the name you filled.
7. Save to library, then re-run it from the Run view.

Alternatively, import the ready-made `test-ssr.aitomate.json` in this
directory — it covers all the rows above (including file upload) and
already has `meta.baseUrl` set to `http://localhost:8081`, so the Run
view's Base URL field can stay blank if you're serving on that port.
