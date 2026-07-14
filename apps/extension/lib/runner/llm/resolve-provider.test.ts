import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { vault } from '@/lib/vault';
import { buildLlmGenerate } from './resolve-provider';

beforeEach(() => {
  fakeBrowser.reset();
  vault.lock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildLlmGenerate', () => {
  it('does not touch the vault until the returned function is called', async () => {
    const spy = vi.spyOn(vault, 'getStatus');
    buildLlmGenerate();
    expect(spy).not.toHaveBeenCalled();
  });

  it('fails with a plain-language error when the vault is uninitialized', async () => {
    const generate = buildLlmGenerate();
    await expect(generate('prompt')).rejects.toThrow('no AI provider is configured');
  });

  it('fails with a plain-language error when the vault is locked', async () => {
    await vault.initialize('passphrase');
    vault.lock();

    const generate = buildLlmGenerate();
    await expect(generate('prompt')).rejects.toThrow('vault is locked');
  });

  it('fails when the vault is unlocked but has no llm-provider entry', async () => {
    await vault.initialize('passphrase');

    const generate = buildLlmGenerate();
    await expect(generate('prompt')).rejects.toThrow('no AI provider is configured');
  });

  it('calls the configured provider with the stored api key and settings', async () => {
    await vault.initialize('passphrase');
    await vault.setEntry('llm-provider', 'default', { apiKey: 'sk-test' });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'generated' } }] }),
      text: async () => 'ok',
    });
    globalThis.fetch = fetchSpy;

    const generate = buildLlmGenerate();
    const result = await generate('email address', { format: 'email' });

    expect(result).toBe('generated');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });
});
