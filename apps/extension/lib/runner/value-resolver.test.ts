import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAiCache,
  resetSequentialCounters,
  resolveStepValues,
  resolveValue,
} from './value-resolver';

const AI_RESOLVER = { type: 'dynamic' as const, mode: 'ai' as const, provider: 'configured-default' as const };
const llmGenerate = vi.fn(async (_p: string) => 'ai-value');

beforeEach(() => {
  resetSequentialCounters();
  resetAiCache();
  llmGenerate.mockClear();
  llmGenerate.mockResolvedValue('ai-value');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveValue — static', () => {
  it('returns a string value as-is', async () => {
    await expect(resolveValue({ type: 'static', value: 'hello' })).resolves.toBe('hello');
  });

  it('returns a numeric value as-is', async () => {
    await expect(resolveValue({ type: 'static', value: 42 })).resolves.toBe(42);
  });

  it('returns a boolean value as-is', async () => {
    await expect(resolveValue({ type: 'static', value: true })).resolves.toBe(true);
  });
});

describe('resolveValue — dynamic array (random)', () => {
  it('returns one of the values', async () => {
    const values = ['a', 'b', 'c'];
    const result = await resolveValue({
      type: 'dynamic',
      mode: 'array',
      values,
      order: 'random',
    });
    expect(values).toContain(result);
  });

  it('uses random order', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await expect(
      resolveValue({ type: 'dynamic', mode: 'array', values: ['x', 'y', 'z'], order: 'random' }),
    ).resolves.toBe('x');
    vi.restoreAllMocks();
  });
});

describe('resolveValue — dynamic array (sequential)', () => {
  it('returns values in order', async () => {
    const resolver = {
      type: 'dynamic' as const,
      mode: 'array' as const,
      values: ['a', 'b', 'c'],
      order: 'sequential' as const,
    };
    await expect(resolveValue(resolver)).resolves.toBe('a');
    await expect(resolveValue(resolver)).resolves.toBe('b');
    await expect(resolveValue(resolver)).resolves.toBe('c');
  });

  it('wraps around when reaching the end', async () => {
    const resolver = {
      type: 'dynamic' as const,
      mode: 'array' as const,
      values: ['x', 'y'],
      order: 'sequential' as const,
    };
    await resolveValue(resolver);
    await resolveValue(resolver);
    await expect(resolveValue(resolver)).resolves.toBe('x');
  });
});

describe('resolveValue — dynamic ai', () => {
  it('calls the LLM provider with the prompt', async () => {
    const result = await resolveValue(
      { ...AI_RESOLVER, prompt: 'email address' },
      undefined,
      llmGenerate,
    );
    expect(result).toBe('ai-value');
    expect(llmGenerate).toHaveBeenCalledWith('email address', undefined);
  });

  it('passes constraints to the LLM provider', async () => {
    await resolveValue(
      { ...AI_RESOLVER, prompt: 'name', constraints: { format: 'full_name', maxLength: 50 } },
      undefined,
      llmGenerate,
    );
    expect(llmGenerate).toHaveBeenCalledWith('name', { format: 'full_name', maxLength: 50 });
  });

  it('caches the result so identical prompts reuse the same AI value', async () => {
    const resolver = { ...AI_RESOLVER, prompt: 'email' };
    const a = await resolveValue(resolver, undefined, llmGenerate);
    const b = await resolveValue(resolver, undefined, llmGenerate);
    expect(a).toBe('ai-value');
    expect(b).toBe('ai-value');
    expect(llmGenerate).toHaveBeenCalledTimes(1);
  });

  it('throws with a clear message when no LLM provider is available', async () => {
    await expect(
      resolveValue({ ...AI_RESOLVER, prompt: 'test' }),
    ).rejects.toThrow('AI provider');
  });
});

describe('resolveValue — unimplemented modes', () => {
  it('throws for database', async () => {
    await expect(
      resolveValue({ type: 'database', dataSourceRef: 'users', query: 'SELECT email' }),
    ).rejects.toThrow('database');
  });

  it('throws for param', async () => {
    await expect(resolveValue({ type: 'param', name: 'email' })).rejects.toThrow('plugin parameter');
  });
});

describe('resolveStepValues', () => {
  it('resolves fill step with static resolver unchanged', async () => {
    const step = {
      id: 's1',
      action: 'fill' as const,
      selector: { strategy: 'testid' as const, value: 'email' },
      resolver: { type: 'static' as const, value: 'a@b.com' },
    } as Parameters<typeof resolveStepValues>[0];
    const resolved = await resolveStepValues(step);
    expect(resolved.action).toBe('fill');
    if (resolved.action === 'fill') {
      expect((resolved.resolver as { value: unknown }).value).toBe('a@b.com');
    }
  });

  it('resolves dynamic array fill step to static', async () => {
    const step = {
      id: 's1',
      action: 'fill' as const,
      selector: { strategy: 'testid' as const, value: 'email' },
      resolver: { type: 'dynamic' as const, mode: 'array' as const, values: ['a@b.com', 'c@d.com'], order: 'random' as const },
    } as Parameters<typeof resolveStepValues>[0];
    const resolved = await resolveStepValues(step);
    expect(resolved.action).toBe('fill');
    if (resolved.action === 'fill') {
      expect(resolved.resolver.type).toBe('static');
    }
  });

  it('resolves AI fill step via LLM provider', async () => {
    const step = {
      id: 's1',
      action: 'fill' as const,
      selector: { strategy: 'testid' as const, value: 'email' },
      resolver: { ...AI_RESOLVER, prompt: 'email address' },
    } as Parameters<typeof resolveStepValues>[0];
    const resolved = await resolveStepValues(step, llmGenerate);
    expect(resolved.action).toBe('fill');
    if (resolved.action === 'fill') {
      expect((resolved.resolver as { value: unknown }).value).toBe('ai-value');
    }
    expect(llmGenerate).toHaveBeenCalled();
  });

  it('passes non-fill steps through unchanged', async () => {
    const step = {
      id: 's2',
      action: 'click' as const,
      selector: { strategy: 'testid' as const, value: 'btn' },
    };
    await expect(resolveStepValues(step)).resolves.toBe(step);
  });
});

describe('ai cache', () => {
  it('separates cache entries by constraints', async () => {
    await resolveValue({ ...AI_RESOLVER, prompt: 'prompt', constraints: { format: 'email' } }, undefined, llmGenerate);
    await resolveValue({ ...AI_RESOLVER, prompt: 'prompt', constraints: { format: 'name' } }, undefined, llmGenerate);
    expect(llmGenerate).toHaveBeenCalledTimes(2);
  });

  it('resetAiCache clears the cache', async () => {
    const resolver = { ...AI_RESOLVER, prompt: 'x' };
    await resolveValue(resolver, undefined, llmGenerate);
    resetAiCache();
    await resolveValue(resolver, undefined, llmGenerate);
    expect(llmGenerate).toHaveBeenCalledTimes(2);
  });
});
