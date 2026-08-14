// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import {
  appendCapture,
  captureStorageKey,
  captureTabScreenshot,
  clearCaptureBuffer,
  errorEventText,
  filterRunCapture,
  networkErrorText,
  networkFailureText,
  parseCaptureMessage,
  readCaptureBuffer,
  recordCaptureEntry,
  rejectionText,
} from './capture';

const TAB_ID = 42;

function entry(kind: 'page' | 'network', text: string, timestamp: number) {
  return { kind, text, timestamp };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('appendCapture', () => {
  it('appends entries in order', () => {
    const next = appendCapture([], entry('page', 'a', 1));
    expect(appendCapture(next, entry('page', 'b', 2))).toEqual([
      entry('page', 'a', 1),
      entry('page', 'b', 2),
    ]);
  });

  it('drops the oldest entries beyond the cap', () => {
    const start = Array.from({ length: 5 }, (_, i) =>
      entry('page', `e${i}`, i),
    );
    const next = appendCapture(start, entry('network', 'n', 99), 5);
    expect(next).toHaveLength(5);
    expect(next[0]).toEqual(entry('page', 'e1', 1));
    expect(next[4]).toEqual(entry('network', 'n', 99));
  });
});

describe('filterRunCapture', () => {
  it('keeps only entries inside the run window', () => {
    const buffer = [
      entry('page', 'before', 100),
      entry('page', 'during-1', 150),
      entry('network', 'during-2', 200),
      entry('page', 'after', 300),
    ];
    expect(filterRunCapture(buffer, 120, 250)).toEqual([
      entry('page', 'during-1', 150),
      entry('network', 'during-2', 200),
    ]);
  });
});

describe('errorEventText', () => {
  it('reads message from an ErrorEvent', () => {
    const event = new ErrorEvent('error', {
      message: 'boom',
      error: new TypeError('boom'),
    });
    expect(errorEventText(event)).toBe('TypeError: boom');
  });

  it('falls back to the message when no error object is attached', () => {
    const event = new ErrorEvent('error', { message: 'Script error.' });
    expect(errorEventText(event)).toBe('Script error.');
  });

  it('labels resource load failures with the failing URL', () => {
    const img = document.createElement('img');
    img.src = 'https://cdn.test/x.png';
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: img });
    expect(errorEventText(event)).toBe(
      'Failed to load resource: https://cdn.test/x.png',
    );
  });

  it('falls back to the tag name when a resource has no src', () => {
    const div = document.createElement('div');
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: div });
    expect(errorEventText(event)).toBe('Failed to load resource: div');
  });
});

describe('rejectionText', () => {
  it('reads Error name and message', () => {
    expect(rejectionText(new RangeError('too big'))).toBe(
      'RangeError: too big',
    );
  });

  it('passes strings through', () => {
    expect(rejectionText('nope')).toBe('nope');
  });

  it('JSON-stringifies plain objects', () => {
    expect(rejectionText({ code: 500 })).toBe('{"code":500}');
  });
});

describe('network texts', () => {
  it('formats an HTTP error', () => {
    expect(networkErrorText(500, 'https://app.test/api/x')).toBe(
      'HTTP 500: https://app.test/api/x',
    );
  });

  it('formats a network failure', () => {
    expect(networkFailureText('net::ERR_CONNECTION_REFUSED', 'https://x.test')).toBe(
      'Network failure (net::ERR_CONNECTION_REFUSED): https://x.test',
    );
  });
});

describe('parseCaptureMessage', () => {
  const ORIGIN = 'https://app.test';
  const entry = (overrides?: Record<string, unknown>) => ({
    source: 'aitomate-capture',
    text: 'Error: boom',
    timestamp: 123,
    ...overrides,
  });

  it('accepts a well-formed same-origin message', () => {
    expect(parseCaptureMessage(entry(), ORIGIN, ORIGIN)).toEqual({
      kind: 'page',
      text: 'Error: boom',
      timestamp: 123,
    });
  });

  it('rejects cross-origin messages (ad embeds, other iframes)', () => {
    expect(
      parseCaptureMessage(entry(), 'https://ads.evil.test', ORIGIN),
    ).toBeNull();
  });

  it('rejects wrong source names', () => {
    expect(
      parseCaptureMessage(entry({ source: 'something-else' }), ORIGIN, ORIGIN),
    ).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(parseCaptureMessage('nope', ORIGIN, ORIGIN)).toBeNull();
    expect(parseCaptureMessage(null, ORIGIN, ORIGIN)).toBeNull();
  });

  it('rejects malformed text/timestamp', () => {
    expect(
      parseCaptureMessage(entry({ text: 42 }), ORIGIN, ORIGIN),
    ).toBeNull();
    expect(
      parseCaptureMessage(entry({ timestamp: 'later' }), ORIGIN, ORIGIN),
    ).toBeNull();
  });
});

describe('capture storage', () => {
  it('round-trips entries through storage.session', async () => {
    await recordCaptureEntry(TAB_ID, entry('page', 'boom', 1));
    await recordCaptureEntry(TAB_ID, entry('network', 'HTTP 500', 2));

    const buffer = await readCaptureBuffer(TAB_ID);
    expect(buffer).toEqual([
      entry('page', 'boom', 1),
      entry('network', 'HTTP 500', 2),
    ]);
    expect(captureStorageKey(TAB_ID)).toBe('aitomate:run-capture:42');
  });

  it('isolates buffers per tab', async () => {
    await recordCaptureEntry(TAB_ID, entry('page', 'boom', 1));
    expect(await readCaptureBuffer(TAB_ID + 1)).toEqual([]);
  });

  it('clears the buffer', async () => {
    await recordCaptureEntry(TAB_ID, entry('page', 'boom', 1));
    await clearCaptureBuffer(TAB_ID);
    expect(await readCaptureBuffer(TAB_ID)).toEqual([]);
  });

  it('returns empty for an unknown tab', async () => {
    expect(await readCaptureBuffer(TAB_ID)).toEqual([]);
  });
});

describe('captureTabScreenshot', () => {
  it('returns undefined when captureVisibleTab fails', async () => {
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({
      windowId: 7,
    } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>);
    vi.spyOn(browser.tabs, 'captureVisibleTab').mockRejectedValue(
      new Error('Not allowed'),
    );

    const shot = await captureTabScreenshot(TAB_ID);
    expect(shot).toBeUndefined();
  });

  it('returns the captured data URL', async () => {
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({
      windowId: 7,
    } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>);
    // The fake-browser stub types captureVisibleTab as void-returning; the
    // real API returns a Promise<string> — cast the value, not the spy.
    const captureVisibleTab = vi.spyOn(browser.tabs, 'captureVisibleTab');
    captureVisibleTab.mockResolvedValue('data:image/png;base64,AAAA' as never);

    const shot = await captureTabScreenshot(TAB_ID);
    expect(shot).toBe('data:image/png;base64,AAAA');
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  });
});
