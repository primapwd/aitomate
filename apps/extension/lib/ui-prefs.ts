import { browser } from 'wxt/browser';

/**
 * Non-secret UI preferences in plain `browser.storage.local` (NOT the vault).
 * Spec §3.8: the Build Simple/Advanced toggle persists per user.
 */

const PREFS_KEY = 'aitomate:ui:prefs';

export interface UiPrefs {
  buildMode: 'simple' | 'advanced';
  /** Last Base URL override typed in the Run view (FR-3 env profiles) — a
   * plain per-user text input, not a secret. Persisted so a PO doesn't have
   * to retype it every time the popup/side panel closes and reopens. */
  runBaseUrl: string;
}

const DEFAULT_PREFS: UiPrefs = {
  buildMode: 'simple',
  runBaseUrl: '',
};

export async function getUiPrefs(): Promise<UiPrefs> {
  const stored = await browser.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(stored[PREFS_KEY] as Partial<UiPrefs> | undefined) };
}

export async function setUiPref<K extends keyof UiPrefs>(
  key: K,
  value: UiPrefs[K],
): Promise<void> {
  const prefs = await getUiPrefs();
  await browser.storage.local.set({ [PREFS_KEY]: { ...prefs, [key]: value } });
}
