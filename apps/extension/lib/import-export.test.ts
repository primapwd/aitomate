import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Step } from '@aitomate/schema';
import {
  buildScenarioJson,
  buildScenarioObject,
  buildSuiteZip,
  deleteScenario,
  findScenarioByName,
  importScenario,
  listScenarios,
  saveScenario,
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
