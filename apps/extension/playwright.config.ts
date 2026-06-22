import { defineConfig } from '@playwright/test';

// Persistent-context extension loading requires a single worker: each
// worker would otherwise spin up its own profile dir, and Chromium only
// exposes one extension service worker at a time reliably.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
