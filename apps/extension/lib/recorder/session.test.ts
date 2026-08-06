import { describe, expect, it } from 'vitest';
import { initialSessionState, reduceSession } from './session';

describe('reduceSession', () => {
  it('starts recording with the given origin url', () => {
    const state = reduceSession(initialSessionState, {
      type: 'START',
      originUrl: 'https://app.test/checkout',
    });
    expect(state).toEqual({
      status: 'recording',
      originUrl: 'https://app.test/checkout',
      generation: 1,
    });
  });

  it('stays recording on a same-origin navigation, rebasing to the new url', () => {
    const recording = reduceSession(initialSessionState, {
      type: 'START',
      originUrl: 'https://app.test/checkout',
    });
    const state = reduceSession(recording, { type: 'NAVIGATE', url: 'https://app.test/cart' });
    expect(state.status).toBe('recording');
    expect(state.originUrl).toBe('https://app.test/cart');
    // A -> B -> A: the caller diffs consecutive urls, so the return trip
    // must still look like a change.
    const back = reduceSession(state, { type: 'NAVIGATE', url: 'https://app.test/checkout' });
    expect(back.originUrl).toBe('https://app.test/checkout');
  });

  it('pauses on a cross-origin navigation', () => {
    const recording = reduceSession(initialSessionState, {
      type: 'START',
      originUrl: 'https://app.test/checkout',
    });
    const state = reduceSession(recording, {
      type: 'NAVIGATE',
      url: 'https://accounts.example.com/oauth',
    });
    expect(state).toEqual({
      status: 'paused',
      originUrl: 'https://app.test/checkout',
      pauseReason: 'origin-change',
      generation: 1,
    });
  });

  it('pauses when a new tab opens while recording', () => {
    const recording = reduceSession(initialSessionState, {
      type: 'START',
      originUrl: 'https://app.test/checkout',
    });
    const state = reduceSession(recording, { type: 'NEW_TAB_OPENED' });
    expect(state.status).toBe('paused');
    expect(state.pauseReason).toBe('new-tab');
  });

  it('ignores NAVIGATE/NEW_TAB_OPENED when idle or already paused', () => {
    expect(reduceSession(initialSessionState, { type: 'NEW_TAB_OPENED' })).toBe(
      initialSessionState,
    );
    const paused = reduceSession(
      reduceSession(initialSessionState, { type: 'START', originUrl: 'https://app.test' }),
      { type: 'NEW_TAB_OPENED' },
    );
    expect(reduceSession(paused, { type: 'NEW_TAB_OPENED' })).toBe(paused);
  });

  it('resumes recording, optionally rebasing the origin url', () => {
    const paused = reduceSession(
      reduceSession(initialSessionState, { type: 'START', originUrl: 'https://app.test' }),
      { type: 'NEW_TAB_OPENED' },
    );
    const resumed = reduceSession(paused, {
      type: 'RESUME',
      originUrl: 'https://app.test/next',
    });
    expect(resumed).toEqual({
      status: 'recording',
      originUrl: 'https://app.test/next',
      generation: 1,
    });
  });

  it('stops recording and resets to idle, keeping the same generation', () => {
    const recording = reduceSession(initialSessionState, {
      type: 'START',
      originUrl: 'https://app.test',
    });
    expect(reduceSession(recording, { type: 'STOP' })).toEqual({
      status: 'idle',
      originUrl: 'https://app.test',
      generation: 1,
    });
  });

  it('bumps generation on every START, so a stale in-flight step from a prior session can be told apart', () => {
    const first = reduceSession(initialSessionState, { type: 'START', originUrl: 'https://a' });
    const stopped = reduceSession(first, { type: 'STOP' });
    const second = reduceSession(stopped, { type: 'START', originUrl: 'https://a' });
    expect(second.generation).toBe(2);
  });
});
