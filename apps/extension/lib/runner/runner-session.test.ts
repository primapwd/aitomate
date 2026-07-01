import { describe, expect, it } from 'vitest';
import { initialRunnerState, reduceRunnerState } from './runner-session';

describe('reduceRunnerState', () => {
  it('PLAY transitions idle → playing with step count', () => {
    const state = reduceRunnerState(initialRunnerState, {
      type: 'PLAY',
      totalSteps: 5,
    });
    expect(state).toEqual({
      status: 'playing',
      currentStepIndex: 0,
      totalSteps: 5,
    });
  });

  it('PLAY with zero steps completes immediately', () => {
    const state = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 0 });
    expect(state.status).toBe('done');
  });

  it('STEP_COMPLETE advances the index, stays playing if more steps remain', () => {
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 });
    const after = reduceRunnerState(playing, { type: 'STEP_COMPLETE' });
    expect(after.status).toBe('playing');
    expect(after.currentStepIndex).toBe(1);
  });

  it('STEP_COMPLETE on the last step transitions to done', () => {
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 2 });
    const step1 = reduceRunnerState(playing, { type: 'STEP_COMPLETE' });
    const step2 = reduceRunnerState(step1, { type: 'STEP_COMPLETE' });
    expect(step2.status).toBe('done');
    expect(step2.currentStepIndex).toBe(2);
  });

  it('STEP_FAIL transitions playing → error with the error message', () => {
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 });
    const state = reduceRunnerState(playing, { type: 'STEP_FAIL', error: 'Element not found' });
    expect(state).toEqual({
      status: 'error',
      currentStepIndex: 0,
      totalSteps: 3,
      error: 'Element not found',
    });
  });

  it('STEP_FAIL is a no-op when not playing', () => {
    expect(
      reduceRunnerState(initialRunnerState, { type: 'STEP_FAIL', error: 'nope' }),
    ).toBe(initialRunnerState);
    const done = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 1 }),
      { type: 'STEP_COMPLETE' },
    );
    expect(done.status).toBe('done');
    expect(reduceRunnerState(done, { type: 'STEP_FAIL', error: 'nope' })).toBe(done);
  });

  it('PAUSE transitions playing → paused', () => {
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 });
    expect(reduceRunnerState(playing, { type: 'PAUSE' }).status).toBe('paused');
  });

  it('PAUSE is a no-op when not playing', () => {
    expect(reduceRunnerState(initialRunnerState, { type: 'PAUSE' })).toBe(initialRunnerState);
    const paused = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 }),
      { type: 'PAUSE' },
    );
    expect(paused.status).toBe('paused');
    expect(reduceRunnerState(paused, { type: 'PAUSE' })).toBe(paused);
  });

  it('RESUME transitions paused → playing', () => {
    const paused = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 }),
      { type: 'PAUSE' },
    );
    expect(reduceRunnerState(paused, { type: 'RESUME' }).status).toBe('playing');
  });

  it('RESUME is a no-op when not paused', () => {
    expect(reduceRunnerState(initialRunnerState, { type: 'RESUME' })).toBe(initialRunnerState);
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 });
    expect(reduceRunnerState(playing, { type: 'RESUME' })).toBe(playing);
  });

  it('STOP resets playing → idle, preserving nothing', () => {
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 });
    expect(reduceRunnerState(playing, { type: 'STOP' })).toEqual(initialRunnerState);
  });

  it('STOP resets paused → idle', () => {
    const paused = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 }),
      { type: 'PAUSE' },
    );
    expect(reduceRunnerState(paused, { type: 'STOP' })).toEqual(initialRunnerState);
  });

  it('STOP resets error → idle', () => {
    const errored = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 }),
      { type: 'STEP_FAIL', error: 'fail' },
    );
    expect(reduceRunnerState(errored, { type: 'STOP' })).toEqual(initialRunnerState);
  });

  it('STOP is a no-op when idle or done', () => {
    expect(reduceRunnerState(initialRunnerState, { type: 'STOP' })).toBe(initialRunnerState);
    const done = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 1 }),
      { type: 'STEP_COMPLETE' },
    );
    expect(done.status).toBe('done');
    expect(reduceRunnerState(done, { type: 'STOP' })).toBe(done);
  });

  it('RESET transitions error → idle', () => {
    const errored = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 3 }),
      { type: 'STEP_FAIL', error: 'fail' },
    );
    expect(reduceRunnerState(errored, { type: 'RESET' })).toEqual(initialRunnerState);
  });

  it('RESET transitions done → idle', () => {
    const done = reduceRunnerState(
      reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 1 }),
      { type: 'STEP_COMPLETE' },
    );
    expect(done.status).toBe('done');
    expect(reduceRunnerState(done, { type: 'RESET' })).toEqual(initialRunnerState);
  });

  it('RESET is a no-op when playing or idle', () => {
    expect(reduceRunnerState(initialRunnerState, { type: 'RESET' })).toBe(initialRunnerState);
    const playing = reduceRunnerState(initialRunnerState, { type: 'PLAY', totalSteps: 2 });
    expect(reduceRunnerState(playing, { type: 'RESET' })).toBe(playing);
  });
});
