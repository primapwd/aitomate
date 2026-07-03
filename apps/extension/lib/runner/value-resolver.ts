import type { DynamicArrayResolver, Resolver, Step } from '@aitomate/schema';

/**
 * Value Resolver (T2.3): resolves a Resolver definition to a concrete value.
 *
 * Modes:
 * - `static`        — returns the fixed value directly. Zero setup.
 * - `dynamic/array` — picks from a candidate list; random or sequential.
 *                      Zero setup.
 * - `dynamic/ai`    — throws; needs T3.2 (LLM adapter).
 * - `database`      — throws; needs T5.3 (bridge client).
 * - `param`         — throws; needs FR-4 (plugin param expansion).
 *
 * All three future modes (ai, database, param) go through the same
 * `resolveValue()` interface so the caller never needs to change.
 */

export type ResolvedValue = string | number | boolean;

export interface ResolverContext {
  /** Unique run identifier — reserved for future use (sequential-mode
   *  persistence across runs within a suite). Not yet consumed. */
  runId?: string;
}

/**
 * In-memory sequential counters. Reset on service-worker restart; that's
 * acceptable for MVP zero-setup — guaranteed persistence would require
 * writing to storage.local (not worth it for sequential array mode).
 */
const sequentialCounters = new Map<string, number>();

/** Public: resolve a single resolver definition to a concrete value. */
export function resolveValue(
  resolver: Resolver,
  _context?: ResolverContext,
): ResolvedValue {
  switch (resolver.type) {
    case 'static':
      return resolver.value;

    case 'dynamic':
      if (resolver.mode === 'array') return resolveArray(resolver);
      throw new Error(
        'This step uses an AI-generated value, which is not supported yet.',
      );

    case 'database':
      throw new Error(
        'This step uses a database value, which is not supported yet.',
      );

    case 'param':
      throw new Error(
        'This step uses a plugin parameter, which is not supported yet.',
      );
  }
}

function resolveArray(resolver: DynamicArrayResolver): ResolvedValue {
  if (resolver.order === 'sequential') {
    // JSON key, not join: ['a|b'] and ['a','b'] must not share a counter.
    const key = JSON.stringify(resolver.values);
    const current = sequentialCounters.get(key) ?? 0;
    const value = resolver.values[current % resolver.values.length];
    sequentialCounters.set(key, current + 1);
    return value;
  }

  // Default: random
  const index = Math.floor(Math.random() * resolver.values.length);
  return resolver.values[index];
}

/**
 * Resolve every dynamic value in a step. For `fill` steps, replaces the
 * resolver with a static one carrying the resolved value so the content
 * script (or any downstream consumer) never needs to know about resolvers.
 * For all other step types, returns the step unchanged.
 */
export function resolveStepValues(step: Step): Step {
  if (step.action !== 'fill') return step;

  return {
    ...step,
    resolver: { type: 'static', value: resolveValue(step.resolver) },
  };
}

/** Test hook: reset sequential counters between test runs. */
export function resetSequentialCounters(): void {
  sequentialCounters.clear();
}
