import { describe, expect, it } from 'vitest';
import type { RunReport } from './report';
import { buildReportFilename, buildReportHtml, buildReportJson } from './report-export';

/**
 * T4.3 (Export report as JSON/HTML) — TDD contract, written before the
 * implementation exists. `buildReportJson`, `buildReportHtml`, and
 * `buildReportFilename` must be created in `./report-export.ts` to make
 * these pass; nothing in this file should need to change to accommodate
 * the implementation.
 *
 * Design intent:
 *   - Pure string builders, same shape as `import-export.ts`'s
 *     `buildScenarioJson`/`buildSuiteZip` — they return data, they don't
 *     touch the DOM. A separate `downloadReport`-style helper (not covered
 *     here, mirrors `downloadJson`) does the `Blob`/`<a download>` dance.
 *   - **Security: the HTML export is a real XSS surface.** A `RunReport`
 *     carries free text a developer doesn't fully control — a step's
 *     `error` message can echo page content (e.g. an assertion failure
 *     quoting the page's actual text), and `scenarioName` is user-typed.
 *     This file gets opened directly in a browser or attached to a bug
 *     ticket someone else opens — any of those strings landing in the HTML
 *     unescaped is stored/reflected XSS. Every test scenario field that
 *     could contain user/page text must come back HTML-escaped.
 *   - `buildReportFilename` mirrors the sanitize-to-`[a-zA-Z0-9_-]`
 *     approach `buildSuiteZip` already uses for the same reason (avoid
 *     characters that break as filenames or that collapse two different
 *     scenario names to the same file).
 */

function report(overrides?: Partial<RunReport>): RunReport {
  return {
    passed: true,
    scenarioName: 'Checkout Flow',
    startedAt: 1000,
    finishedAt: 1500,
    durationMs: 500,
    steps: [
      { stepId: 's1', action: 'click', status: 'passed', attempts: 1, durationMs: 120 },
    ],
    consoleErrors: [],
    networkErrors: [],
    ...overrides,
  };
}

describe('buildReportJson', () => {
  it('round-trips to a structurally equal object', () => {
    const r = report();
    const json = buildReportJson(r);
    expect(JSON.parse(json)).toEqual(r);
  });

  it('pretty-prints (indented, multi-line)', () => {
    const json = buildReportJson(report());
    expect(json).toContain('\n');
    expect(json).toMatch(/^\{\n {2}"/);
  });
});

describe('buildReportHtml', () => {
  it('escapes an HTML-unsafe scenario name instead of injecting it raw', () => {
    const html = buildReportHtml(report({ scenarioName: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes an HTML-unsafe step error instead of injecting it raw', () => {
    const html = buildReportHtml(
      report({
        passed: false,
        steps: [
          {
            stepId: 's1',
            action: 'assert',
            status: 'failed',
            attempts: 1,
            durationMs: 30,
            error: 'Expected "<img src=x onerror=alert(1)>" to be visible',
          },
        ],
      }),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows a pass/fail summary and renders one row per step', () => {
    const html = buildReportHtml(
      report({
        passed: false,
        steps: [
          { stepId: 's1', action: 'click', status: 'passed', attempts: 1, durationMs: 50 },
          { stepId: 's2', action: 'fill', status: 'failed', attempts: 3, durationMs: 80, error: 'boom' },
          { stepId: 's3', action: 'assert', status: 'skipped' },
        ],
      }),
    );
    expect(html).toMatch(/Fail/i);
    expect(html).toContain('click');
    expect(html).toContain('fill');
    expect(html).toContain('assert');
    // A skipped step has no durationMs/attempts — must never render the
    // literal string "undefined" for a missing optional field.
    expect(html).not.toMatch(/undefined/);
  });

  it('renders console/network errors when present, escaped', () => {
    const html = buildReportHtml(
      report({
        consoleErrors: ['<b>TypeError</b>: x is not a function'],
        networkErrors: ['GET /api/cart 500'],
      }),
    );
    expect(html).toContain('&lt;b&gt;TypeError&lt;/b&gt;: x is not a function');
    expect(html).toContain('GET /api/cart 500');
  });

  it('produces well-formed output with no console/network errors', () => {
    const html = buildReportHtml(report());
    expect(html).not.toMatch(/undefined/);
    expect(html.toLowerCase()).toContain('<html');
  });
});

describe('buildReportFilename', () => {
  it('sanitizes the scenario name and appends the given extension', () => {
    expect(buildReportFilename('Checkout Flow', 'json')).toBe('Checkout_Flow-report.json');
    expect(buildReportFilename('Checkout Flow', 'html')).toBe('Checkout_Flow-report.html');
  });

  it('collapses non-ASCII names to underscores rather than dropping them', () => {
    expect(buildReportFilename('日本語', 'json')).toBe('___-report.json');
  });

  it('falls back to a default base name for an empty scenario name', () => {
    expect(buildReportFilename('', 'json')).toBe('report-report.json');
  });
});
