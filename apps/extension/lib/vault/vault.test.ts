import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { Vault, VaultLockedError, VaultNotInitializedError, WrongPassphraseError } from './vault';

// Low iteration count keeps PBKDF2 fast in tests; production default is 600k.
const TEST_ITERATIONS = 10_000;

function makeVault() {
  return new Vault({ iterations: TEST_ITERATIONS });
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('vault lifecycle', () => {
  it('starts uninitialized, then locked after init + lock, unlocked after unlock', async () => {
    const vault = makeVault();
    expect(await vault.getStatus()).toBe('uninitialized');

    await vault.initialize('correct horse battery staple');
    expect(await vault.getStatus()).toBe('unlocked');

    vault.lock();
    expect(await vault.getStatus()).toBe('locked');

    await vault.unlock('correct horse battery staple');
    expect(await vault.getStatus()).toBe('unlocked');
  });

  it('rejects unlock with a wrong passphrase', async () => {
    const vault = makeVault();
    await vault.initialize('right');
    vault.lock();
    await expect(vault.unlock('wrong')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    expect(await vault.getStatus()).toBe('locked');
  });

  it('rejects unlock before initialization', async () => {
    await expect(makeVault().unlock('any')).rejects.toBeInstanceOf(
      VaultNotInitializedError,
    );
  });

  it('rejects double initialization', async () => {
    const vault = makeVault();
    await vault.initialize('one');
    await expect(vault.initialize('two')).rejects.toThrow(/already exists/);
  });
});

describe('vault entries', () => {
  it('round-trips an entry value', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('llm-provider', 'default', {
      provider: 'openai-compatible',
      apiKey: 'sk-secret-123',
    });
    await expect(vault.getEntry('llm-provider', 'default')).resolves.toEqual({
      provider: 'openai-compatible',
      apiKey: 'sk-secret-123',
    });
  });

  it('persists entries across lock/unlock (fresh Vault instance)', async () => {
    const first = makeVault();
    await first.initialize('pass');
    await first.setEntry('db-connector', 'mysql-primary', { host: 'db.local' });
    first.lock();

    const second = makeVault();
    await second.unlock('pass');
    await expect(
      second.getEntry('db-connector', 'mysql-primary'),
    ).resolves.toEqual({ host: 'db.local' });
  });

  it('refuses reads and writes while locked', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    vault.lock();
    await expect(vault.getEntry('llm-provider', 'x')).rejects.toBeInstanceOf(
      VaultLockedError,
    );
    await expect(
      vault.setEntry('llm-provider', 'x', {}),
    ).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('lists entry names while locked (non-secret index, FR-9)', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('db-connector', 'mysql-primary', { host: 'h' });
    await vault.setEntry('llm-provider', 'default', { apiKey: 'k' });
    vault.lock();

    await expect(vault.listEntries()).resolves.toEqual([
      { kind: 'db-connector', name: 'mysql-primary' },
      { kind: 'llm-provider', name: 'default' },
    ]);
  });

  it('does not duplicate index entries on overwrite', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('llm-provider', 'default', { apiKey: 'a' });
    await vault.setEntry('llm-provider', 'default', { apiKey: 'b' });
    await expect(vault.listEntries()).resolves.toHaveLength(1);
    await expect(vault.getEntry('llm-provider', 'default')).resolves.toEqual({
      apiKey: 'b',
    });
  });

  it('deletes entries and their index refs', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('db-connector', 'mysql-primary', { host: 'h' });
    await vault.deleteEntry('db-connector', 'mysql-primary');
    await expect(vault.listEntries()).resolves.toEqual([]);
    await expect(
      vault.getEntry('db-connector', 'mysql-primary'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined for a missing entry', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await expect(vault.getEntry('llm-provider', 'nope')).resolves.toBeUndefined();
  });
});

describe('security at rest', () => {
  it('never stores plaintext secret material in storage.local', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('llm-provider', 'default', {
      apiKey: 'sk-super-secret-value',
    });
    const raw = JSON.stringify(await browser.storage.local.get());
    expect(raw).not.toContain('sk-super-secret-value');
    expect(raw).not.toContain('pass');
  });

  it('changePassphrase keeps data, invalidates the old passphrase', async () => {
    const vault = makeVault();
    await vault.initialize('old-pass');
    await vault.setEntry('db-connector', 'pg', { host: 'pg.local' });

    await vault.changePassphrase('old-pass', 'new-pass');
    vault.lock();

    await expect(vault.unlock('old-pass')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    await vault.unlock('new-pass');
    await expect(vault.getEntry('db-connector', 'pg')).resolves.toEqual({
      host: 'pg.local',
    });
  });

  it('changePassphrase requires the current passphrase', async () => {
    const vault = makeVault();
    await vault.initialize('right');
    await expect(
      vault.changePassphrase('wrong', 'next'),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('reset wipes everything back to uninitialized', async () => {
    const vault = makeVault();
    await vault.initialize('pass');
    await vault.setEntry('llm-provider', 'default', { apiKey: 'k' });
    await vault.reset();
    expect(await vault.getStatus()).toBe('uninitialized');
    await expect(vault.listEntries()).resolves.toEqual([]);
    expect(await browser.storage.local.get()).toEqual({});
  });
});
