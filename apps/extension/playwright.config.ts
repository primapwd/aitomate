import { defineConfig } from '@playwright/test';

// Persistent-context extension loading requires a single worker: each
// worker would otherwise spin up its own profile dir, and Chromium only
// exposes one extension service worker at a time reliably.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  webServer: {
    // Spec §3.7: the smoke runs a bundled static-only scenario against
    // examples/demo-ssr, served verbatim (no URL rewriting) — see
    // e2e/serve-demo.mjs.
    command: 'node e2e/serve-demo.mjs',
    url: 'http://localhost:8081/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  use: {
    trace: 'retain-on-failure',
  },
});
