import { browser } from 'wxt/browser';
import { errorEventText, rejectionText } from './capture-text';

export { errorEventText, rejectionText };

/**
 * Run-report capture (FR-5): screenshot on failure + console/network error
 * capture. This module owns the *shape* of what gets captured and the
 * storage plumbing; the actual collectors are wiring in entrypoints:
 *
 * - Page errors (uncaught exceptions + unhandled rejections + resource load
 *   failures) come from the MAIN-world capture script
 *   (`entrypoints/capture.content.ts`) forwarded over `postMessage` to the
 *   isolated-world content script, which relays them to the background via
 *   `aitomate:runner:capture-entry` (content scripts cannot access
 *   `storage.session`). Isolated-world `error` listeners do NOT receive
 *   page-world uncaught exceptions (verified empirically on MV3), so the
 *   collectors must run in the page context. Page `console.error()` *calls*
 *   are still not captured in v1; the `consoleErrors` report field carries
 *   the page errors that would surface red in a console.
 * - Network errors come from background `webRequest` observation
 *   (`onErrorOccurred` + `onCompleted` with status >= 400) — requires the
 *   `webRequest` permission and `<all_urls>` host permissions, declared in
 *   wxt.config.ts.
 *
 * Both writers append to the same tab-scoped ring buffer in
 * `storage.session`, shared across extension contexts; background reads and
 * clears it at report time, windowed to [startedAt, finishedAt].
 */

/** One captured page/network error during a run. */
export interface CaptureEntry {
  kind: 'page' | 'network';
  text: string;
  timestamp: number;
}

export const CAPTURE_MAX_ENTRIES = 100;

/** Tab-scoped capture buffer key in storage.session (shared across contexts). */
export function captureStorageKey(tabId: number): string {
  return `aitomate:run-capture:${tabId}`;
}

/** Append to a bounded ring buffer — pure, drops oldest beyond the cap. */
export function appendCapture(
  buffer: CaptureEntry[],
  entry: CaptureEntry,
  max: number = CAPTURE_MAX_ENTRIES,
): CaptureEntry[] {
  const next = [...buffer, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Keep only entries that occurred inside the run window — pure. */
export function filterRunCapture(
  buffer: CaptureEntry[],
  startedAt: number,
  finishedAt: number,
): CaptureEntry[] {
  return buffer.filter(
    (e) => e.timestamp >= startedAt && e.timestamp <= finishedAt,
  );
}

/**
 * Human-readable text for a failed HTTP request. */
export function networkErrorText(status: number, url: string): string {
  return `HTTP ${status}: ${url}`;
}

/** Network failure text for a request that never completed. */
export function networkFailureText(error: string, url: string): string {
  return `Network failure (${error}): ${url}`;
}

/**
 * Validate a postMessage payload from the MAIN-world capture script and
 * return the entry to persist, or null to drop it.
 *
 * `eventOrigin` must equal the page origin: cross-origin frames (ad
 * embeds, other-extension iframes) can postMessage into the top window and
 * must not forge report entries. This cannot distinguish *same-origin*
 * page scripts from our MAIN-world script — both run in the page context
 * and can produce byte-identical messages (the MAIN world has no extension
 * API access, verified empirically: `browser.runtime` is undefined there,
 * so it cannot message the background directly). A token carried over
 * postMessage would be page-observable and therefore forgeable, so the
 * honest boundary here is origin + shape. If reports ever become formal
 * evidence, the sound fix is a per-load secret delivered out-of-band
 * (`scripting.executeScript` args + `tabs.sendMessage`), not a
 * postMessage token.
 */
export function parseCaptureMessage(
  data: unknown,
  eventOrigin: string,
  pageOrigin: string,
): CaptureEntry | null {
  if (!data || typeof data !== 'object') return null;
  const { source, text, timestamp } = data as {
    source?: unknown;
    text?: unknown;
    timestamp?: unknown;
  };
  if (source !== 'aitomate-capture') return null;
  if (typeof text !== 'string' || typeof timestamp !== 'number') return null;
  if (eventOrigin !== pageOrigin) return null;
  return { kind: 'page', text, timestamp };
}

// ── storage.session plumbing (shared by content + background writers) ──

export async function readCaptureBuffer(tabId: number): Promise<CaptureEntry[]> {
  const key = captureStorageKey(tabId);
  const data = await browser.storage.session.get(key);
  const entries = data[key];
  return Array.isArray(entries) ? (entries as CaptureEntry[]) : [];
}

export async function clearCaptureBuffer(tabId: number): Promise<void> {
  await browser.storage.session.remove(captureStorageKey(tabId));
}

/** Read-modify-write append. Callers are rare (real error events), so the
 *  race window is negligible; bounded by CAPTURE_MAX_ENTRIES regardless. */
export async function recordCaptureEntry(
  tabId: number,
  entry: CaptureEntry,
): Promise<void> {
  const key = captureStorageKey(tabId);
  const data = await browser.storage.session.get(key);
  const buffer = Array.isArray(data[key]) ? (data[key] as CaptureEntry[]) : [];
  await browser.storage.session.set({ [key]: appendCapture(buffer, entry) });
}

/**
 * Best-effort viewport screenshot of the run tab at report time (FR-5).
 * Requires the tab to be the active tab of its window (`activeTab` grant).
 * Fails silently — a missing screenshot must not fail the run.
 */
export async function captureTabScreenshot(
  tabId: number,
): Promise<string | undefined> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.windowId) return undefined;
    return await browser.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
    });
  } catch {
    return undefined;
  }
}
