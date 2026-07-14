import { describe, expect, it, vi } from 'vitest';
import type { StepResult } from './messages';
import { runSuite, type ScenarioRunner, type SuiteScenarioRef } from './suite';

/**
 * T2.10 (Run view "Run suite") — TDD contract, written before the
 * implementation exists. `runSuite` must be created in `./suite.ts` to make
 * these pass; nothing in this file should need to change to accommodate the
 * implementation.
 *
 * Design intent (see AGENTS.md T2.8/T2.9 precedent — decision logic belongs
 * in lib/ with a test, not inline in background.ts):
 *   - `runSuite` is pure orchestration: given an ordered list of scenario
 *     refs and an injected `runOne` callback (the real callback will wrap
 *     background.ts's per-scenario `runSequence`, the same way
 *     `chaining.ts`'s `SetupLookup` wraps `findScenarioByName`), it runs
 *     them sequentially and aggregates a report. It must never reach into
 *     `browser.storage` or know how a scenario is actually executed.
 *   - Sequential, not parallel — MV3 has one active tab driving playback.
 *   - A scenario run stays isolated: one throwing/crashing scenario must not
 *     abort the whole suite, and must not corrupt the report of scenarios
 *     around it.
 *   - Default behavior continues through failures so the report reflects the
 *     whole suite (per FR-5 "suite (sequential)" + run-report intent); an
 *     opt-in `stopOnFirstFailure` option covers the "fail fast" case.
 *   - A cooperative stop signal (same `{ stopped: () => boolean }` shape
 *     used elsewhere in lib/runner) is checked *between* scenarios only —
 *     stopping mid-scenario is the injected runner's own responsibility,
 *     same separation of concerns as chaining.ts's `RunSignal`.
 */

function ref(id: string, name: string): SuiteScenarioRef {
  return { id, name };
}

function stepResult(overrides?: Partial<StepResult>): StepResult {
  return {
    stepId: 's1',
    passed: true,
    attempts: 1,
    durationMs: 10,
    ...overrides,
  };
}

const neverStopped = { stopped: () => false };

