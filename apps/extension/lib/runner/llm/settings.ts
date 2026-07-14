import { browser } from 'wxt/browser';
import type { LLMConfig } from './provider';

/**
 * Non-secret LLM settings — the API key lives in the encrypted vault (FR-9).
 * Stored in plain `storage.local` since provider/baseUrl/model aren't secrets.
 */

const SETTINGS_KEY = 'aitomate:llm:settings';

export interface LlmUiSettings {
  provider: LLMConfig['provider'];
  baseUrl: string;
  model: string;
}

const DEFAULTS: LlmUiSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export async function getLlmSettings(): Promise<LlmUiSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(stored[SETTINGS_KEY] as Partial<LlmUiSettings> | undefined) };
}

export async function setLlmSettings(settings: LlmUiSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}
