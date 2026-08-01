import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Login Test')).toBe('login-test');
  });

  it('collapses runs of non-alphanumeric characters into one hyphen', () => {
    expect(slugify('Sign Up -- Full Flow!!')).toBe('sign-up-full-flow');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --Checkout--  ')).toBe('checkout');
  });

  it('handles unicode/non-ASCII names without crashing', () => {
    expect(slugify('登録テスト')).toBe('scenario');
  });

  it('falls back to "scenario" when nothing alphanumeric survives', () => {
    expect(slugify('!!!')).toBe('scenario');
    expect(slugify('')).toBe('scenario');
  });

  it('is idempotent — slugifying an already-valid slug returns it unchanged', () => {
    expect(slugify('already-a-slug')).toBe('already-a-slug');
  });
});
