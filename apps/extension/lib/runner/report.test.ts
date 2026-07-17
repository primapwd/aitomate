import { describe, expect, it } from 'vitest';
import type { Step } from '@aitomate/schema';
import type { StepResult } from './messages';
import { buildRunReport } from './report';

/**
 * T4.1 (Run report data model) — TDD contract, written before the
 * implementation exists. `buildRunReport` must be created in `./report.ts`
 * to make these pass; nothing in this file should need to change to
 * accommodate the implementation.
 *
 * Design intent (per FR-5 + AGENTS.md precedent — decision logic belongs in
 * lib/ with a test, not inline in background.ts):
 *   - Pure function: given the scenario's steps, the StepResult[] that
 *     `runSequence` already produces, start/finish timestamps, and optional
 *     screenshot/console/network data the caller already collected, it
 *     assembles one `RunReport` object. It does not capture anything itself
 *     (no `browser.tabs.captureVisibleTab`, no console/network listeners) —
 *     that capture is background.ts's job; this function only shapes the
 *     result, the same separation `suite.ts` uses for `runOne`.
 *   - The runner is fail-fast (see runner-session.ts's STEP_FAIL -> 'error'):
 *     a failure stops the run, so `results` can be shorter than `steps`.
 *     Steps with no matching result are reported as 'skipped', not silently
 *     dropped — a PO/QA reading the report must be able to see which steps
 *     never ran.
 *   - `passed` is true only if every step has a result AND every result
 *     passed — a short results array (incomplete run) counts as not passed,
 *     even if nothing actually failed.
 *   - `screenshotOnFailure` is only kept on a failed report — a screenshot
 *     passed in alongside a passing run is dropped, since "on failure" is
 *     the whole point of capturing it.
 *   - `consoleErrors`/`networkErrors` default to empty arrays when the
 *     caller didn't collect any, never `undefined` — the report UI (T4.2)
 *     shouldn't need to null-check these lists.
 */

function step(overrides: Partial<Step> & { id: string; action: Step['action'] }): Step {
  return overrides as Step;
}

function result(overrides?: Partial<StepResult>): StepResult {
  return {
    stepId: 's1',
    passed: true,
    attempts: 1,
    durationMs: 50,
    ...overrides,
  };
}

const clickStep = (id: string): Step =>
  step({ id, action: 'click', selector: { strategy: 'css', value: `#${id}` } });

describe('buildRunReport', () => {
  it('marks the report passed when every step has a passing result', () => {
    const steps = [clickStep('s1'), clickStep('s2')];
    const results = [result({ stepId: 's1' }), result({ stepId: 's2' })];

    const report = buildRunReport({
      scenarioName: 'Checkout',
      steps,
      results,
      startedAt: 1000,
      finishedAt: 1500,
    });

    expect(report.passed).toBe(true);
    expect(report.scenarioName).toBe('Checkout');
    expect(report.startedAt).toBe(1000);
    expect(report.finishedAt).toBe(1500);
    expect(report.durationMs).toBe(500);
    expect(report.steps).toEqual([
      { stepId: 's1', action: 'click', status: 'passed', attempts: 1, durationMs: 50 },
      { stepId: 's2', action: 'click', status: 'passed', attempts: 1, durationMs: 50 },
    ]);
  });

  it('marks steps after a failure as skipped, and the report as not passed', () => {
    const steps = [clickStep('s1'), clickStep('s2'), clickStep('s3')];
    const results = [
      result({ stepId: 's1', passed: true }),
      result({ stepId: 's2', passed: false, error: 'Element not found: #s2', attempts: 3 }),
    ];

    const report = buildRunReport({
      scenarioName: 'Checkout',
      steps,
      results,
      startedAt: 1000,
      finishedAt: 1200,
    });

    expect(report.passed).toBe(false);
    expect(report.steps).toEqual([
      { stepId: 's1', action: 'click', status: 'passed', attempts: 1, durationMs: 50 },
      {
        stepId: 's2',
        action: 'click',
        status: 'failed',
        error: 'Element not found: #s2',
        attempts: 3,
        durationMs: 50,
      },
      { stepId: 's3', action: 'click', status: 'skipped' },
    ]);
  });

  it('treats a zero-step scenario as passed with an empty step list', () => {
    const report = buildRunReport({
      scenarioName: 'Empty',
      steps: [],
      results: [],
      startedAt: 1000,
      finishedAt: 1000,
    });

    expect(report.passed).toBe(true);
    expect(report.steps).toEqual([]);
    expect(report.durationMs).toBe(0);
  });

  it('keeps a screenshot only when the report failed', () => {
    const failing = buildRunReport({
      scenarioName: 'Checkout',
      steps: [clickStep('s1')],
      results: [result({ stepId: 's1', passed: false, error: 'boom' })],
      startedAt: 0,
      finishedAt: 100,
      screenshotOnFailure: 'data:image/png;base64,AAAA',
    });
    expect(failing.screenshotOnFailure).toBe('data:image/png;base64,AAAA');

    const passing = buildRunReport({
      scenarioName: 'Checkout',
      steps: [clickStep('s1')],
      results: [result({ stepId: 's1', passed: true })],
      startedAt: 0,
      finishedAt: 100,
      screenshotOnFailure: 'data:image/png;base64,AAAA',
    });
    expect(passing.screenshotOnFailure).toBeUndefined();
  });

  it('defaults consoleErrors/networkErrors to empty arrays, never undefined', () => {
    const report = buildRunReport({
      scenarioName: 'Checkout',
      steps: [clickStep('s1')],
      results: [result({ stepId: 's1' })],
      startedAt: 0,
      finishedAt: 10,
    });

    expect(report.consoleErrors).toEqual([]);
    expect(report.networkErrors).toEqual([]);
  });

  it('passes through caller-collected consoleErrors/networkErrors untouched', () => {
    const report = buildRunReport({
      scenarioName: 'Checkout',
      steps: [clickStep('s1')],
      results: [result({ stepId: 's1' })],
      startedAt: 0,
      finishedAt: 10,
      consoleErrors: ['TypeError: x is not a function'],
      networkErrors: ['GET /api/cart 500'],
    });

    expect(report.consoleErrors).toEqual(['TypeError: x is not a function']);
    expect(report.networkErrors).toEqual(['GET /api/cart 500']);
  });
});
