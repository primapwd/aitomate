import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteEnvProfile,
  listEnvProfiles,
  saveEnvProfile,
  type EnvProfile,
} from './env-profiles';

async function wipe(): Promise<void> {
  for (const p of await listEnvProfiles()) await deleteEnvProfile(p.name);
}

const staging: EnvProfile = {
  name: 'staging',
  vars: { API_HOST: 'staging.example.test', BASE_URL: 'https://staging.example.test' },
};

describe('env profiles storage', () => {
  beforeEach(wipe);

  it('starts empty and round-trips a profile', async () => {
    expect(await listEnvProfiles()).toEqual([]);
    await saveEnvProfile(staging);
    expect(await listEnvProfiles()).toEqual([staging]);
  });

  it('upserts by name without duplicating', async () => {
    await saveEnvProfile(staging);
    const updated: EnvProfile = { name: 'staging', vars: { API_HOST: 'api.staging.test' } };
    await saveEnvProfile(updated);
    const all = await listEnvProfiles();
    expect(all).toHaveLength(1);
    expect(all[0]?.vars.API_HOST).toBe('api.staging.test');
  });

  it('deletes by name and keeps the rest', async () => {
    await saveEnvProfile(staging);
    await saveEnvProfile({ name: 'prod', vars: {} });
    await deleteEnvProfile('staging');
    const all = await listEnvProfiles();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('prod');
  });
});
