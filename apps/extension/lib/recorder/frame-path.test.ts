// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { computeFramePath } from './frame-path';

describe('computeFramePath', () => {
  it('returns undefined for the top-level frame', () => {
    expect(computeFramePath(window)).toBeUndefined();
  });

  // Nested same-origin/cross-origin iframe traversal needs a real multi-window
  // browsing context (window.frameElement / cross-document window.parent),
  // which jsdom/happy-dom don't model faithfully. Covered by the E2E harness
  // once a same-origin iframe demo page exists (spec §3.7 backlog item).
});
