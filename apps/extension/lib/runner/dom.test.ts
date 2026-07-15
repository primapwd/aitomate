// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  escapeAttrValue,
  isTruthyValue,
  matchGlob,
  queryElement,
  queryElements,
  sameFramePath,
  setNativeChecked,
  setNativeValue,
  stepSelector,
  waitForAssertion,
} from './dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('queryElement', () => {
  it('resolves each selector strategy', () => {
    document.body.innerHTML = `
      <button data-testid="save-btn">Save</button>
      <input id="email" />
      <button aria-label="Close dialog">x</button>
      <div class="row"><span>a</span><span>b</span></div>
      <p>Exact text</p>
    `;
    expect(queryElement({ strategy: 'testid', value: 'save-btn' })?.textContent).toBe('Save');
    expect(queryElement({ strategy: 'id', value: 'email' })).toBeInstanceOf(HTMLInputElement);
    expect(queryElement({ strategy: 'aria', value: 'Close dialog' })?.textContent).toBe('x');
    expect(
      queryElement({ strategy: 'css', value: 'div.row > span:nth-of-type(2)' })?.textContent,
    ).toBe('b');
    expect(queryElement({ strategy: 'text', value: 'Exact text' })?.tagName).toBe('P');
  });

  it('returns null when nothing matches', () => {
    expect(queryElement({ strategy: 'testid', value: 'missing' })).toBeNull();
    expect(queryElement({ strategy: 'text', value: 'missing' })).toBeNull();
  });

  // happy-dom's selector parser rejects escaped quotes/backslashes that real
  // browsers accept, so the escaping is asserted directly instead of via
  // querySelector.
  it('escapes quotes and backslashes for attribute selectors', () => {
    expect(escapeAttrValue('has"quote')).toBe('has\\"quote');
    expect(escapeAttrValue('has\\backslash')).toBe('has\\\\backslash');
    expect(escapeAttrValue('a\\"b')).toBe('a\\\\\\"b');
  });

  it('descends through shadowPath', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button data-testid="inner">go</button>';
    expect(
      queryElement({ strategy: 'testid', value: 'inner', shadowPath: ['#host'] })?.textContent,
    ).toBe('go');
    expect(
      queryElement({ strategy: 'testid', value: 'inner', shadowPath: ['#absent'] }),
    ).toBeNull();
  });
});

describe('queryElements', () => {
  it('honors the selector strategy, not just raw CSS', () => {
    document.body.innerHTML = `
      <li data-testid="row"></li>
      <li data-testid="row"></li>
      <li data-testid="other"></li>
    `;
    expect(queryElements({ strategy: 'testid', value: 'row' })).toHaveLength(2);
    expect(queryElements({ strategy: 'css', value: 'li' })).toHaveLength(3);
    expect(queryElements({ strategy: 'testid', value: 'none' })).toHaveLength(0);
  });
});

describe('matchGlob', () => {
  it('matches ** across path segments', () => {
    expect(matchGlob('https://app.test/a/b/c', 'https://app.test/**')).toBe(true);
    expect(matchGlob('https://app.test/orders/9/edit', '**/orders/**')).toBe(true);
  });

  it('matches * within a single segment only', () => {
    expect(matchGlob('https://app.test/orders', 'https://app.test/*')).toBe(true);
    expect(matchGlob('https://app.test/orders/9', 'https://app.test/*')).toBe(false);
  });

  it('matches ? as a single non-slash character', () => {
    expect(matchGlob('https://app.test/p1', 'https://app.test/p?')).toBe(true);
    expect(matchGlob('https://app.test/p12', 'https://app.test/p?')).toBe(false);
  });

  it('treats regex metacharacters as literals', () => {
    expect(matchGlob('https://app.test/a.b', 'https://app.test/a.b')).toBe(true);
    expect(matchGlob('https://app.test/aXb', 'https://app.test/a.b')).toBe(false);
  });
});

describe('setNativeValue', () => {
  it('sets the value and dispatches input + change events', () => {
    document.body.innerHTML = '<input id="t" />';
    const input = document.getElementById('t') as HTMLInputElement;

    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    input.addEventListener('input', inputSpy);
    input.addEventListener('change', changeSpy);

    setNativeValue(input, 'new-val');

    expect(input.value).toBe('new-val');
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });

  it('works on textarea and select too', () => {
    document.body.innerHTML =
      '<textarea id="ta"></textarea><select id="sel"><option>a</option><option>b</option></select>';
    const ta = document.getElementById('ta') as HTMLTextAreaElement;
    const sel = document.getElementById('sel') as HTMLSelectElement;

    setNativeValue(ta, 'notes');
    expect(ta.value).toBe('notes');

    setNativeValue(sel, 'b');
    expect(sel.value).toBe('b');
  });
});

