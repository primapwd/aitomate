import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  buildSuiteZip,
  deleteScenario,
  downloadBlob,
  importScenario,
  listScenarios,
  pickFile,
  saveScenarioDeduped,
  type StoredScenario,
} from '@/lib/import-export';
import type { RunReport } from '@/lib/runner/report';
import { downloadReport } from '@/lib/runner/report-export';
import OnboardingWizard from '@/components/OnboardingWizard';
import type { RunnerCommand, RunnerRunReportMessage, RunnerStateMessage, RunnerStepResultMessage, RunnerSuiteStateMessage } from '@/lib/runner/messages';
import type { StepResult } from '@/lib/runner/messages';
import type { SuiteReport } from '@/lib/runner/suite';
import { getUiPrefs, setUiPref } from '@/lib/ui-prefs';
import { describeStep } from '@/components/views/build/StepCard';
import {
  IconAlert,
  IconCheck,
  IconCode,
  IconCross,
  IconDownload,
  IconEdit,
  IconEye,
  IconGlobe,
  IconLayers,
  IconPlay,
  IconSquare,
  IconTrash,
  IconUpload,
} from '@/components/ui/icons';

export interface RunViewProps {
  /** Switch to Build view and load this scenario's steps + meta for editing. */
  onEdit?: (id: string) => void;
}

