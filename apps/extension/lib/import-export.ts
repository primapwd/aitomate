import { browser } from 'wxt/browser';
import type { Scenario, Step } from '@aitomate/schema';
import { SCHEMA_VERSION } from '@aitomate/schema';
import { safeParseScenario } from '@aitomate/schema';

/**
 * T2.7: Import/export scenario files (.aitomate.json) with schema validation.
 *
 * Scenarios are stored in `storage.local` so they survive popup close and MV3
 * service-worker restart.
 */

const SCENARIOS_KEY = 'aitomate:scenarios';

export interface StoredScenario {
  id: string;
  name: string;
  scenario: Scenario;
  importedAt: number;
}

// ── Storage ──

export async function listScenarios(): Promise<StoredScenario[]> {
  const stored = await browser.storage.local.get(SCENARIOS_KEY);
  return (stored[SCENARIOS_KEY] as StoredScenario[]) ?? [];
}

export async function saveScenario(scenario: Scenario): Promise<StoredScenario> {
  const all = await listScenarios();
  const entry: StoredScenario = {
    id: crypto.randomUUID(),
    name: scenario.meta.name,
    scenario,
    importedAt: Date.now(),
  };
  all.push(entry);
  await browser.storage.local.set({ [SCENARIOS_KEY]: all });
  return entry;
}

export async function deleteScenario(id: string): Promise<void> {
  const all = await listScenarios();
  await browser.storage.local.set({
    [SCENARIOS_KEY]: all.filter((s) => s.id !== id),
  });
}

// ── Export ──

export function buildScenarioJson(steps: Step[], name?: string): string {
  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: name || 'Untitled Scenario',
      tags: [],
    },
    dataSources: [],
    steps,
  };
  return JSON.stringify(scenario, null, 2);
}

export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.aitomate.json')
    ? filename
    : `${filename}.aitomate.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Import ──

export function pickFile(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.aitomate.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result as string));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(file);
    });
    input.click();
  });
}

export function importScenario(raw: string):
  | { ok: true; scenario: Scenario }
  | { ok: false; error: string } {
  const result = safeParseScenario(raw);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, scenario: result.scenario };
}
