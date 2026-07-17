import type { RunReport } from './report';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReportJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

export function buildReportHtml(report: RunReport): string {
  const summaryClass = report.passed ? 'pass' : 'fail';
  const summaryLabel = report.passed ? 'Passed' : 'Failed';
  const summarySub = `${report.durationMs}ms · ${report.steps.length} step${report.steps.length === 1 ? '' : 's'}`;

  const stepRows = report.steps
    .map((s) => {
      const cls = s.status;
      const icon = s.status === 'passed' ? '✓' : s.status === 'failed' ? '✗' : '–';
      const meta = s.status !== 'skipped' ? `${s.attempts} attempt${s.attempts! === 1 ? '' : 's'}, ${s.durationMs}ms` : '';
      const errorRow = s.error ? `<div class="error">${esc(s.error)}</div>` : '';
      return `<tr class="${cls}"><td>${icon}</td><td>${esc(s.action)}</td><td>${s.status}</td><td>${meta}</td></tr>${errorRow ? `<tr class="${cls}"><td colspan="4">${errorRow}</td></tr>` : ''}`;
    })
    .join('\n');

  const consoleErrors = report.consoleErrors.length
    ? `<h3>Console Errors (${report.consoleErrors.length})</h3><ul>${report.consoleErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';

  const networkErrors = report.networkErrors.length
    ? `<h3>Network Errors (${report.networkErrors.length})</h3><ul>${report.networkErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Run Report: ${esc(report.scenarioName)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;font-size:14px;line-height:1.5;color:#222}
h1{font-size:20px;font-weight:600;margin:0 0 4px}
.summary{padding:12px 16px;border-radius:8px;margin-bottom:16px}
.summary.pass{background:#e8f5e9;border:1px solid #c8e6c9}
.summary.fail{background:#fce4ec;border:1px solid #f5c6cb}
.sub{font-size:12px;color:#777;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;font-weight:600;color:#555}
td{padding:6px 8px;border-bottom:1px solid #eee}
tr.passed td:first-child{color:#2e7d32}
tr.failed td:first-child{color:#d32f2f}
tr.skipped td:first-child{color:#999}
.error{color:#d32f2f;font-size:12px;margin-top:2px}
h3{font-size:14px;margin:16px 0 4px}
ul{margin:0;padding-left:20px;font-size:12px;color:#555}
</style>
</head>
<body>
<div class="summary ${summaryClass}">
<h1>${summaryLabel} <span class="sub">${summarySub}</span></h1>
<div>${esc(report.scenarioName)}</div>
</div>
<table>
<thead><tr><th></th><th>Action</th><th>Status</th><th>Details</th></tr></thead>
<tbody>${stepRows}</tbody>
</table>
${consoleErrors}
${networkErrors}
${report.screenshotOnFailure ? `<h3>Screenshot on Failure</h3><img src="${esc(report.screenshotOnFailure)}" style="max-width:100%;border:1px solid #ddd;border-radius:4px">` : ''}
</body>
</html>`;
}

export function buildReportFilename(scenarioName: string, extension: 'json' | 'html'): string {
  const base = scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'report';
  return `${base}-report.${extension}`;
}

export function downloadReport(report: RunReport, format: 'json' | 'html'): void {
  const content = format === 'json' ? buildReportJson(report) : buildReportHtml(report);
  const mimeType = format === 'json' ? 'application/json' : 'text/html';
  const filename = buildReportFilename(report.scenarioName, format);
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