export default function RunView({ onEdit }: RunViewProps) {
  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [importError, setImportError] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runTabId, setRunTabId] = useState<number | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteReport, setSuiteReport] = useState<SuiteReport | null>(null);
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [reportAdvanced, setReportAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [stepProgress, setStepProgress] = useState<{ index: number; total: number } | null>(null);
  const [viewStepsId, setViewStepsId] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const runTabIdRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const all = await listScenarios();
    setScenarios(all);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void getUiPrefs().then((prefs) => setBaseUrl(prefs.runBaseUrl));
  }, []);

  const handleBaseUrlChange = useCallback((value: string) => {
    setBaseUrl(value);
    void setUiPref('runBaseUrl', value);
  }, []);

  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as RunnerStateMessage | RunnerRunReportMessage | RunnerStepResultMessage | RunnerSuiteStateMessage;
      if (m.type === 'aitomate:runner:state' && m.tabId === runTabId && !suiteRunning) {
        if (m.state.status === 'done' || m.state.status === 'error' || m.state.status === 'idle') {
          setRunningId(null);
          setRunTabId(null);
          if (m.state.status === 'error') {
            setImportError(m.state.error ?? 'The run failed.');
          }
        }
      }
      if (m.type === 'aitomate:runner:state' && m.tabId === runTabIdRef.current) {
        if (m.state.status === 'playing' || m.state.status === 'paused') {
          setStepProgress({ index: m.state.currentStepIndex, total: m.state.totalSteps });
        } else if (m.state.status === 'done' || m.state.status === 'error' || m.state.status === 'idle') {
          setStepProgress(null);
        }
      }
      if (m.type === 'aitomate:runner:step-result' && m.tabId === runTabIdRef.current) {
        setStepResults((prev) => ({ ...prev, [m.result.stepId]: m.result }));
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
        setStepProgress(null);
        setStepResults({});
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
      const saved = await saveScenarioDeduped(result.scenario, (existingName) =>
        window.confirm(
          `A scenario with the same slug already exists ("${existingName}"). Overwrite it?`,
        ),
      );
      if (!saved.ok) {
        setImportError('Import cancelled — a scenario with the same slug already exists.');
        return;
      }
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
      setStepProgress(null);
      setStepResults({});
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          setImportError('No active tab found. Open a page first.');
          setRunningId(null);
          return;
        }
        setRunTabId(tab.id);
        runTabIdRef.current = tab.id;
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

  const handleStopRun = useCallback(async () => {
    const tabId = runTabIdRef.current ?? runTabId;
    if (!tabId) return;
    try {
      await browser.runtime.sendMessage({
        type: 'aitomate:runner:stop',
        tabId,
      } as RunnerCommand);
    } catch (err) {
      console.warn('[aitomate] could not stop runner', err);
    } finally {
      setRunningId(null);
      setRunTabId(null);
      setStepProgress(null);
      setStepResults({});
    }
  }, [runTabId]);

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
    setStepProgress(null);
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
    const tabId = runTabIdRef.current ?? runTabId;
    if (!tabId) return;
    try {
      await browser.runtime.sendMessage({
        type: 'aitomate:runner:stop-suite',
        tabId,
      } as RunnerCommand);
    } catch (err) {
      console.warn('[aitomate] could not stop suite runner', err);
    } finally {
      setSuiteRunning(false);
      setRunningId(null);
      setRunTabId(null);
      setStepProgress(null);
    }
  }, [runTabId]);

  const handleExportSuite = useCallback(() => {
    if (scenarios.length === 0) return;
    const blob = buildSuiteZip(scenarios);
    downloadBlob(blob, 'aitomate-suite.zip');
  }, [scenarios]);

  const handleOnboardingComplete = useCallback(() => {
    void refresh();
  }, [refresh]);

  const runningScenario = scenarios.find((s) => s.id === runningId);

  return (
    <>
      <OnboardingWizard onComplete={handleOnboardingComplete} />
      <section>
        {/* Top Action Bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            onClick={handleImport}
            disabled={runningId !== null || suiteRunning}
            className="ait-btn ait-btn-primary"
            style={{ flex: 1, padding: '8px 14px' }}
          >
            <IconUpload size={14} />
            <span>Import Scenario</span>
          </button>

          {scenarios.length > 1 && (
            <button
              onClick={suiteRunning ? handleStopSuite : handleRunAll}
              className={`ait-btn ${suiteRunning ? 'ait-btn-danger' : 'ait-btn-secondary'}`}
              style={{ padding: '8px 14px' }}
            >
              {suiteRunning ? <IconSquare size={13} color="#fff" /> : <IconPlay size={13} color="var(--accent-primary)" />}
              <span>{suiteRunning ? 'Stop Suite' : 'Run Suite'}</span>
            </button>
          )}
        </div>

        {/* Global Active Execution Banner when a single scenario is running */}
        {runningId && runningScenario && (
          <div
            className="ait-card animate-fade-in"
            style={{
              padding: '12px 14px',
              marginBottom: 14,
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(19, 25, 36, 0.95) 100%)',
              borderColor: 'rgba(99, 102, 241, 0.4)',
              boxShadow: 'var(--accent-glow)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#6366f1',
                    boxShadow: '0 0 10px #6366f1',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Running: {runningScenario.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    {stepProgress
                      ? `Executing step ${stepProgress.index + 1} of ${stepProgress.total}`
                      : 'Initializing test execution...'}
                  </div>
                </div>
              </div>

              <button
                onClick={handleStopRun}
                className="ait-btn ait-btn-danger ait-btn-sm"
                style={{ padding: '5px 12px', flexShrink: 0 }}
              >
                <IconSquare size={12} color="#fff" />
                <span>Stop Test</span>
              </button>
            </div>

            {stepProgress && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 4, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${((stepProgress.index + 1) / stepProgress.total) * 100}%`,
                      background: 'var(--accent-gradient)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {importError && (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--status-error-bg)',
              border: '1px solid var(--status-error-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--status-error)',
              fontSize: 11,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <IconAlert size={14} color="var(--status-error)" />
            <span>{importError}</span>
          </div>
        )}

        {/* Base URL Configuration Bar */}
        <div
          className="ait-card"
          style={{ padding: '10px 12px', marginBottom: 14, background: 'var(--bg-surface)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <IconGlobe size={13} color="var(--accent-primary)" />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>Target Base URL</span>
          </div>
          <input
            value={baseUrl}
            onChange={(e) => handleBaseUrlChange(e.target.value)}
            placeholder="e.g. http://localhost:8080 (resolves {{BASE_URL}})"
            className="ait-input"
            style={{ fontSize: 11, padding: '5px 8px' }}
          />
        </div>

        {/* Scenarios List */}
        {scenarios.length === 0 ? (
          <div
            className="ait-card"
            style={{
              textAlign: 'center',
              padding: '32px 16px',
              background: 'var(--bg-surface)',
              borderStyle: 'dashed',
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
                color: 'var(--accent-primary)',
              }}
            >
              <IconLayers size={20} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              No scenario loaded yet
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 260, margin: '0 auto 14px' }}>
              Import an existing <code>.aitomate.json</code> scenario or switch to the Build view to record a new test script.
            </div>
            <button onClick={handleImport} className="ait-btn ait-btn-primary ait-btn-sm">
              <IconUpload size={12} />
              <span>Import File</span>
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
                padding: '0 2px',
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Test Library ({scenarios.length})
              </span>
              {scenarios.length > 1 && (
                <button
                  onClick={handleExportSuite}
                  disabled={suiteRunning || runningId !== null}
                  className="ait-btn ait-btn-ghost ait-btn-sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  <IconDownload size={11} />
                  <span>Export Suite ZIP</span>
                </button>
              )}
            </div>

            {scenarios.map((entry) => {
              const isRunning = runningId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="ait-card animate-fade-in"
                  style={{
                    padding: '10px 12px',
                    marginBottom: 8,
                    background: isRunning ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface)',
                    borderColor: isRunning ? 'var(--accent-primary)' : 'var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.name}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                        <span className="ait-badge ait-badge-primary">
                          {entry.scenario.steps.length} steps
                        </span>

                        {entry.scenario.setup?.scenarioRef && (
                          <span className="ait-badge ait-badge-warning">
                            Setup: {entry.scenario.setup.scenarioRef}
                          </span>
                        )}

                        {entry.scenario.meta.baseUrl && !baseUrl && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            URL: {entry.scenario.meta.baseUrl}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {isRunning ? (
                        <button
                          onClick={handleStopRun}
                          className="ait-btn ait-btn-danger ait-btn-sm"
                          style={{ padding: '4px 10px' }}
                          title="Stop this running test scenario"
                        >
                          <IconSquare size={11} color="#fff" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRun(entry)}
                          disabled={suiteRunning || (runningId !== null && runningId !== entry.id)}
                          className="ait-btn ait-btn-primary ait-btn-sm"
                          style={{ padding: '4px 10px' }}
                        >
                          <IconPlay size={11} fill="#fff" />
                          <span>Run</span>
                        </button>
                      )}

                      <button
                        onClick={() => setViewStepsId(viewStepsId === entry.id ? null : entry.id)}
                        disabled={isRunning || suiteRunning}
                        className={`ait-btn ait-btn-secondary ait-btn-icon ${viewStepsId === entry.id ? 'ait-btn-active' : ''}`}
                        title={viewStepsId === entry.id ? 'Hide steps' : 'View steps'}
                      >
                        <IconEye size={12} color="var(--text-secondary)" />
                      </button>

                      <button
                        onClick={() => onEdit?.(entry.id)}
                        disabled={isRunning || suiteRunning}
                        className="ait-btn ait-btn-secondary ait-btn-icon"
                        title="Edit in Build view"
                      >
                        <IconEdit size={12} color="var(--text-secondary)" />
                      </button>

                      <button
                        onClick={() => handleDelete(entry.id)}
                        disabled={isRunning || suiteRunning}
                        className="ait-btn ait-btn-secondary ait-btn-icon"
                        title="Delete scenario"
                        style={{ color: 'var(--status-error)' }}
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Active Step Progress Indicator */}
                  {isRunning && stepProgress && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--accent-primary)', marginBottom: 3 }}>
                        <span>Running Step {stepProgress.index + 1} of {stepProgress.total}</span>
                        <span>{Math.round(((stepProgress.index + 1) / stepProgress.total) * 100)}%</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${((stepProgress.index + 1) / stepProgress.total) * 100}%`,
                            background: 'var(--accent-gradient)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      {entry.scenario.steps[stepProgress.index] && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          Action: <code style={{ color: '#a5b4fc' }}>{entry.scenario.steps[stepProgress.index].action}</code>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Read-only steps view (no edit) */}
                  {viewStepsId === entry.id && (
                    <div
                      className="animate-fade-in"
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      {entry.scenario.steps.length === 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          No steps in this scenario.
                        </div>
                      )}
                      {entry.scenario.steps.map((step, i) => {
                        const result = stepResults[step.id];
                        const isCurrent = isRunning && stepProgress?.index === i;
                        const statusColor = result
                          ? result.passed
                            ? 'var(--status-success)'
                            : 'var(--status-error)'
                          : isCurrent
                            ? 'var(--accent-primary)'
                            : 'var(--text-muted)';
                        return (
                          <div
                            key={step.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              padding: '3px 6px',
                              borderRadius: 'var(--radius-sm)',
                              background: result
                                ? result.passed
                                  ? 'rgba(46, 125, 50, 0.08)'
                                  : 'rgba(244, 63, 94, 0.08)'
                                : isCurrent
                                  ? 'rgba(99, 102, 241, 0.1)'
                                  : 'rgba(255,255,255,0.03)',
                            }}
                          >
                            {result ? (
                              <span
                                style={{
                                  width: 16,
                                  flexShrink: 0,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: statusColor,
                                  textAlign: 'center',
                                }}
                              >
                                {result.passed ? '✓' : '✕'}
                              </span>
                            ) : (
                              <span
                                style={{
                                  width: 16,
                                  color: isCurrent ? 'var(--accent-primary)' : 'var(--text-muted)',
                                  flexShrink: 0,
                                  fontSize: 10,
                                }}
                              >
                                {i + 1}.
                              </span>
                            )}
                            <span
                              style={{
                                color: result
                                  ? result.passed
                                    ? 'var(--text-primary)'
                                    : 'var(--status-error)'
                                  : 'var(--text-primary)',
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {describeStep(step, false)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Suite Report Card */}
        {suiteReport && (
          <div
            className="ait-card animate-fade-in"
            style={{
              marginTop: 14,
              padding: 12,
              background: 'var(--bg-surface)',
              borderLeft: `3px solid ${suiteReport.passed ? 'var(--status-success)' : 'var(--status-error)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: suiteReport.passed ? 'var(--status-success)' : 'var(--status-error)' }}>
                Suite {suiteReport.passed ? 'Passed ✓' : 'Failed ✕'}
              </span>
              <span className="ait-badge ait-badge-muted">
                {suiteReport.scenarios.filter((s) => s.status === 'passed').length} / {suiteReport.scenarios.length} Passed
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {suiteReport.scenarios.map((sc, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,255,255,0.03)',
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: sc.status === 'passed' ? 'var(--status-success)' : 'var(--status-error)',
                      }}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>{sc.name}</span>
                  </div>
                  <span style={{ fontSize: 10, color: sc.status === 'passed' ? 'var(--status-success)' : 'var(--status-error)' }}>
                    {sc.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Individual Run Report Card — hidden while steps are expanded (the
            expanded list already shows per-step ✓/✕ live statuses) */}
        {runReport && !viewStepsId && (
          <div
            className="ait-card animate-fade-in"
            style={{
              marginTop: 14,
              padding: 12,
              background: 'var(--bg-surface)',
              borderLeft: `3px solid ${runReport.passed ? 'var(--status-success)' : 'var(--status-error)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className={`ait-badge ${runReport.passed ? 'ait-badge-success' : 'ait-badge-error'}`}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  {runReport.passed ? 'PASSED ✓' : 'FAILED ✕'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {runReport.durationMs}ms &middot; {runReport.steps.length} steps
                </span>
              </div>

              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => downloadReport(runReport, 'json')}
                  className="ait-btn ait-btn-secondary ait-btn-sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  <IconDownload size={10} />
                  <span>JSON</span>
                </button>
                <button
                  onClick={() => downloadReport(runReport, 'html')}
                  className="ait-btn ait-btn-secondary ait-btn-sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  <IconDownload size={10} />
                  <span>HTML Report</span>
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reportAdvanced}
                  onChange={(e) => setReportAdvanced(e.target.checked)}
                />
                Show Advanced Step Diagnostics
              </label>
            </div>

            {/* Step Results */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {runReport.steps.map((s, i) => (
                <div
                  key={s.stepId}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: s.status === 'passed' ? 'var(--status-success)' : s.status === 'failed' ? 'var(--status-error)' : 'var(--text-muted)',
                        }}
                      />
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        Step {i + 1}: <code style={{ color: '#a5b4fc' }}>{s.action}</code>
                      </span>
                    </div>

                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {s.status === 'passed' && `${s.durationMs}ms`}
                      {s.status === 'failed' && <strong style={{ color: 'var(--status-error)' }}>Failed</strong>}
                      {s.status === 'skipped' && 'Skipped'}
                    </span>
                  </div>

                  {reportAdvanced && (
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)' }}>
                      <div>ID: {s.stepId}</div>
                      {s.error && <div style={{ color: 'var(--status-error)', marginTop: 2 }}>Error: {s.error}</div>}
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
