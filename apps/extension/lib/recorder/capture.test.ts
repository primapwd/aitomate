// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildClickStep,
  buildFillStep,
  buildKeypressStep,
  buildNavigateStep,
  buildUploadStep,
  captureNavigation,
  isFileInput,
  isValueControl,
  valueOfControl,
} from './capture';
import type { RecorderSessionState } from './session';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('step builders', () => {
  it('builds a click step from a selector', () => {
    expect(buildClickStep({ strategy: 'testid', value: 'submit' })).toEqual({
      action: 'click',
      selector: { strategy: 'testid', value: 'submit' },
    });
  });

  it('builds a fill step wrapping the value in a static resolver', () => {
    expect(buildFillStep({ strategy: 'id', value: 'email' }, 'a@b.com')).toEqual({
      action: 'fill',
      selector: { strategy: 'id', value: 'email' },
      resolver: { type: 'static', value: 'a@b.com' },
    });
  });

  it('builds a keypress step', () => {
    expect(buildKeypressStep('Enter', { strategy: 'id', value: 'search' })).toEqual({
      action: 'keypress',
      key: 'Enter',
      selector: { strategy: 'id', value: 'search' },
    });
  });

  it('builds a navigate step', () => {
    expect(buildNavigateStep('/checkout')).toEqual({ action: 'navigate', url: '/checkout' });
  });

  it('builds an upload step with fixture ref', () => {
    expect(
      buildUploadStep({ strategy: 'testid', value: 'avatar' }, 'images/sample.png'),
    ).toEqual({
      action: 'upload',
      selector: { strategy: 'testid', value: 'avatar' },
      fixtureRef: 'images/sample.png',
    });
  });
});

describe('isValueControl', () => {
  it('is true for input/textarea/select', () => {
    document.body.innerHTML = `<input /><textarea></textarea><select></select><button></button>`;
    expect(isValueControl(document.querySelector('input')!)).toBe(true);
    expect(isValueControl(document.querySelector('textarea')!)).toBe(true);
    expect(isValueControl(document.querySelector('select')!)).toBe(true);
    expect(isValueControl(document.querySelector('button')!)).toBe(false);
  });

  it('is false for button-like inputs, so their clicks record as clicks', () => {
    document.body.innerHTML = `
      <input type="submit" />
      <input type="button" />
      <input type="reset" />
      <input type="image" />
      <input type="SUBMIT" />
    `;
    for (const el of document.querySelectorAll('input')) {
      expect(isValueControl(el)).toBe(false);
    }
  });

  it('is false for file inputs (they become upload steps, not fill)', () => {
    document.body.innerHTML = `<input type="file" />`;
    expect(isValueControl(document.querySelector('input')!)).toBe(false);
  });
});

describe('isFileInput', () => {
  it('is true for input[type=file]', () => {
    document.body.innerHTML = `<input type="file" />`;
    expect(isFileInput(document.querySelector('input')!)).toBe(true);
  });

  it('is false for other elements', () => {
    document.body.innerHTML = `<input type="text" /><textarea></textarea><select></select>`;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      expect(isFileInput(el)).toBe(false);
    }
  });
});

describe('valueOfControl', () => {
  it('reads .checked for checkboxes and radios', () => {
    document.body.innerHTML = `<input type="checkbox" checked /><input type="radio" />`;
    const [checkbox, radio] = document.querySelectorAll('input');
    expect(valueOfControl(checkbox)).toBe(true);
    expect(valueOfControl(radio)).toBe(false);
  });

  it('reads .value for text inputs, textareas, and selects', () => {
    document.body.innerHTML = `
      <input type="text" value="hi" />
      <textarea>notes</textarea>
      <select><option value="a" selected>a</option></select>
    `;
    expect(valueOfControl(document.querySelector('input')!)).toBe('hi');
    expect(valueOfControl(document.querySelector('textarea')!)).toBe('notes');
    expect(valueOfControl(document.querySelector('select')!)).toBe('a');
  });
});

/**
 * T2.13: `captureNavigation` replaces the inline session-reduce + step-push
 * logic that currently lives in `entrypoints/background.ts`'s
 * `webNavigation.onCommitted` handler (a Common-Mistakes violation — decision
 * logic in an entrypoint instead of `lib/` with a test). It combines
 * `reduceSession` (session.ts, already tested on its own) with
 * `buildNavigateStep` (already tested above) and decides whether a step
 * should be appended, in one pure call background.ts can use as-is:
 *
 *   const { session, step } = captureNavigation(recording.session, details.url);
 *   recording.session = session;
 *   if (step) recording.steps.push({ id: nextStepId(recording), ...step });
 */
describe('captureNavigation', () => {
  const recording: RecorderSessionState = { status: 'recording', originUrl: 'https://a.test/' };
  const idle: RecorderSessionState = { status: 'idle' };
  const paused: RecorderSessionState = {
    status: 'paused',
    originUrl: 'https://a.test/',
    pauseReason: 'origin-change',
  };

  it('returns no step when not currently recording', () => {
    const result = captureNavigation(idle, 'https://a.test/next');
    expect(result.step).toBeNull();
    expect(result.session).toEqual(idle);
  });

  it('returns no step when already paused', () => {
    const result = captureNavigation(paused, 'https://b.test/');
    expect(result.step).toBeNull();
    expect(result.session).toEqual(paused);
  });

  it('appends a navigate step for a same-origin URL change while recording', () => {
    const result = captureNavigation(recording, 'https://a.test/checkout');
    expect(result.step).toEqual(buildNavigateStep('https://a.test/checkout'));
    expect(result.session).toEqual({ status: 'recording', originUrl: 'https://a.test/checkout' });
  });

  it('returns no step for a no-op navigation to the same URL', () => {
    const result = captureNavigation(recording, 'https://a.test/');
    expect(result.step).toBeNull();
    expect(result.session).toEqual(recording);
  });

  it('records the return trip in an A -> B -> A same-origin sequence', () => {
    const toB = captureNavigation(recording, 'https://a.test/b');
    expect(toB.step).toEqual(buildNavigateStep('https://a.test/b'));

    const backToA = captureNavigation(toB.session, 'https://a.test/');
    expect(backToA.step).toEqual(buildNavigateStep('https://a.test/'));
  });

  it('pauses on cross-origin navigation and returns no step for the boundary-crossing nav itself', () => {
    const result = captureNavigation(recording, 'https://evil.test/');
    expect(result.step).toBeNull();
    expect(result.session).toEqual({
      status: 'paused',
      originUrl: 'https://a.test/',
      pauseReason: 'origin-change',
    });
  });
});
