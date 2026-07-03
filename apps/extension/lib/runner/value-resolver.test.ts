import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSequentialCounters,
  resolveStepValues,
  resolveValue,
} from './value-resolver';

beforeEach(() => {
  resetSequentialCounters();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveValue — static', () => {
  it('returns a string value as-is', () => {
    expect(resolveValue({ type: 'static', value: 'hello' })).toBe('hello');
  });

  it('returns a numeric value as-is', () => {
    expect(resolveValue({ type: 'static', value: 42 })).toBe(42);
  });

  it('returns a boolean value as-is', () => {
    expect(resolveValue({ type: 'static', value: true })).toBe(true);
  });
});

describe('resolveValue — dynamic array (random)', () => {
  it('returns one of the values', () => {
    const values = ['a', 'b', 'c'];
    const result = resolveValue({ type: 'dynamic', mode: 'array', values, order: 'random' });
    expect(values).toContain(result);
  });

  it('uses random order', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(resolveValue({ type: 'dynamic', mode: 'array', values: ['x', 'y', 'z'], order: 'random' })).toBe('x');
    vi.restoreAllMocks();
  });

  it('can pick any index', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const values = ['a', 'b', 'c'];
    expect(resolveValue({ type: 'dynamic', mode: 'array', values, order: 'random' })).toBe('c');
    vi.restoreAllMocks();
  });
});

describe('resolveValue — dynamic array (sequential)', () => {
  it('returns values in order', () => {
    const resolver = { type: 'dynamic' as const, mode: 'array' as const, values: ['a', 'b', 'c'], order: 'sequential' as const };
    expect(resolveValue(resolver)).toBe('a');
    expect(resolveValue(resolver)).toBe('b');
    expect(resolveValue(resolver)).toBe('c');
  });

  it('wraps around when reaching the end', () => {
    const resolver = { type: 'dynamic' as const, mode: 'array' as const, values: ['x', 'y'], order: 'sequential' as const };
    resolveValue(resolver); // x
    resolveValue(resolver); // y
    expect(resolveValue(resolver)).toBe('x');
    expect(resolveValue(resolver)).toBe('y');
  });

  it('isolates counters by values identity', () => {
    const a = { type: 'dynamic' as const, mode: 'array' as const, values: ['1', '2'], order: 'sequential' as const };
    const b = { type: 'dynamic' as const, mode: 'array' as const, values: ['a', 'b', 'c'], order: 'sequential' as const };
    expect(resolveValue(a)).toBe('1');
    expect(resolveValue(b)).toBe('a');
    expect(resolveValue(a)).toBe('2');
    expect(resolveValue(b)).toBe('b');
  });

  it('resets counters after resetSequentialCounters', () => {
    const resolver = { type: 'dynamic' as const, mode: 'array' as const, values: ['only'], order: 'sequential' as const };
    resolveValue(resolver);
    resetSequentialCounters();
    expect(resolveValue(resolver)).toBe('only');
  });
});

describe('resolveValue — unimplemented modes', () => {
  it('throws for dynamic/ai', () => {
    expect(() =>
      resolveValue({
        type: 'dynamic',
        mode: 'ai',
        prompt: 'generate email',
        provider: 'configured-default',
      }),
    ).toThrow('AI-generated value');
  });

  it('throws for database', () => {
    expect(() =>
      resolveValue({
        type: 'database',
        dataSourceRef: 'users',
        query: 'SELECT email FROM users LIMIT 1',
      }),
    ).toThrow('database value');
  });

  it('throws for param', () => {
    expect(() =>
      resolveValue({ type: 'param', name: 'email' }),
    ).toThrow('plugin parameter');
  });
});

describe('resolveStepValues', () => {
  it('resolves fill step resolver to static', () => {
    const step = {
      id: 's1',
      action: 'fill' as const,
      selector: { strategy: 'testid' as const, value: 'email' },
      resolver: { type: 'dynamic' as const, mode: 'array' as const, values: ['a@b.com', 'c@d.com'], order: 'random' as const },
    } as Parameters<typeof resolveStepValues>[0];
    const resolved = resolveStepValues(step);
    expect(resolved.action).toBe('fill');
    if (resolved.action === 'fill') {
      expect(resolved.resolver.type).toBe('static');
      const r = resolved.resolver as { type: 'static'; value: string | number | boolean };
      expect(['a@b.com', 'c@d.com']).toContain(r.value);
    }
  });

  it('passes non-fill steps through unchanged', () => {
    const step = {
      id: 's2',
      action: 'click' as const,
      selector: { strategy: 'testid' as const, value: 'btn' },
    };
    expect(resolveStepValues(step)).toBe(step);
  });
});
