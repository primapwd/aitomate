/**
 * LLM Provider abstraction (T3.1). Two built-in adapters:
 *   - OpenAI-compatible (covers OpenAI, OpenRouter, Ollama, LM Studio, vLLM)
 *   - Anthropic-compatible
 *
 * Both are configured per-machine (stored in the encrypted vault, FR-9) so
 * the same `.aitomate.json` works for every teammate — a cloud key user and
 * a local-Ollama user just have different settings. The scenario file only
 * says `"provider": "configured-default"`.
 *
 * Reasoning models need different handling per family:
 *   - OpenAI o1/o3 use `max_completion_tokens` (not `max_tokens`) and accept
 *     `reasoning_effort`.
 *   - DeepSeek-R1/deepseek-reasoner are OpenAI-compatible but still expect
 *     `max_tokens` — only true OpenAI reasoning models renamed the field.
 *   - Anthropic's extended thinking is opt-in via a `thinking` block
 *     (`budget_tokens`), and shifts the response to a content-block array
 *     where the answer is the first `type: "text"` block, not `content[0]`.
 */

export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Reasoning effort. OpenAI: passed through as `reasoning_effort` for
   *  o1/o3. Anthropic: maps to an extended-thinking token budget. Ignored
   *  by models that don't support reasoning. */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface LLMConstraints {
  format?: string;
  maxLength?: number;
  regex?: string;
}

export interface LLMProvider {
  generate(prompt: string, constraints?: LLMConstraints): Promise<string>;
}

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com/v1';

/** True OpenAI reasoning models — these rename `max_tokens` to `max_completion_tokens`. */
const OPENAI_STYLE_REASONING_PREFIXES = ['o1', 'o3'];
/** OpenAI-compatible reasoning models that still use the standard `max_tokens` field. */
const OPENAI_COMPAT_REASONING_PREFIXES = ['deepseek-r1', 'deepseek-reasoner'];

const ANTHROPIC_EFFORT_BUDGET_TOKENS: Record<NonNullable<LLMConfig['reasoningEffort']>, number> = {
  low: 2000,
  medium: 8000,
  high: 16000,
};

/** Default per-provider configs — used when the user hasn't customised. */
export const DEFAULT_CONFIGS: Record<LLMConfig['provider'], Omit<LLMConfig, 'apiKey'>> = {
  openai: { provider: 'openai', baseUrl: DEFAULT_OPENAI_URL, model: 'gpt-4o-mini' },
  anthropic: { provider: 'anthropic', baseUrl: DEFAULT_ANTHROPIC_URL, model: 'claude-sonnet-4-20250514' },
};

/** True for any model that reasons internally (affects prompt wording either way). */
function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();
  return [...OPENAI_STYLE_REASONING_PREFIXES, ...OPENAI_COMPAT_REASONING_PREFIXES].some((p) =>
    lower.startsWith(p),
  );
}

/** True only for OpenAI's own o1/o3 family, which renamed the token-limit field. */
function usesMaxCompletionTokens(model: string): boolean {
  const lower = model.toLowerCase();
  return OPENAI_STYLE_REASONING_PREFIXES.some((p) => lower.startsWith(p));
}

function emptyResponseError(isReasoning: boolean): Error {
  return new Error(
    isReasoning
      ? 'LLM returned an empty response (the reasoning budget was likely exhausted before an answer was produced — try a higher reasoning effort or a shorter prompt)'
      : 'LLM returned an empty response',
  );
}

// ── In-memory session cache (resets on SW restart) ──

const cache = new Map<string, string>();

export function resetLlmCache(): void {
  cache.clear();
}

function cacheKey(config: LLMConfig, prompt: string, constraints?: LLMConstraints): string {
  return JSON.stringify({
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    prompt,
    constraints,
  });
}

function cached(config: LLMConfig, prompt: string, constraints?: LLMConstraints): string | undefined {
  return cache.get(cacheKey(config, prompt, constraints));
}

function setCached(
  config: LLMConfig,
  prompt: string,
  constraints: LLMConstraints | undefined,
  result: string,
): void {
  cache.set(cacheKey(config, prompt, constraints), result);
}

// ── Provider factory ──

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
  }
}

// ── OpenAI-compatible adapter ──

class OpenAIProvider implements LLMProvider {
  private config: LLMConfig;
  private isReasoning: boolean;

  constructor(config: LLMConfig) {
    this.config = config;
    this.isReasoning = isReasoningModel(config.model);
  }

  async generate(prompt: string, constraints?: LLMConstraints): Promise<string> {
    const hit = cached(this.config, prompt, constraints);
    if (hit !== undefined) return hit;

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: buildPrompt(prompt, constraints, this.isReasoning) }],
    };

    if (usesMaxCompletionTokens(this.config.model)) {
      body.max_completion_tokens = 1000;
      if (this.config.reasoningEffort) {
        body.reasoning_effort = this.config.reasoningEffort;
      }
    } else if (this.isReasoning) {
      // OpenAI-compatible but not OpenAI's own field rename (e.g. DeepSeek-R1).
      body.max_tokens = 2000;
    } else {
      body.max_tokens = 500;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI API error (${response.status}): ${text}`);
    }

    const json = await response.json() as { choices: { message: { content: string; refusal?: string } }[] };
    const msg = json.choices?.[0]?.message;
    if (msg?.refusal) {
      throw new Error(`OpenAI refused to respond: ${msg.refusal}`);
    }
    const result = msg?.content ?? '';
    if (!result.trim()) {
      throw emptyResponseError(this.isReasoning);
    }
    setCached(this.config, prompt, constraints, result);
    return result;
  }
}

// ── Anthropic-compatible adapter ──

class AnthropicProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(prompt: string, constraints?: LLMConstraints): Promise<string> {
    const hit = cached(this.config, prompt, constraints);
    if (hit !== undefined) return hit;

    const thinking = this.config.reasoningEffort
      ? { type: 'enabled' as const, budget_tokens: ANTHROPIC_EFFORT_BUDGET_TOKENS[this.config.reasoningEffort] }
      : undefined;

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/messages`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: thinking ? thinking.budget_tokens + 500 : 500,
      messages: [{ role: 'user', content: buildPrompt(prompt, constraints, Boolean(thinking)) }],
    };
    if (thinking) body.thinking = thinking;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    const json = await response.json() as { content: { type: string; text?: string }[] };
    // With extended thinking enabled, content[0] is a "thinking" block, not
    // the answer — find the first "text" block instead of assuming index 0.
    const textBlock = json.content?.find((block) => block.type === 'text');
    const result = textBlock?.text ?? '';
    if (!result.trim()) {
      throw emptyResponseError(Boolean(thinking));
    }
    setCached(this.config, prompt, constraints, result);
    return result;
  }
}

// ── Shared prompt builder ──

function buildPrompt(prompt: string, constraints?: LLMConstraints, isReasoning?: boolean): string {
  let full = prompt;
  if (constraints?.format) full += `\n\nFormat: ${constraints.format}`;
  if (constraints?.maxLength) full += `\n\nMax length: ${constraints.maxLength} characters`;
  if (constraints?.regex) full += `\n\nMust match regex: ${constraints.regex}`;
  // Reasoning models tend to ignore this instruction.
  if (!isReasoning) full += '\n\nReturn only the value, no explanation or formatting.';
  return full;
}
