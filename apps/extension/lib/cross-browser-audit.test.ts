import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T4.5 (Firefox/Edge build verification + polyfill audit) — automates the
 * Hard Constraint "Cross-browser: use `browser.*` (WXT polyfill), never
 * `chrome.*`. No Chrome-only API without fallback" so a future PR that
 * slips in a direct `chrome.*` call fails CI instead of only surfacing
 * during a manual Firefox test pass.
 *
 * Scans source (not `.output`/`.wxt`/`node_modules`/test files) for a bare
 * `chrome.<identifier>` reference. `sidepanel.ts`'s narrowed casts
 * (`browser as { sidePanel?: ... }`) are the sanctioned way to reach a
 * browser-specific API — they go through `browser.*`, never `chrome.*`,
 * so they don't trip this audit.
 */

const SCAN_DIRS = ['entrypoints', 'lib', 'components'];
const EXTENSIONS = new Set(['.ts', '.tsx']);
const CHROME_API_PATTERN = /\bchrome\.[a-zA-Z]/;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    files.push(full);
  }
  return files;
}

describe('cross-browser API audit', () => {
  it('contains no direct chrome.* API usage outside the browser.* polyfill', async () => {
    const root = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      const files = await collectSourceFiles(path.join(root, dir));
      for (const file of files) {
        const content = await readFile(file, 'utf-8');
        if (CHROME_API_PATTERN.test(content)) {
          offenders.push(path.relative(root, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
