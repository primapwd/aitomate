import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { isSidePanelSupported, openSidePanel } from './sidepanel';

/**
 * T4.5 (Firefox/Edge build verification + polyfill audit) — locks in the
 * side-panel adapter's cross-browser fallback (spec FR-8): Chrome/Edge
 * expose `sidePanel`, Firefox exposes `sidebarAction`, neither API is in
 * the `browser.*` polyfill's types, and a browser with neither must fail
 * loud with a plain message instead of throwing on an undefined call.
 *
 * These tests describe behavior the implementation (`sidepanel.ts`)
 * already has — written now because a Chrome-only or Firefox-only API
 * used without this fallback is exactly the class of bug T4.5 exists to
 * catch, and the adapter shipped in T1.4 without a test of its own.
 */

interface MutableBrowser {
  sidePanel?: { open(options: { windowId: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
}

const mutableBrowser = browser as unknown as MutableBrowser;

afterEach(() => {
  delete mutableBrowser.sidePanel;
  delete mutableBrowser.sidebarAction;
  fakeBrowser.reset();
});

describe('isSidePanelSupported', () => {
  it('is true when the Chrome/Edge sidePanel API is present', () => {
    mutableBrowser.sidePanel = { open: vi.fn() };
    expect(isSidePanelSupported()).toBe(true);
  });

  it('is true when the Firefox sidebarAction API is present', () => {
    mutableBrowser.sidebarAction = { open: vi.fn() };
    expect(isSidePanelSupported()).toBe(true);
  });

  it('is false when neither API is present', () => {
    expect(isSidePanelSupported()).toBe(false);
  });
});

describe('openSidePanel', () => {
  it('opens via the Chrome/Edge sidePanel API, passing the current window id', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    mutableBrowser.sidePanel = { open };
    vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({ id: 42 } as never);

    await openSidePanel();

    expect(open).toHaveBeenCalledWith({ windowId: 42 });
  });

  it('falls back to the Firefox sidebarAction API when sidePanel is absent', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    mutableBrowser.sidebarAction = { open };

    await openSidePanel();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('prefers the Chrome/Edge API when both happen to be present', async () => {
    const chromeOpen = vi.fn().mockResolvedValue(undefined);
    const firefoxOpen = vi.fn().mockResolvedValue(undefined);
    mutableBrowser.sidePanel = { open: chromeOpen };
    mutableBrowser.sidebarAction = { open: firefoxOpen };
    vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({ id: 1 } as never);

    await openSidePanel();

    expect(chromeOpen).toHaveBeenCalled();
    expect(firefoxOpen).not.toHaveBeenCalled();
  });

  it('throws a plain-language error when neither API is supported', async () => {
    await expect(openSidePanel()).rejects.toThrow(/does not support a side panel/i);
  });

  it('throws when the Chrome API is present but the current window id is unknown', async () => {
    mutableBrowser.sidePanel = { open: vi.fn() };
    vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({} as never);

    await expect(openSidePanel()).rejects.toThrow(/current browser window/i);
  });
});
