// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  escapeAttrValue,
  matchGlob,
  queryElement,
  queryElements,
  sameFramePath,
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
