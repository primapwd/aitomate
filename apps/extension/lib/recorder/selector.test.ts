// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { generateSelector, computeShadowPath, simpleSelectorString } from './selector';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('generateSelector', () => {
  it('prefers data-testid over everything else', () => {
    document.body.innerHTML = `<button id="save" aria-label="Save" data-testid="save-btn">Save</button>`;
    const el = document.querySelector('button')!;
    expect(generateSelector(el)).toEqual({ strategy: 'testid', value: 'save-btn' });
  });

  it('falls back to id when unique and no testid', () => {
    document.body.innerHTML = `<input id="email" aria-label="Email" />`;
    const el = document.querySelector('input')!;
    expect(generateSelector(el)).toEqual({ strategy: 'id', value: 'email' });
  });

  it('skips a duplicated id and falls back to aria-label', () => {
    document.body.innerHTML = `
      <input id="dup" aria-label="First" />
      <input id="dup" aria-label="Second" />
    `;
    const [, second] = document.querySelectorAll('input');
    expect(generateSelector(second)).toEqual({ strategy: 'aria', value: 'Second' });
  });

  it('falls back to a structural css path when nothing else is unique', () => {
    document.body.innerHTML = `
      <div class="row"><span>a</span><span>b</span></div>
    `;
    const spans = document.querySelectorAll('span');
    const selector = generateSelector(spans[1]);
    expect(selector.strategy).toBe('css');
    expect(selector.value).toContain('nth-of-type(2)');
  });

  it('produces a css path unique enough to resolve back to the same element', () => {
    document.body.innerHTML = `
      <ul>
        <li><button>x</button></li>
        <li><button>x</button></li>
        <li><button>x</button></li>
      </ul>
    `;
    const buttons = document.querySelectorAll('button');
    const target = buttons[2];
    const selector = generateSelector(target);
    expect(selector.strategy).toBe('css');
    const matches = document.querySelectorAll(selector.value);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(target);
  });

  it('captures an open shadow root as shadowPath', () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const host = document.querySelector('#host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<button data-testid="inner-btn">Click</button>`;
    const inner = shadow.querySelector('button')!;

    const selector = generateSelector(inner);
    expect(selector.strategy).toBe('testid');
    expect(selector.value).toBe('inner-btn');
    expect(selector.shadowPath).toEqual(['#host']);
  });

  it('walks nested shadow roots outer-to-inner', () => {
    document.body.innerHTML = `<div id="outer-host"></div>`;
    const outerHost = document.querySelector('#outer-host')!;
    const outerShadow = outerHost.attachShadow({ mode: 'open' });
    outerShadow.innerHTML = `<div id="inner-host"></div>`;
    const innerHost = outerShadow.querySelector('#inner-host')!;
    const innerShadow = innerHost.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = `<button id="deep">go</button>`;
    const deepButton = innerShadow.querySelector('#deep')!;

    expect(computeShadowPath(deepButton)).toEqual(['#outer-host', '#inner-host']);
  });
});

describe('simpleSelectorString', () => {
  it('prefers testid, then unique id, then a css path', () => {
    document.body.innerHTML = `
      <div data-testid="widget"></div>
      <div id="panel"></div>
      <section><span>x</span></section>
    `;
    expect(simpleSelectorString(document.querySelector('[data-testid="widget"]')!)).toBe(
      '[data-testid="widget"]',
    );
    expect(simpleSelectorString(document.querySelector('#panel')!)).toBe('#panel');
    expect(simpleSelectorString(document.querySelector('span')!)).toContain('span');
  });
});
