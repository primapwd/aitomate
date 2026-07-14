import { browser } from 'wxt/browser';

const DEBUG_KEY = 'aitomate:debug:enabled';

export async function isDebugEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(DEBUG_KEY);
  return stored[DEBUG_KEY] === true;
}

export async function setDebugEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [DEBUG_KEY]: enabled });
}

/**
 * Conditional debug log. No-op when debug mode is off.
 * Pass a label so the source is traceable in console output.
 *
 * Because reading storage on every call is wasteful, callers that already
 * hold the flag should use `debugLogIf(enabled, label, ...args)` instead.
 */
export function debugLog(label: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log(`[aitomate:debug:${label}]`, ...args);
  }
  // In production, storage read at each call is OK for debug — it's opt-in
  // and low-frequency relative to runtime.
  void isDebugEnabled()
    .then((on) => {
      if (on) console.log(`[aitomate:debug:${label}]`, ...args);
    })
    .catch(() => {
      /* storage unavailable — ignore */
    });
}

/** Debug log gated by a pre-fetched flag (preferred inside hot paths). */
export function debugLogIf(enabled: boolean, label: string, ...args: unknown[]): void {
  if (enabled || import.meta.env.DEV) {
    console.log(`[aitomate:debug:${label}]`, ...args);
  }
}