describe('isTruthyValue', () => {
  it('maps resolved values to a checked state', () => {
    expect(isTruthyValue(true)).toBe(true);
    expect(isTruthyValue(false)).toBe(false);
    expect(isTruthyValue('true')).toBe(true);
    expect(isTruthyValue('false')).toBe(false);
    expect(isTruthyValue('on')).toBe(true);
    expect(isTruthyValue('off')).toBe(false);
    expect(isTruthyValue('0')).toBe(false);
    expect(isTruthyValue(1)).toBe(true);
    expect(isTruthyValue(0)).toBe(false);
    expect(isTruthyValue('')).toBe(false);
  });
});

describe('setNativeChecked', () => {
  it('toggles a checkbox via click and fires change', () => {
    document.body.innerHTML = '<input id="cb" type="checkbox" />';
    const cb = document.getElementById('cb') as HTMLInputElement;
    const changeSpy = vi.fn();
    cb.addEventListener('change', changeSpy);

    setNativeChecked(cb, true);
    expect(cb.checked).toBe(true);
    expect(changeSpy).toHaveBeenCalledTimes(1);

    setNativeChecked(cb, true); // already checked — no extra click
    expect(changeSpy).toHaveBeenCalledTimes(1);

    setNativeChecked(cb, false);
    expect(cb.checked).toBe(false);
  });

  it('never clicks a radio to uncheck it', () => {
    document.body.innerHTML = '<input id="r" type="radio" checked />';
    const r = document.getElementById('r') as HTMLInputElement;
    setNativeChecked(r, false);
    expect(r.checked).toBe(true); // unchanged — radios cannot be unchecked
  });
});

describe('waitForAssertion', () => {
  it('resolves true immediately when the predicate passes', async () => {
    await expect(waitForAssertion(() => true, 1000)).resolves.toBe(true);
  });

  it('polls until the predicate flips to true', async () => {
    let pass = false;
    setTimeout(() => {
      pass = true;
    }, 120);
    await expect(waitForAssertion(() => pass, 2000)).resolves.toBe(true);
  });

  it('evaluates the predicate one final time at the deadline', async () => {
    let calls = 0;
    const ok = await waitForAssertion(() => {
      calls += 1;
      return false;
    }, 0);
    expect(ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('supports async predicates', async () => {
    await expect(waitForAssertion(async () => true, 1000)).resolves.toBe(true);
  });
});

describe('sameFramePath', () => {
  it('treats undefined and empty as the top frame', () => {
    expect(sameFramePath(undefined, undefined)).toBe(true);
    expect(sameFramePath([], undefined)).toBe(true);
    expect(sameFramePath(undefined, [])).toBe(true);
  });

  it('compares paths segment by segment', () => {
    expect(sameFramePath(['#frame-a'], ['#frame-a'])).toBe(true);
    expect(sameFramePath(['#frame-a'], ['#frame-b'])).toBe(false);
    expect(sameFramePath(['#frame-a'], undefined)).toBe(false);
    expect(sameFramePath(['#a', '#b'], ['#a'])).toBe(false);
  });
});

describe('stepSelector', () => {
  const sel = { strategy: 'css', value: '#x' } as const;

  it('returns the selector for click/fill/upload/keypress', () => {
    expect(stepSelector({ id: '1', action: 'click', selector: sel })).toBe(sel);
    expect(
      stepSelector({ id: '1', action: 'fill', selector: sel, resolver: { type: 'static', value: 'v' } }),
    ).toBe(sel);
    expect(stepSelector({ id: '1', action: 'upload', selector: sel, fixtureRef: 'f.txt' })).toBe(sel);
    expect(stepSelector({ id: '1', action: 'keypress', key: 'Enter', selector: sel })).toBe(sel);
  });

  it('returns forSelector for wait steps', () => {
    expect(stepSelector({ id: '1', action: 'wait', forSelector: sel })).toBe(sel);
    expect(stepSelector({ id: '1', action: 'wait', durationMs: 1000 })).toBeUndefined();
  });

  it('returns the selector for selector-based assertions, undefined otherwise', () => {
    expect(
      stepSelector({ id: '1', action: 'assert', assertion: 'elementVisible', selector: sel }),
    ).toBe(sel);
    expect(
      stepSelector({
        id: '1',
        action: 'assert',
        assertion: 'urlMatches',
        pattern: '**/done',
        patternType: 'glob',
      }),
    ).toBeUndefined();
  });

  it('returns undefined for navigate steps', () => {
    expect(stepSelector({ id: '1', action: 'navigate', url: '/x' })).toBeUndefined();
  });
});
