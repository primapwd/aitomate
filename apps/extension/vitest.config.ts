import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: 'node',
    // e2e/ is Playwright's suite (own runner, own config), not Vitest's.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
