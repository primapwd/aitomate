import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Step } from '@aitomate/schema';
import {
  buildScenarioJson,
  deleteScenario,
  importScenario,
  listScenarios,
  saveScenario,
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
    const json = buildScenarioJson(steps, 'Checkout');
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

describe('scenario storage', () => {
  it('saves, lists, and deletes scenarios', async () => {
    const parsed = importScenario(buildScenarioJson(steps, 'Login'));
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
