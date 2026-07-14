import type { VaultStatus } from './vault';

/**
 * Vault message protocol (T3.3). Popup/sidepanel → background.
 * Background handles vault state so the SW's Vault singleton stays
 * unlocked for the duration of a run with AI steps.
 */

export type VaultCommand =
  | { type: 'aitomate:vault:status' }
  | { type: 'aitomate:vault:initialize'; passphrase: string }
  | { type: 'aitomate:vault:unlock'; passphrase: string }
  | { type: 'aitomate:vault:lock' }
  | { type: 'aitomate:vault:reset' };

export type VaultResponse =
  | { status: VaultStatus; ok: true }
  | { ok: false; error: string };
