import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { clearRun, getRun, resetCache, saveRun } from './store';

beforeEach(() => {
  fakeBrowser.reset();
  resetCache();
});

describe('runner store', () => {
  it('returns an idle, empty run for an unknown tab', async () => {
    const run = await getRun(42);
    expect(run).toEqual({
      session: { status: 'idle', currentStepIndex: 0, totalSteps: 0 },
      scenario: null,
      results: [],
    });
  });

  it('persists runner state across a cache reset', async () => {
    const run = await getRun(7);
    run.session = {
      status: 'playing',
      currentStepIndex: 1,
      totalSteps: 3,
    };
    run.results.push({
      stepId: 'step-1',
      passed: true,
      attempts: 1,
      durationMs: 200,
    });
    await saveRun(7, run);

    resetCache();

    const revived = await getRun(7);
    expect(revived.session.status).toBe('playing');
    expect(revived.results).toHaveLength(1);
    expect(revived.results[0].stepId).toBe('step-1');
  });

  it('isolates runs per tab', async () => {
    const a = await getRun(1);
    a.session = { status: 'playing', currentStepIndex: 0, totalSteps: 2 };
    await saveRun(1, a);

    const b = await getRun(2);
    expect(b.session.status).toBe('idle');
  });

  it('clears a run when its tab closes', async () => {
    const run = await getRun(9);
    run.session = { status: 'playing', currentStepIndex: 0, totalSteps: 2 };
    await saveRun(9, run);

    await clearRun(9);
    resetCache();

    const afterClose = await getRun(9);
    expect(afterClose.session.status).toBe('idle');
    expect(afterClose.results).toHaveLength(0);
  });

  it('shares one in-flight load between concurrent readers of the same tab', async () => {
    const [first, second] = await Promise.all([getRun(3), getRun(3)]);
    expect(first).toBe(second);
  });
});
