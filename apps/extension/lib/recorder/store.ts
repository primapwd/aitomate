import type { Step } from '@aitomate/schema';
import { browser } from 'wxt/browser';
import { initialSessionState, type RecorderSessionState } from './session';

export interface TabRecording {
  session: RecorderSessionState;
  steps: Step[];
}

/**
 * Per-tab recording store (FR-1). The MV3 service worker can be torn down
 * after ~30s of idle, so recordings must not live only in worker memory —
 * `storage.session` is memory-backed, survives worker restarts, and is
 * cleared when the browser closes, which matches a recording's lifetime.
 * Where `storage.session` is unavailable (older Firefox), the promise cache
 * below is the store: the MV2 background page persists, so that is safe.
 */
const storageKey = (tabId: number) => `aitomate:recorder:tab:${tabId}`;

// Caching the *promise* (not the value) means concurrent events for the same
// tab share one load and mutate one object — no lost updates within a worker.
const cache = new Map<number, Promise<TabRecording>>();

function sessionArea(): typeof browser.storage.local | undefined {
  return (browser.storage as { session?: typeof browser.storage.local }).session;
}

export function getRecording(tabId: number): Promise<TabRecording> {
  let pending = cache.get(tabId);
  if (!pending) {
    pending = load(tabId);
    cache.set(tabId, pending);
  }
  return pending;
}

async function load(tabId: number): Promise<TabRecording> {
  const empty: TabRecording = { session: initialSessionState, steps: [] };
  const area = sessionArea();
  if (!area) return empty;
  const key = storageKey(tabId);
  const stored = await area.get(key);
  return (stored[key] as TabRecording | undefined) ?? empty;
}

export async function saveRecording(tabId: number, recording: TabRecording): Promise<void> {
  cache.set(tabId, Promise.resolve(recording));
  await sessionArea()?.set({ [storageKey(tabId)]: recording });
}

export async function clearRecording(tabId: number): Promise<void> {
  cache.delete(tabId);
  await sessionArea()?.remove(storageKey(tabId));
}

/** Test hook: drop the in-worker cache so the next read hits storage. */
export function resetRecordingCache(): void {
  cache.clear();
}
