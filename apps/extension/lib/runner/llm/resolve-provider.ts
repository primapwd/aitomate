import { vault } from '@/lib/vault';
import { getLlmSettings } from './settings';
import { createProvider, type LLMConfig } from './provider';
import type { LlmGenerateFn } from '../value-resolver';

const VAULT_ENTRY_NAME = 'default';

interface LlmSecret {
  apiKey: string;
}

/**
 * Build the callback a dynamic(ai) fill step needs to actually reach the
 * configured LLM provider. Never touches the vault until the returned
 * function is called — a scenario with no ai-resolver steps must never
 * prompt for a passphrase (Constitution: zero-setup baseline).
 */
export function buildLlmGenerate(): LlmGenerateFn {
  return async (prompt, constraints) => {
    const status = await vault.getStatus();
    if (status === 'uninitialized') {
      throw new Error(
        'This step uses an AI-generated value, but no AI provider is configured. Configure one in Settings.',
      );
    }
    if (status === 'locked') {
      throw new Error(
        'This step uses an AI-generated value, but the vault is locked. Unlock it in Settings to continue.',
      );
    }

    const secret = await vault.getEntry<LlmSecret>('llm-provider', VAULT_ENTRY_NAME);
    if (!secret?.apiKey) {
      throw new Error(
        'This step uses an AI-generated value, but no AI provider is configured. Configure one in Settings.',
      );
    }

    const settings = await getLlmSettings();
    const config: LLMConfig = { ...settings, apiKey: secret.apiKey };
    return createProvider(config).generate(prompt, constraints);
  };
}
