import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { isDebugEnabled, setDebugEnabled } from './debug';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('debug', () => {
  it('defaults to off', async () => {
    expect(await isDebugEnabled()).toBe(false);
  });

  it('round-trips through setDebugEnabled', async () => {
    await setDebugEnabled(true);
    expect(await isDebugEnabled()).toBe(true);

    await setDebugEnabled(false);
    expect(await isDebugEnabled()).toBe(false);
  });
});
