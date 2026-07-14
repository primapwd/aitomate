import type { DynamicArrayResolver, DynamicAiResolver, Resolver, Step } from '@aitomate/schema';

/**
 * Value Resolver (T2.3): resolves a Resolver definition to a concrete value.
 *
 * Modes:
 * - `static`        — returns the fixed value directly. Zero setup.
 * - `dynamic/array` — picks from a candidate list; random or sequential.
 *                      Zero setup.
 * - `dynamic/ai`    — calls the LLM provider (T3.2).
 * - `database`      — throws; needs T5.3 (bridge client).
 * - `param`         — throws; needs FR-4 (plugin param expansion).
 *
 * All future modes (ai, database, param) go through the same `resolveValue()`
 * interface so the caller never needs to change.
 */

export type ResolvedValue = string | number | boolean;

export interface ResolverContext {
  runId?: string;
}

/**
 * Callback type for AI value generation. Passed in by the runner so the
 * resolver doesn't need a direct dependency on the LLM module.
 */
export type LlmGenerateFn = (
  prompt: string,
  constraints?: { format?: string; maxLength?: number; regex?: string },
) => Promise<string>;

const sequentialCounters = new Map<string, number>();

/**
 * In-memory AI value cache (separate from the LLM provider's HTTP cache).
 * Caches per prompt+constraints so the same AI resolver within a run always
 * returns the same value. Reset on SW restart.
 */
const aiCache = new Map<string, ResolvedValue>();

/**
 * Resolve a single resolver definition to a concrete value.
 * Async only for AI mode; static/array are sync but wrapped for consistency.
 */
export async function resolveValue(
  resolver: Resolver,
  context?: ResolverContext,
  llmGenerate?: LlmGenerateFn,
): Promise<ResolvedValue> {
  switch (resolver.type) {
    case 'static':
      return resolver.value;

    case 'dynamic':
      if (resolver.mode === 'array') return resolveArray(resolver);
      return resolveAi(resolver, llmGenerate);

    case 'database':
      throw new Error('This step uses a database value, which is not supported yet.');

    case 'param':
      throw new Error('This step uses a plugin parameter, which is not supported yet.');
  }
}

function resolveArray(resolver: DynamicArrayResolver): ResolvedValue {
  if (resolver.order === 'sequential') {
    const key = JSON.stringify(resolver.values);
    const current = sequentialCounters.get(key) ?? 0;
    const value = resolver.values[current % resolver.values.length];
    sequentialCounters.set(key, current + 1);
    return value;
  }
  const index = Math.floor(Math.random() * resolver.values.length);
  return resolver.values[index];
}

async function resolveAi(
  resolver: DynamicAiResolver,
  llmGenerate?: LlmGenerateFn,
): Promise<ResolvedValue> {
  if (!llmGenerate) {
    throw new Error(
      'This step uses an AI-generated value, but no AI provider is configured. ' +
        'Configure an LLM provider in Settings.',
    );
  }

  // Cache key: prompt + constraints so identical prompts in the same session
  // produce the same value (saves API cost, consistent retries).
  const cacheKey = JSON.stringify({ prompt: resolver.prompt, constraints: resolver.constraints });
  const cached = aiCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await llmGenerate(resolver.prompt, resolver.constraints);
  aiCache.set(cacheKey, result);
  return result;
}

/**
 * Resolve every dynamic value in a step. For `fill` steps, replaces the
 * resolver with a static one carrying the resolved value so the content
 * script never needs to know about resolvers.
 */
export async function resolveStepValues(
  step: Step,
  llmGenerate?: LlmGenerateFn,
): Promise<Step> {
  if (step.action !== 'fill') return step;

  const value = await resolveValue(step.resolver, undefined, llmGenerate);
  return { ...step, resolver: { type: 'static', value } } as Step;
}

/** Test hooks. */
export function resetSequentialCounters(): void {
  sequentialCounters.clear();
}
export function resetAiCache(): void {
  aiCache.clear();
}
