import type { Scenario } from '@aitomate/schema';
import { browser } from 'wxt/browser';
import { initialRunnerState, type RunnerSessionState } from './runner-session';
import type { StepResult } from './messages';

export interface TabRun {
  session: RunnerSessionState;
  scenario: Scenario | null;
  results: StepResult[];
}

/**
 * Per-tab runner store (T2.2). Same pattern as the recorder store — uses
 * `storage.session` so a run survives an MV3 service-worker restart.
 * Cleared when the tab closes (tabs.onRemoved).
 */
const storageKey = (tabId: number) => `aitomate:runner:tab:${tabId}`;

const cache = new Map<number, Promise<TabRun>>();

function sessionArea(): typeof browser.storage.local | undefined {
  return (browser.storage as { session?: typeof browser.storage.local }).session;
}

export function getRun(tabId: number): Promise<TabRun> {
  let pending = cache.get(tabId);
  if (!pending) {
    pending = load(tabId);
    cache.set(tabId, pending);
  }
  return pending;
}

async function load(tabId: number): Promise<TabRun> {
  const empty: TabRun = { session: initialRunnerState, scenario: null, results: [] };
  const area = sessionArea();
  if (!area) return empty;
  const key = storageKey(tabId);
  const stored = await area.get(key);
  return (stored[key] as TabRun | undefined) ?? empty;
}

export async function saveRun(tabId: number, run: TabRun): Promise<void> {
  cache.set(tabId, Promise.resolve(run));
  await sessionArea()?.set({ [storageKey(tabId)]: run });
}

export async function clearRun(tabId: number): Promise<void> {
  cache.delete(tabId);
  await sessionArea()?.remove(storageKey(tabId));
}

export function resetCache(): void {
  cache.clear();
}
