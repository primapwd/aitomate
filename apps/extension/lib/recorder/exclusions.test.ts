// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { isExcludedField } from './exclusions';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isExcludedField', () => {
  it('excludes type=hidden inputs', () => {
    document.body.innerHTML = `<input type="hidden" name="anything" />`;
    expect(isExcludedField(document.querySelector('input')!)).toBe(true);
  });

  it.each(['_token', 'csrf_token', 'authenticity_token', 'xsrf-token', 'csrfmiddlewaretoken'])(
    'excludes CSRF-named field %s',
    (name) => {
      document.body.innerHTML = `<input type="text" name="${name}" />`;
      expect(isExcludedField(document.querySelector('input')!)).toBe(true);
    },
  );

  it('does not exclude an ordinary visible text input', () => {
    document.body.innerHTML = `<input type="text" name="email" />`;
    expect(isExcludedField(document.querySelector('input')!)).toBe(false);
  });

  it('does not exclude non-input elements', () => {
    document.body.innerHTML = `<textarea name="_token"></textarea>`;
    expect(isExcludedField(document.querySelector('textarea')!)).toBe(false);
  });
});
