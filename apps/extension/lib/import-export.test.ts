import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Step } from '@aitomate/schema';
import {
  buildScenarioJson,
  buildScenarioObject,
  buildSuiteZip,
  deleteScenario,
  effectiveSlug,
  findIncompleteStep,
  findScenarioByName,
  findScenarioBySlug,
  getScenarioById,
  importScenario,
  listScenarios,
  saveScenario,
  saveScenarioDeduped,
  upsertScenario,
} from './import-export';

const steps: Step[] = [
  {
    id: 'step-1',
    action: 'click',
    selector: { strategy: 'testid', value: 'submit' },
  },
];

beforeEach(() => {
  fakeBrowser.reset();
});

describe('buildScenarioJson', () => {
  it('produces a document that round-trips through importScenario', () => {
    const json = buildScenarioJson(steps, { name: 'Checkout' });
    const result = importScenario(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.meta.name).toBe('Checkout');
      expect(result.scenario.steps).toHaveLength(1);
    }
  });

  it('falls back to a default name', () => {
    const result = importScenario(buildScenarioJson(steps));
    expect(result.ok && result.scenario.meta.name).toBe('Untitled Scenario');
  });

  it('includes description, baseUrl, and tags when provided', () => {
    const json = buildScenarioJson(steps, {
      name: 'Full',
      description: 'My scenario',
      baseUrl: '{{BASE_URL}}',
      tags: ['smoke', 'regression'],
    });
    const result = importScenario(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.meta.description).toBe('My scenario');
      expect(result.scenario.meta.baseUrl).toBe('{{BASE_URL}}');
      expect(result.scenario.meta.tags).toEqual(['smoke', 'regression']);
    }
  });
});

describe('buildScenarioObject', () => {
  it('returns a Scenario object matching buildScenarioJson output', () => {
    const obj = buildScenarioObject(steps, { name: 'Test', description: 'desc', baseUrl: 'https://example.com', tags: ['smoke'] });
    const fromJson = importScenario(buildScenarioJson(steps, { name: 'Test', description: 'desc', baseUrl: 'https://example.com', tags: ['smoke'] }));
    expect(fromJson.ok).toBe(true);
    if (fromJson.ok) {
      expect(obj).toEqual(fromJson.scenario);
    }
  });

  it('auto-derives a slug from the name when none is given', () => {
    const obj = buildScenarioObject(steps, { name: 'Sign Up Flow' });
    expect(obj.meta.slug).toBe('sign-up-flow');
  });

  it('keeps a manually-provided slug instead of deriving one', () => {
    const obj = buildScenarioObject(steps, { name: 'Sign Up Flow', slug: 'custom-slug' });
    expect(obj.meta.slug).toBe('custom-slug');
  });
});

describe('effectiveSlug', () => {
  it('returns the persisted slug when present', () => {
    const obj = buildScenarioObject(steps, { name: 'Login', slug: 'my-login' });
    expect(effectiveSlug(obj)).toBe('my-login');
  });

  it('derives a slug from name for older scenarios with no meta.slug', () => {
    const obj = buildScenarioObject(steps, { name: 'Login Test' });
    const withoutSlug = { ...obj, meta: { ...obj.meta, slug: undefined } };
    expect(effectiveSlug(withoutSlug)).toBe('login-test');
  });
});

describe('upsertScenario', () => {
  it('adds a new scenario when no match exists', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'New' }));
    if (!parsed.ok) throw new Error('fixture failed');

    const entry = await upsertScenario(parsed.scenario);
    expect(entry.name).toBe('New');

    const all = await listScenarios();
    expect(all).toHaveLength(1);
  });

  it('replaces an existing scenario with the same name', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Dupe' }));
    if (!parsed.ok) throw new Error('fixture failed');
    await upsertScenario(parsed.scenario);

    const steps2: Step[] = [{ id: 's2', action: 'navigate', url: '/other' }];
    const parsed2 = importScenario(buildScenarioJson(steps2, { name: 'Dupe' }));
    if (!parsed2.ok) throw new Error('fixture failed');

    const updated = await upsertScenario(parsed2.scenario);
    const all = await listScenarios();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(updated.id);
    expect(all[0].scenario.steps).toHaveLength(1);
    expect(all[0].scenario.steps[0].action).toBe('navigate');
  });

  it('replaces by slug even when the display name changed', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Old Name', slug: 'checkout' }));
    if (!parsed.ok) throw new Error('fixture failed');
    await upsertScenario(parsed.scenario);

    const parsed2 = importScenario(buildScenarioJson(steps, { name: 'New Name', slug: 'checkout' }));
    if (!parsed2.ok) throw new Error('fixture failed');
    await upsertScenario(parsed2.scenario);

    const all = await listScenarios();
    expect(all).toHaveLength(1);
    expect(all[0].scenario.meta.name).toBe('New Name');
  });

  it('does not collide when two scenarios share a name but not a slug', async () => {
    const a = importScenario(buildScenarioJson(steps, { name: 'Login', slug: 'login-v1' }));
    const b = importScenario(buildScenarioJson(steps, { name: 'Login', slug: 'login-v2' }));
    if (!a.ok || !b.ok) throw new Error('fixtures failed');

    await upsertScenario(a.scenario);
    await upsertScenario(b.scenario);

    expect(await listScenarios()).toHaveLength(2);
  });
});

