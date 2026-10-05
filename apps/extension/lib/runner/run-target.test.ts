import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { createBackgroundRunTab } from './run-target';

describe('createBackgroundRunTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an inactive tab at the current web page', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 4, url: 'https://example.test/form' }] as never);
    vi.spyOn(browser.tabs, 'create').mockResolvedValue({ id: 9 } as never);

    await expect(createBackgroundRunTab()).resolves.toBe(9);
    expect(browser.tabs.create).toHaveBeenCalledWith({ active: false, url: 'https://example.test/form' });
  });

  it('does not copy browser-internal URLs into the run tab', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 4, url: 'chrome://extensions' }] as never);
    vi.spyOn(browser.tabs, 'create').mockResolvedValue({ id: 9 } as never);

    await createBackgroundRunTab();
    expect(browser.tabs.create).toHaveBeenCalledWith({ active: false });
  });

  it('fails clearly when no active tab exists', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([] as never);
    await expect(createBackgroundRunTab()).rejects.toThrow('No active tab found. Open a page first.');
  });
});