describe('runSuite', () => {
  it('runs an empty scenario list without calling the runner, reporting a vacuous pass', async () => {
    const runOne: ScenarioRunner = vi.fn();
    const report = await runSuite([], runOne, neverStopped);
    expect(report.scenarios).toEqual([]);
    expect(report.passed).toBe(true);
    expect(runOne).not.toHaveBeenCalled();
  });

  it('runs every scenario in order and marks the suite passed when all pass', async () => {
    const calls: string[] = [];
    const runOne: ScenarioRunner = vi.fn(async (r) => {
      calls.push(r.id);
      return { passed: true, results: [stepResult()] };
    });
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post'), ref('c', 'Logout')];

    const report = await runSuite(scenarios, runOne, neverStopped);

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(report.passed).toBe(true);
    expect(report.scenarios).toHaveLength(3);
    expect(report.scenarios.map((s) => s.status)).toEqual(['passed', 'passed', 'passed']);
    expect(report.scenarios.map((s) => s.name)).toEqual(['Login', 'Create Post', 'Logout']);
  });

  it('marks the suite failed when any scenario fails, but still runs the rest by default', async () => {
    const runOne: ScenarioRunner = vi.fn(async (r) => {
      if (r.id === 'b') {
        return { passed: false, error: 'Element not found', results: [stepResult({ passed: false })] };
      }
      return { passed: true, results: [stepResult()] };
    });
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post'), ref('c', 'Logout')];

    const report = await runSuite(scenarios, runOne, neverStopped);

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(report.passed).toBe(false);
    expect(report.scenarios.map((s) => s.status)).toEqual(['passed', 'failed', 'passed']);
    expect(report.scenarios[1].error).toBe('Element not found');
  });

  it('propagates each scenario\'s step results into its report entry', async () => {
    const results: StepResult[] = [stepResult({ stepId: 's1' }), stepResult({ stepId: 's2' })];
    const runOne: ScenarioRunner = vi.fn(async () => ({ passed: true, results }));

    const report = await runSuite([ref('a', 'Login')], runOne, neverStopped);

    expect(report.scenarios[0].results).toEqual(results);
  });

  it('stops before starting the next scenario when the signal is already stopped, skipping the rest', async () => {
    const runOne: ScenarioRunner = vi.fn(async () => ({ passed: true, results: [] }));
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post')];

    const report = await runSuite(scenarios, runOne, { stopped: () => true });

    expect(runOne).not.toHaveBeenCalled();
    expect(report.scenarios.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(report.passed).toBe(false);
  });

  it('stops after the in-flight scenario finishes, marking remaining scenarios skipped', async () => {
    let stopAfterFirst = false;
    const runOne: ScenarioRunner = vi.fn(async (r) => {
      if (r.id === 'a') stopAfterFirst = true;
      return { passed: true, results: [] };
    });
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post'), ref('c', 'Logout')];

    const report = await runSuite(scenarios, runOne, { stopped: () => stopAfterFirst });

    expect(runOne).toHaveBeenCalledTimes(1);
    expect(report.scenarios.map((s) => s.status)).toEqual(['passed', 'skipped', 'skipped']);
    expect(report.passed).toBe(false);
  });

  it('does not let one crashing scenario abort the suite or corrupt neighboring results', async () => {
    const runOne: ScenarioRunner = vi.fn(async (r) => {
      if (r.id === 'b') throw new Error('background disconnected');
      return { passed: true, results: [stepResult()] };
    });
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post'), ref('c', 'Logout')];

    const report = await runSuite(scenarios, runOne, neverStopped);

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(report.passed).toBe(false);
    expect(report.scenarios.map((s) => s.status)).toEqual(['passed', 'failed', 'passed']);
    // Plain-language, not a raw stack trace (Constitution: fail loud, fail clear).
    expect(report.scenarios[1].error).toContain('Create Post');
    expect(report.scenarios[1].error).not.toContain('at ');
    expect(report.scenarios[1].results).toEqual([]);
  });

  it('supports stopOnFirstFailure: true, skipping everything after the first failure', async () => {
    const runOne: ScenarioRunner = vi.fn(async (r) => {
      if (r.id === 'a') return { passed: false, error: 'boom', results: [] };
      return { passed: true, results: [] };
    });
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post'), ref('c', 'Logout')];

    const report = await runSuite(scenarios, runOne, neverStopped, { stopOnFirstFailure: true });

    expect(runOne).toHaveBeenCalledTimes(1);
    expect(report.scenarios.map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped']);
    expect(report.passed).toBe(false);
  });

  it('defaults stopOnFirstFailure to false when the options argument is omitted', async () => {
    const runOne: ScenarioRunner = vi.fn(async (r) => ({
      passed: r.id !== 'a',
      results: [],
    }));
    const scenarios = [ref('a', 'Login'), ref('b', 'Create Post')];

    const report = await runSuite(scenarios, runOne, neverStopped);

    expect(runOne).toHaveBeenCalledTimes(2);
  });

  it('runs a single-scenario suite the same way as any other size', async () => {
    const runOne: ScenarioRunner = vi.fn(async () => ({ passed: true, results: [] }));
    const report = await runSuite([ref('a', 'Login')], runOne, neverStopped);
    expect(report.passed).toBe(true);
    expect(report.scenarios).toHaveLength(1);
  });

  it('treats two scenarios that share the same setup and re-run it as independent runOne calls (no suite-level setup memoization)', async () => {
    // Session-marker skip logic (FR-10) lives inside the per-scenario runner
    // (chaining.ts's runSetup, called from within runOne) — runSuite must
    // not attempt its own setup-dedup/caching, since that would duplicate
    // and could desync from the marker-based skip already covered by
    // chaining.test.ts.
    const runOne: ScenarioRunner = vi.fn(async () => ({ passed: true, results: [] }));
    const scenarios = [ref('a', 'Create Post as Student'), ref('b', 'Delete Post as Student')];

    await runSuite(scenarios, runOne, neverStopped);

    expect(runOne).toHaveBeenCalledTimes(2);
    expect(runOne).toHaveBeenNthCalledWith(1, scenarios[0]);
    expect(runOne).toHaveBeenNthCalledWith(2, scenarios[1]);
  });
});