describe('importScenario', () => {
  it('rejects non-JSON input with a plain-language error', () => {
    const result = importScenario('not json at all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not valid JSON');
    }
  });

  it('rejects a JSON document that is not a scenario', () => {
    const result = importScenario(JSON.stringify({ foo: 'bar' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not valid');
    }
  });
});

describe('buildSuiteZip', () => {
  it('produces a valid ZIP blob from stored scenarios', async () => {
    const a = importScenario(buildScenarioJson(steps, { name: 'Alpha' }));
    const b = importScenario(buildScenarioJson(steps, { name: 'Beta' }));
    if (!a.ok || !b.ok) throw new Error('fixtures failed');

    const blob = buildSuiteZip([
      { id: '1', name: 'Alpha', scenario: a.scenario, importedAt: 1 },
      { id: '2', name: 'Beta', scenario: b.scenario, importedAt: 2 },
    ]);

    expect(blob.size).toBeGreaterThan(100);
    // ZIP signature at offset 0
    const buf = await blob.arrayBuffer();
    const header = new DataView(buf);
    expect(header.getUint32(0, true)).toBe(0x04034b50);

    // EOCD signature near the end (last 22+ bytes)
    const eocd = new DataView(buf, buf.byteLength - 22);
    expect(eocd.getUint32(0, true)).toBe(0x06054b50);
    expect(eocd.getUint16(10, true)).toBe(2); // 2 entries
  });

  it('gives colliding sanitized names distinct filenames in the archive', async () => {
    const a = importScenario(buildScenarioJson(steps, { name: 'Login Test' }));
    const b = importScenario(buildScenarioJson(steps, { name: 'Login Test' }));
    if (!a.ok || !b.ok) throw new Error('fixtures failed');

    const blob = buildSuiteZip([
      { id: '1', name: 'Login Test', scenario: a.scenario, importedAt: 1 },
      { id: '2', name: 'Login Test', scenario: b.scenario, importedAt: 2 },
    ]);
    const buf = await blob.arrayBuffer();
    expect(new Set(readZipFilenames(buf)).size).toBe(2);
  });
});

/** Read local-file-header filenames from a ZIP buffer (store method only). */
function readZipFilenames(buf: ArrayBuffer): string[] {
  const view = new DataView(buf);
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (offset < buf.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLen = view.getUint16(offset + 26, true);
    const dataLen = view.getUint32(offset + 22, true);
    names.push(decoder.decode(new Uint8Array(buf, offset + 30, nameLen)));
    offset += 30 + nameLen + dataLen;
  }
  return names;
}

describe('findScenarioByName', () => {
  it('finds a scenario by saved name', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Login' }));
    if (!parsed.ok) throw new Error('fixture failed');
    await saveScenario(parsed.scenario);

    const found = await findScenarioByName('Login');
    expect(found).toBeDefined();
    expect(found!.scenario.meta.name).toBe('Login');
  });

  it('returns undefined for unknown name', async () => {
    expect(await findScenarioByName('nope')).toBeUndefined();
  });
});

describe('findScenarioBySlug', () => {
  it('finds a scenario by its slug', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Login', slug: 'my-login' }));
    if (!parsed.ok) throw new Error('fixture failed');
    await saveScenario(parsed.scenario);

    const found = await findScenarioBySlug('my-login');
    expect(found).toBeDefined();
    expect(found!.scenario.meta.name).toBe('Login');
  });

  it('returns undefined for unknown slug', async () => {
    expect(await findScenarioBySlug('nope')).toBeUndefined();
  });
});

