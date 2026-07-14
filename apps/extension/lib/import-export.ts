import { browser } from 'wxt/browser';
import type { Scenario, Step } from '@aitomate/schema';
import { SCHEMA_VERSION } from '@aitomate/schema';
import { safeParseScenario } from '@aitomate/schema';

/**
 * T2.7: Import/export scenario files (.aitomate.json) with schema validation.
 *
 * Scenarios are stored in `storage.local` so they survive popup close and MV3
 * service-worker restart.
 *
 * Export supports:
 *   - single scenario as .aitomate.json (Build view)
 *   - suite as .zip (stored scenarios in Run view)
 *
 * Environment-variable placeholders ({{VAR_NAME}}) are preserved in the JSON
 * and resolved at runtime from local profiles (M2).
 */

const SCENARIOS_KEY = 'aitomate:scenarios';

export interface StoredScenario {
  id: string;
  name: string;
  scenario: Scenario;
  importedAt: number;
}

export interface ExportMeta {
  name?: string;
  description?: string;
  baseUrl?: string;
  tags?: string[];
}

// ── Storage ──

export async function listScenarios(): Promise<StoredScenario[]> {
  const stored = await browser.storage.local.get(SCENARIOS_KEY);
  return (stored[SCENARIOS_KEY] as StoredScenario[]) ?? [];
}

export async function findScenarioByName(name: string): Promise<StoredScenario | undefined> {
  const all = await listScenarios();
  return all.find((s) => s.name === name || s.scenario.meta.name === name);
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

export async function upsertScenario(scenario: Scenario): Promise<StoredScenario> {
  const all = await listScenarios();
  const idx = all.findIndex((s) => s.name === scenario.meta.name);
  if (idx !== -1) {
    all[idx] = { ...all[idx], scenario, importedAt: Date.now() };
    await browser.storage.local.set({ [SCENARIOS_KEY]: all });
    return all[idx];
  }
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

// ── Export: single scenario ──

export function buildScenarioObject(
  steps: Step[],
  meta?: ExportMeta,
): Scenario {
  const tags = structuredClone(meta?.tags)?.filter(Boolean) as string[] | undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: meta?.name || 'Untitled Scenario',
      description: meta?.description || undefined,
      baseUrl: meta?.baseUrl || undefined,
      tags: tags ?? [],
    },
    dataSources: [],
    steps,
  };
}

export function buildScenarioJson(
  steps: Step[],
  meta?: ExportMeta,
): string {
  return JSON.stringify(buildScenarioObject(steps, meta), null, 2);
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

/**
 * In-memory ZIP generator (store method, no compression). Avoids pulling in
 * JSZip — the ZIP format for stored entries is simple enough to emit inline.
 */
export function buildSuiteZip(entries: StoredScenario[]): Blob {
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  // Sanitizing to [a-zA-Z0-9_-] collapses distinct names to the same string
  // (two scenarios both named "Login Test", or non-ASCII names that all
  // become "___"). Without de-duping, later entries silently overwrite
  // earlier ones on extraction in some tools.
  const usedNames = new Map<string, number>();

  for (const entry of entries) {
    const json = JSON.stringify(entry.scenario, null, 2);
    const data = encoder.encode(json);
    const base = entry.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'scenario';
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    const filename = `${seen ? `${base}-${seen + 1}` : base}.aitomate.json`;
    const fnameBytes = encoder.encode(filename);

    // Local file header
    const local = new Uint8Array(30 + fnameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);       // signature
    lv.setUint16(4, 20, true);                // version needed
    lv.setUint16(6, 0, true);                 // flags
    lv.setUint16(8, 0, true);                 // compression: store
    lv.setUint16(10, 0, true);                // mod time
    lv.setUint16(12, 0, true);                // mod date
    lv.setUint32(14, crc32(data), true);      // crc-32
    lv.setUint32(18, data.length, true);      // compressed size
    lv.setUint32(22, data.length, true);      // uncompressed size
    lv.setUint16(26, fnameBytes.length, true); // filename length
    local.set(fnameBytes, 30);
    localHeaders.push(local, data);

    // Central directory entry
    const central = new Uint8Array(46 + fnameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);        // signature
    cv.setUint16(4, 20, true);                // version made by
    cv.setUint16(6, 20, true);                // version needed
    cv.setUint16(8, 0, true);                 // flags
    cv.setUint16(10, 0, true);                // compression: store
    cv.setUint16(12, 0, true);                // mod time
    cv.setUint16(14, 0, true);                // mod date
    cv.setUint32(16, crc32(data), true);      // crc-32
    cv.setUint32(20, data.length, true);      // compressed size
    cv.setUint32(24, data.length, true);      // uncompressed size
    cv.setUint16(28, fnameBytes.length, true);
    cv.setUint16(30, 0, true);                // extra field length
    cv.setUint16(32, 0, true);                // file comment length
    cv.setUint16(34, 0, true);                // disk number start
    cv.setUint16(36, 0, true);                // internal attrs
    cv.setUint32(38, 0, true);                // external attrs
    cv.setUint32(42, offset, true);           // local header offset
    central.set(fnameBytes, 46);
    centralEntries.push(central);

    offset += 30 + fnameBytes.length + data.length;
  }

  // End of central directory
  const centralStart = offset;
  const centralSize = centralEntries.reduce((s, e) => s + e.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);                   // disk number
  ev.setUint16(6, 0, true);                   // disk with central dir
  ev.setUint16(8, centralEntries.length, true); // total entries on disk
  ev.setUint16(10, centralEntries.length, true); // total entries
  ev.setUint32(12, centralSize, true);         // central dir size
  ev.setUint32(16, centralStart, true);        // central dir offset
  ev.setUint16(20, 0, true);                   // comment length

  const parts: BlobPart[] = [
    ...localHeaders.map((u) => u as BlobPart),
    ...centralEntries.map((u) => u as BlobPart),
    eocd as BlobPart,
  ];
  return new Blob(parts, { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── CRC-32 (used by ZIP) ──

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
