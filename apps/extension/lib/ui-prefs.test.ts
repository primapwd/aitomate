import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getUiPrefs, setUiPref } from './ui-prefs';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getUiPrefs', () => {
  it('returns defaults when nothing is stored', async () => {
    const prefs = await getUiPrefs();
    expect(prefs).toEqual({ buildMode: 'simple', runBaseUrl: '' });
  });
});

describe('setUiPref', () => {
  it('persists runBaseUrl and leaves other prefs untouched', async () => {
    await setUiPref('runBaseUrl', 'http://localhost:8081');
    const prefs = await getUiPrefs();
    expect(prefs.runBaseUrl).toBe('http://localhost:8081');
    expect(prefs.buildMode).toBe('simple');
  });

  it('setting one pref does not clobber a previously-set one', async () => {
    await setUiPref('runBaseUrl', 'http://localhost:8081');
    await setUiPref('buildMode', 'advanced');
    const prefs = await getUiPrefs();
    expect(prefs.runBaseUrl).toBe('http://localhost:8081');
    expect(prefs.buildMode).toBe('advanced');
  });
});
