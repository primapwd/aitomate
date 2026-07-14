import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvider, resetLlmCache } from './provider';

function mockFetch(response: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

beforeEach(() => {
  resetLlmCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAI provider', () => {
  const config = {
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
  };

  it('returns the generated text from a successful call', async () => {
    mockFetch({ choices: [{ message: { content: 'john@example.com' } }] });
    const provider = createProvider(config);
    const result = await provider.generate('email address');
    expect(result).toBe('john@example.com');
  });

  it('sends the correct request body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
      text: async () => '{"choices":[{"message":{"content":"x"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider(config);
    await provider.generate('name', { format: 'full_name', maxLength: 50 });

    const callArg = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(callArg.model).toBe('gpt-4o-mini');
    expect(callArg.messages[0].content).toContain('Format: full_name');
    expect(callArg.messages[0].content).toContain('Max length: 50');
  });

  it('caches identical prompt+constraints across calls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'cached-value' } }] }),
      text: async () => '{"choices":[{"message":{"content":"cached-value"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider(config);
    const a = await provider.generate('email');
    const b = await provider.generate('email');
    expect(a).toBe('cached-value');
    expect(b).toBe('cached-value');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call from cache
  });

  it('throws on HTTP error with the status and response body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const provider = createProvider(config);
    await expect(provider.generate('test')).rejects.toThrow('401');
  });
});

describe('Anthropic provider', () => {
  const config = {
    provider: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-20250514',
  };

  it('returns the generated text from a successful call', async () => {
    mockFetch({ content: [{ type: 'text', text: 'Jane Doe' }] });
    const provider = createProvider(config);
    const result = await provider.generate('full name');
    expect(result).toBe('Jane Doe');
  });

  it('sends the Anthropic auth header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'x' }] }),
      text: async () => '{"content":[{"text":"x"}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider(config);
    await provider.generate('test');

    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('caches identical prompts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'dup' }] }),
      text: async () => '{"content":[{"text":"dup"}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider(config);
    await provider.generate('repeat');
    await provider.generate('repeat');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const provider = createProvider(config);
    await expect(provider.generate('test')).rejects.toThrow('429');
  });

  it('sends a thinking block with a token budget when reasoningEffort is set', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'thinking', text: undefined },
          { type: 'text', text: 'answer' },
        ],
      }),
      text: async () => 'ok',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({ ...config, reasoningEffort: 'high' });
    const result = await provider.generate('test');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16000 });
    expect(body.max_tokens).toBe(16500);
    expect(result).toBe('answer');
  });

  it('does not send a thinking block when reasoningEffort is unset', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'x' }] }),
      text: async () => 'ok',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider(config);
    await provider.generate('test');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.thinking).toBeUndefined();
  });

  it('throws instead of returning an empty string when only a thinking block comes back', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'thinking', text: undefined }] }),
      text: async () => 'ok',
    });

    const provider = createProvider({ ...config, reasoningEffort: 'low' });
    await expect(provider.generate('test')).rejects.toThrow('empty response');
  });
});

describe('reasoning models (o1/o3/DeepSeek-R1)', () => {
  it('sends max_completion_tokens instead of max_tokens for o3-mini', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '42' } }] }),
      text: async () => '{"choices":[{"message":{"content":"42"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'o3-mini',
      reasoningEffort: 'medium',
    });

    await provider.generate('test');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe('medium');
  });

  it('omits the "no explanation" instruction for reasoning models', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
      text: async () => '{"choices":[{"message":{"content":"x"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'o1',
    });

    await provider.generate('test');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages[0].content).not.toContain('no explanation');
  });

  it('sends max_tokens (not max_completion_tokens) for DeepSeek-Reasoner', async () => {
    // DeepSeek is OpenAI-compatible but did not rename max_tokens the way
    // OpenAI's own o1/o3 API did — sending max_completion_tokens to it would
    // be silently ignored or rejected depending on server strictness.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Paris' } }] }),
      text: async () => '{"choices":[{"message":{"content":"Paris"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-ds',
      model: 'deepseek-reasoner',
    });

    await provider.generate('capital of France');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(2000);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('reads message.refusal from o3 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '', refusal: 'Content policy violation' } }] }),
      text: async () => '{"choices":[{"message":{"content":"","refusal":"Content policy violation"}}]}',
    });

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'o3-mini',
    });

    await expect(provider.generate('bad prompt')).rejects.toThrow('refused');
  });

  it('throws instead of returning an empty string when the reasoning budget is exhausted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
      text: async () => '{"choices":[{"message":{"content":""}}]}',
    });

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'o3-mini',
    });

    await expect(provider.generate('test')).rejects.toThrow('empty response');
  });
});

describe('cache', () => {
  it('separates cache entries by constraints', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'v' } }] }),
      text: async () => '{"choices":[{"message":{"content":"v"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    await provider.generate('prompt', { format: 'email' });
    await provider.generate('prompt', { format: 'name' });
    expect(fetchSpy).toHaveBeenCalledTimes(2); // different constraints
  });

  it('does not reuse a cached value across different models/effort', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'v' } }] }),
      text: async () => '{"choices":[{"message":{"content":"v"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const a = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });
    const b = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'o3-mini',
      reasoningEffort: 'high',
    });

    await a.generate('same prompt');
    await b.generate('same prompt');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // different model/effort, no cache hit
  });

  it('resetLlmCache clears the cache', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'v' } }] }),
      text: async () => '{"choices":[{"message":{"content":"v"}}]}',
    });
    globalThis.fetch = fetchSpy;

    const provider = createProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    await provider.generate('x');
    resetLlmCache();
    await provider.generate('x');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
