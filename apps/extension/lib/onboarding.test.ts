import { describe, expect, it } from 'vitest';
import type { FillStep, Scenario, Step } from '@aitomate/schema';
import {
  initialOnboardingState,
  reduceOnboarding,
  scenarioNeedsConfig,
} from './onboarding';

/**
 * T4.4 (First-run onboarding wizard) — TDD contract, written before the
 * implementation exists. `scenarioNeedsConfig` and `reduceOnboarding` must
 * be created in `./onboarding.ts` to make these pass; nothing in this file
 * should need to change to accommodate the implementation.
 *
 * Design intent (Constitution: zero-setup baseline — "a static-only
 * scenario must import and run with no configuration at all... Setup cost
 * is only paid by the features that need it"):
 *   - `scenarioNeedsConfig` is the single source of truth the wizard uses
 *     to decide whether to show the config-import step at all. A
 *     static/dynamic-array-only scenario must never see a passphrase or
 *     connector prompt — the wizard has to *skip* that step, not just make
 *     it optional/dismissible, or the zero-setup guarantee is broken by a
 *     single extra click every PO/QA has to make.
 *   - `reduceOnboarding` is a pure reducer, same shape as `session.ts`
 *     (recorder) and `runner-session.ts` (runner): given the current step
 *     and an event, decide the next step. `SKIP` always jumps straight to
 *     `'complete'` from anywhere — a user backing out of onboarding must
 *     not get stuck.
 */

const baseMeta = { name: 'Demo', tags: [] };

function fillStep(resolver: FillStep['resolver']): Step {
  return {
    id: 's1',
    action: 'fill',
    selector: { strategy: 'css', value: '#field' },
    resolver,
  };
}

function scenario(overrides: Partial<Scenario>): Scenario {
  return {
    schemaVersion: '1.0',
    meta: baseMeta,
    dataSources: [],
    steps: [{ id: 's0', action: 'navigate', url: '/' }],
    ...overrides,
  };
}

describe('scenarioNeedsConfig', () => {
  it('is false for a scenario using only static/dynamic-array resolvers', () => {
    const s = scenario({
      steps: [
        fillStep({ type: 'static', value: 'a@b.com' }),
        fillStep({ type: 'dynamic', mode: 'array', values: ['x', 'y'], order: 'random' }),
      ],
    });
    expect(scenarioNeedsConfig(s)).toBe(false);
  });

  it('is false for a scenario with no fill steps at all', () => {
    const s = scenario({ steps: [{ id: 's0', action: 'navigate', url: '/' }] });
    expect(scenarioNeedsConfig(s)).toBe(false);
  });

  it('is true when any step uses the dynamic/ai resolver', () => {
    const s = scenario({
      steps: [fillStep({ type: 'dynamic', mode: 'ai', prompt: 'a name', provider: 'configured-default' })],
    });
    expect(scenarioNeedsConfig(s)).toBe(true);
  });

  it('is true when any step uses the database resolver', () => {
    const s = scenario({
      steps: [
        fillStep({ type: 'database', dataSourceRef: 'app_users', query: 'SELECT 1' }),
      ],
    });
    expect(scenarioNeedsConfig(s)).toBe(true);
  });

  it('is true when dataSources is non-empty even without a database-resolver step', () => {
    const s = scenario({
      dataSources: [{ name: 'app_users', type: 'database', connectorRef: 'mysql-primary' }],
    });
    expect(scenarioNeedsConfig(s)).toBe(true);
  });
});

describe('reduceOnboarding', () => {
  it('starts at "welcome"', () => {
    expect(initialOnboardingState).toEqual({ status: 'welcome' });
  });

  it('START moves from welcome to import-scenario', () => {
    const next = reduceOnboarding(initialOnboardingState, { type: 'START' });
    expect(next).toEqual({ status: 'import-scenario' });
  });

  it('a scenario needing no config skips straight to complete (zero-setup)', () => {
    const importing = reduceOnboarding(initialOnboardingState, { type: 'START' });
    const next = reduceOnboarding(importing, {
      type: 'SCENARIO_IMPORTED',
      needsConfig: false,
    });
    expect(next).toEqual({ status: 'complete' });
  });

  it('a scenario needing config moves to import-config, not complete', () => {
    const importing = reduceOnboarding(initialOnboardingState, { type: 'START' });
    const next = reduceOnboarding(importing, {
      type: 'SCENARIO_IMPORTED',
      needsConfig: true,
    });
    expect(next).toEqual({ status: 'import-config' });
  });

  it('CONFIG_IMPORTED completes onboarding from import-config', () => {
    const state = { status: 'import-config' as const };
    const next = reduceOnboarding(state, { type: 'CONFIG_IMPORTED' });
    expect(next).toEqual({ status: 'complete' });
  });

  it('SKIP completes onboarding from any step', () => {
    for (const status of ['welcome', 'import-scenario', 'import-config'] as const) {
      expect(reduceOnboarding({ status }, { type: 'SKIP' })).toEqual({ status: 'complete' });
    }
  });

  it('ignores SCENARIO_IMPORTED when not on the import-scenario step', () => {
    const state = { status: 'welcome' as const };
    expect(reduceOnboarding(state, { type: 'SCENARIO_IMPORTED', needsConfig: false })).toEqual(state);
  });

  it('ignores CONFIG_IMPORTED when not on the import-config step', () => {
    const state = { status: 'import-scenario' as const };
    expect(reduceOnboarding(state, { type: 'CONFIG_IMPORTED' })).toEqual(state);
  });

  it('is a no-op once complete', () => {
    const done = { status: 'complete' as const };
    expect(reduceOnboarding(done, { type: 'START' })).toEqual(done);
    expect(reduceOnboarding(done, { type: 'SCENARIO_IMPORTED', needsConfig: true })).toEqual(done);
  });
});
