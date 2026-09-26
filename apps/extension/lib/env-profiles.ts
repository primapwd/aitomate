import { browser } from 'wxt/browser';

/**
 * Named, non-secret environment profiles (FR-3, T2.14): a profile is a
 * plain name → variable map (e.g. `API_HOST`) resolved into `{{VAR}}`
 * placeholders at run time. Deliberately NOT in the encrypted vault —
 * profiles hold no credentials (secrets stay vault-only, FR-3/FR-9) — and
 * deliberately NOT part of the scenario file: they are per-machine config,
 * like ui-prefs.
 */

const PROFILES_KEY = 'aitomate:env-profiles';

export interface EnvProfile {
  /** Unique profile name (the Run view selector's label). */
  name: string;
  /** Placeholder names without braces → replacement values. */
  vars: Record<string, string>;
}

export async function listEnvProfiles(): Promise<EnvProfile[]> {
  const stored = await browser.storage.local.get(PROFILES_KEY);
  const profiles = stored[PROFILES_KEY];
  return Array.isArray(profiles) ? (profiles as EnvProfile[]) : [];
}

/** Upsert by name — renaming is save-new + delete-old from the manager UI. */
export async function saveEnvProfile(profile: EnvProfile): Promise<void> {
  const all = await listEnvProfiles();
  const idx = all.findIndex((p) => p.name === profile.name);
  if (idx === -1) all.push(profile);
  else all[idx] = profile;
  await browser.storage.local.set({ [PROFILES_KEY]: all });
}

export async function deleteEnvProfile(name: string): Promise<void> {
  const all = await listEnvProfiles();
  await browser.storage.local.set({
    [PROFILES_KEY]: all.filter((p) => p.name !== name),
  });
}