describe('saveScenarioDeduped', () => {
  it('saves without prompting when no slug collision exists', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Login' }));
    if (!parsed.ok) throw new Error('fixture failed');

    const confirmOverwrite = vi.fn(() => true);
    const result = await saveScenarioDeduped(parsed.scenario, confirmOverwrite);
    expect(result.ok).toBe(true);
    expect(confirmOverwrite).not.toHaveBeenCalled();
  });

  it('prompts and overwrites when the confirm callback returns true', async () => {
    const first = importScenario(buildScenarioJson(steps, { name: 'Login', slug: 'login' }));
    if (!first.ok) throw new Error('fixture failed');
    await saveScenarioDeduped(first.scenario, () => true);

    const second = importScenario(buildScenarioJson(steps, { name: 'Login v2', slug: 'login' }));
    if (!second.ok) throw new Error('fixture failed');
    const confirmOverwrite = vi.fn(() => true);
    const result = await saveScenarioDeduped(second.scenario, confirmOverwrite);

    expect(result.ok).toBe(true);
    expect(confirmOverwrite).toHaveBeenCalledWith('Login');
    expect(await listScenarios()).toHaveLength(1);
  });

  it('does not save when the confirm callback returns false', async () => {
    const first = importScenario(buildScenarioJson(steps, { name: 'Login', slug: 'login' }));
    if (!first.ok) throw new Error('fixture failed');
    await saveScenarioDeduped(first.scenario, () => true);

    const second = importScenario(buildScenarioJson(steps, { name: 'Login v2', slug: 'login' }));
    if (!second.ok) throw new Error('fixture failed');
    const result = await saveScenarioDeduped(second.scenario, () => false);

    expect(result.ok).toBe(false);
    const all = await listScenarios();
    expect(all).toHaveLength(1);
    expect(all[0].scenario.meta.name).toBe('Login');
  });
});

describe('getScenarioById', () => {
  it('finds a scenario by its stored id', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Login' }));
    if (!parsed.ok) throw new Error('fixture failed');
    const entry = await saveScenario(parsed.scenario);

    const found = await getScenarioById(entry.id);
    expect(found).toBeDefined();
    expect(found!.scenario.meta.name).toBe('Login');
  });

  it('returns undefined for an unknown id', async () => {
    expect(await getScenarioById('nope')).toBeUndefined();
  });
});

describe('scenario storage', () => {
  it('saves, lists, and deletes scenarios', async () => {
    const parsed = importScenario(buildScenarioJson(steps, { name: 'Login' }));
    if (!parsed.ok) throw new Error('fixture failed to parse');

    const entry = await saveScenario(parsed.scenario);
    expect(entry.name).toBe('Login');

    const all = await listScenarios();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);

    await deleteScenario(entry.id);
    expect(await listScenarios()).toHaveLength(0);
  });
});

describe('findIncompleteStep', () => {
  it('returns null when every step is filled in', () => {
    expect(findIncompleteStep(steps)).toBeNull();
  });

  it('flags a click step with a blank selector value', () => {
    const result = findIncompleteStep([
      { id: 's1', action: 'click', selector: { strategy: 'css', value: '' } },
    ]);
    expect(result).not.toBeNull();
    expect(result?.index).toBe(0);
    expect(result?.message).toContain('selector');
  });

  it('flags a navigate step with a blank url', () => {
    const result = findIncompleteStep([{ id: 's1', action: 'navigate', url: '' }]);
    expect(result?.message).toContain('URL');
  });

  it('flags a urlMatches assert step with a blank pattern', () => {
    const result = findIncompleteStep([
      { id: 's1', action: 'assert', assertion: 'urlMatches', pattern: '', patternType: 'glob' },
    ]);
    expect(result?.message).toContain('pattern');
  });

  it('flags a wait step with a blank forSelector value', () => {
    const result = findIncompleteStep([
      { id: 's1', action: 'wait', forSelector: { strategy: 'css', value: '' } },
    ]);
    expect(result?.message).toContain('wait for');
  });

  it('does not flag a wait step with only a duration', () => {
    expect(findIncompleteStep([{ id: 's1', action: 'wait', durationMs: 1000 }])).toBeNull();
  });

  it('flags a wait step with neither a duration nor a forSelector', () => {
    const result = findIncompleteStep([{ id: 's1', action: 'wait' }]);
    expect(result).not.toBeNull();
    expect(result?.message).toContain('duration');
  });

  it('returns the first incomplete step when several are incomplete', () => {
    const result = findIncompleteStep([
      { id: 's1', action: 'navigate', url: '' },
      { id: 's2', action: 'click', selector: { strategy: 'css', value: '' } },
    ]);
    expect(result?.index).toBe(0);
  });
});
