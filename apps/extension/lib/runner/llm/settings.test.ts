import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getLlmSettings, setLlmSettings } from './settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('LlmSettings', () => {
  it('returns default settings when nothing is stored', async () => {
    const settings = await getLlmSettings();
    expect(settings).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
  });

  it('round-trips through setLlmSettings', async () => {
    await setLlmSettings({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
    });

    const loaded = await getLlmSettings();
    expect(loaded).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('merges partial stored data over defaults', async () => {
    await setLlmSettings({ provider: 'openai', baseUrl: 'https://custom.com/v1', model: 'gpt-4o' });

    const loaded = await getLlmSettings();
    expect(loaded.baseUrl).toBe('https://custom.com/v1');
    expect(loaded.model).toBe('gpt-4o');
  });
});
