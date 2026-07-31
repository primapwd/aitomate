import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  buildSuiteZip,
  deleteScenario,
  downloadBlob,
  importScenario,
  listScenarios,
  pickFile,
  saveScenario,
  type StoredScenario,
} from '@/lib/import-export';
import type { RunReport } from '@/lib/runner/report';
import { downloadReport } from '@/lib/runner/report-export';
import OnboardingWizard from '@/components/OnboardingWizard';
import type { RunnerCommand, RunnerRunReportMessage, RunnerStateMessage, RunnerSuiteStateMessage } from '@/lib/runner/messages';
import type { SuiteReport } from '@/lib/runner/suite';

export default function RunView() {
  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [importError, setImportError] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runTabId, setRunTabId] = useState<number | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteReport, setSuiteReport] = useState<SuiteReport | null>(null);
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [reportAdvanced, setReportAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  // background sends the final 'state' (done/error) broadcast, which nulls
  // runTabId, *before* the run-report broadcast for the same run. If React
  // re-renders (applying that null) before run-report arrives, matching on
  // the `runTabId` state below would drop the report. A ref sidesteps the
  // React re-render race: it's updated synchronously, not on next render.
  const runTabIdRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const all = await listScenarios();
    setScenarios(all);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-enable the Run button when the background reports the run ended —
  // without this it stays on "Running…" forever.
  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as RunnerStateMessage | RunnerRunReportMessage | RunnerSuiteStateMessage;
      // While a suite is running, every scenario inside it broadcasts its own
      // 'done'/'error' state on this same tab — the single-run branch below
      // must ignore those, or it clears runTabId after the *first* scenario
      // and the final suite-state broadcast (which checks tabId === runTabId)
      // never matches, leaving "Running…" stuck forever.
      if (m.type === 'aitomate:runner:state' && m.tabId === runTabId && !suiteRunning) {
        if (m.state.status === 'done' || m.state.status === 'error' || m.state.status === 'idle') {
          setRunningId(null);
          setRunTabId(null);
          if (m.state.status === 'error') {
            setImportError(m.state.error ?? 'The run failed.');
          }
        }
      }
      if (m.type === 'aitomate:runner:run-report' && m.tabId === runTabIdRef.current) {
        setRunReport(m.report);
      }
      if (m.type === 'aitomate:runner:suite-state' && m.tabId === runTabId) {
        setSuiteReport(m.suiteReport);
        setSuiteRunning(false);
        setRunningId(null);
        setRunTabId(null);
        setRunReport(null);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => {
      browser.runtime.onMessage.removeListener(handler);
    };
  }, [runTabId, suiteRunning]);

  const handleImport = useCallback(async () => {
    setImportError('');
    try {
      const raw = await pickFile();
      const result = importScenario(raw);
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      await saveScenario(result.scenario);
      await refresh();
    } catch (err) {
      setImportError(String(err));
    }
  }, [refresh]);

  const handleRun = useCallback(
    async (entry: StoredScenario) => {
      setRunReport(null);
      setImportError('');
      setRunningId(entry.id);
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          setImportError('No active tab found. Open a page first.');
          setRunningId(null);
          return;
        }
        setRunTabId(tab.id);
        runTabIdRef.current = tab.id;
        // Fire and forget — the runner loop runs in the background.
        await browser.runtime.sendMessage({
          type: 'aitomate:runner:play',
          tabId: tab.id,
          scenario: entry.scenario,
          baseUrl: baseUrl || undefined,
        } as RunnerCommand);
      } catch (err) {
        setImportError(String(err));
        setRunningId(null);
        setRunTabId(null);
      }
    },
    [baseUrl],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteScenario(id);
      await refresh();
    },
    [refresh],
  );

  const handleRunAll = useCallback(async () => {
    setImportError('');
    setSuiteReport(null);
    setSuiteRunning(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setImportError('No active tab found. Open a page first.');
        setSuiteRunning(false);
        return;
      }
      setRunTabId(tab.id);
      runTabIdRef.current = tab.id;
      await browser.runtime.sendMessage({
        type: 'aitomate:runner:play-suite',
        tabId: tab.id,
        scenarioRefs: scenarios.map((s) => ({ id: s.id, name: s.name })),
        baseUrl: baseUrl || undefined,
      } as RunnerCommand);
    } catch (err) {
      setImportError(String(err));
      setSuiteRunning(false);
    }
  }, [scenarios, baseUrl]);

  const handleStopSuite = useCallback(async () => {
    if (!runTabId) return;
    await browser.runtime.sendMessage({
      type: 'aitomate:runner:stop-suite',
      tabId: runTabId,
    } as RunnerCommand);
  }, [runTabId]);

  const handleExportSuite = useCallback(() => {
    if (scenarios.length === 0) return;
    const blob = buildSuiteZip(scenarios);
    downloadBlob(blob, 'aitomate-suite.zip');
  }, [scenarios]);

  // The wizard can save a scenario mid-onboarding (`saveScenario`, bypassing
  // this view's own import flow) — refresh so it shows up in the list
  // without waiting for the popup to reopen.
  const handleOnboardingComplete = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <OnboardingWizard onComplete={handleOnboardingComplete} />
    <section>
      <p style={{ fontSize: 13, color: '#555', margin: '0 0 12px' }}>
        Import a scenario and run it — no setup needed for static-only
        scenarios.
      </p>

      <button onClick={handleImport} style={btnStyle}>
        Import scenario…
      </button>

      {importError && (
        <p style={{ fontSize: 11, color: '#c33', marginTop: 8 }}>{importError}</p>
      )}

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 11, color: '#555', fontWeight: 600 }}>Base URL</label>
        <p style={{ fontSize: 10, color: '#999', margin: '2px 0 4px' }}>Optional — resolves {'{{BASE_URL}}'} placeholders</p>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="e.g. http://localhost:8080"
          style={{
            display: 'block', width: '100%', marginTop: 4, padding: '6px 8px',
            fontSize: 12, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box',
          }}
        />
      </div>

      {scenarios.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {scenarios.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: '8px 10px',
                marginBottom: 6,
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, flex: 1, color: '#333' }}>
                  {entry.name}
                </span>
                <span style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>
                  {entry.scenario.steps.length} step
                  {entry.scenario.steps.length === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => handleRun(entry)}
                  disabled={runningId === entry.id}
                  style={{
                    fontSize: 11,
                    padding: '3px 10px',
                    border: 'none',
                    borderRadius: 4,
                    background: runningId === entry.id ? '#ccc' : '#1a1a1a',
                    color: '#fff',
                    cursor: runningId === entry.id ? 'default' : 'pointer',
                  }}
                >
                  {runningId === entry.id ? 'Running…' : 'Run'}
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={runningId === entry.id}
                  style={{
                    fontSize: 11,
                    padding: '3px 7px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    background: '#fff',
                    color: '#c33',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {scenarios.length > 1 && (
            <>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button
                  onClick={suiteRunning ? handleStopSuite : handleRunAll}
                  style={{
                    ...btnStyle,
                    background: suiteRunning ? '#c33' : '#1a1a1a',
                    color: '#fff',
                    border: 'none',
                  }}
                >
                  {suiteRunning ? 'Stop suite' : 'Run all'}
                </button>
                <button onClick={handleExportSuite} disabled={suiteRunning} style={btnStyle}>
                  Export suite ({scenarios.length})
                </button>
              </div>

              {suiteReport && (
                <div style={{ marginTop: 12, padding: 10, background: '#f5f5f5', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    Suite {suiteReport.passed ? 'passed' : 'failed'}
                    <span style={{ fontWeight: 400, color: '#777', marginLeft: 6 }}>
                      ({suiteReport.scenarios.filter((s) => s.status === 'passed').length}/
                      {suiteReport.scenarios.length} passed)
                    </span>
                  </div>
                  {suiteReport.scenarios.map((sc, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: sc.status === 'passed' ? '#2e7d32' : sc.status === 'failed' ? '#d32f2f' : '#ccc',
                      }} />
                      <span style={{ flex: 1, color: '#333' }}>{sc.name}</span>
                      <span style={{ fontSize: 10, color: sc.status === 'failed' ? '#d32f2f' : '#777' }}>
                        {sc.status === 'failed' ? (sc.error ?? 'failed') : sc.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {runReport && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            padding: '10px 12px', borderRadius: 8, fontSize: 13,
            background: runReport.passed ? '#e8f5e9' : '#fce4ec',
            border: `1px solid ${runReport.passed ? '#c8e6c9' : '#f5c6cb'}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {runReport.passed ? 'Passed' : 'Failed'}
              <span style={{ fontWeight: 400, color: '#777', marginLeft: 8, fontSize: 11 }}>
                {runReport.durationMs}ms &middot; {runReport.steps.length} step{runReport.steps.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button onClick={() => downloadReport(runReport, 'json')} style={smallBtnStyle}>
              Export JSON
            </button>
            <button onClick={() => downloadReport(runReport, 'html')} style={smallBtnStyle}>
              Export HTML
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#777', cursor: 'pointer' }}>
              <input type="checkbox" checked={reportAdvanced} onChange={(e) => setReportAdvanced(e.target.checked)} />
              Advanced
            </label>
          </div>

          <div style={{ marginTop: 8, fontSize: 12 }}>
            {runReport.steps.map((s, i) => (
              <div key={s.stepId} style={{
                padding: '8px 10px', marginBottom: 4,
                border: '1px solid #e0e0e0', borderRadius: 6,
                background: s.status === 'passed' ? '#f1f8e9' : s.status === 'failed' ? '#fff3e0' : '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: s.status === 'passed' ? '#2e7d32' : s.status === 'failed' ? '#d32f2f' : '#ccc',
                  }} />
                  <span style={{ flex: 1, color: '#333' }}>Step {i + 1}: {s.action}</span>
                  <span style={{ fontSize: 10, color: '#999' }}>
                    {s.status === 'passed' && `${s.durationMs}ms`}
                    {s.status === 'failed' && 'Failed'}
                    {s.status === 'skipped' && 'Skipped'}
                  </span>
                </div>
                {reportAdvanced && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
                    <div>stepId: {s.stepId}</div>
                    <div>action: {s.action}</div>
                    <div>status: {s.status}</div>
                    {s.error && <div style={{ color: '#d32f2f' }}>error: {s.error}</div>}
                    {s.attempts !== undefined && <div>attempts: {s.attempts}</div>}
                    {s.durationMs !== undefined && <div>durationMs: {s.durationMs}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
    </>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  border: '1px solid #ccc',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
