import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Step } from '@aitomate/schema';
import type { RecorderCommand, RecorderPopupMessage } from '@/lib/recorder/messages';
import { initialSessionState, type RecorderSessionState } from '@/lib/recorder/session';
import { getUiPrefs, setUiPref, type UiPrefs } from '@/lib/ui-prefs';
import {
  buildScenarioJson,
  buildScenarioObject,
  downloadJson,
  effectiveSlug,
  findIncompleteStep,
  getScenarioById,
  saveScenarioDeduped,
  type ExportMeta,
} from '@/lib/import-export';
import { slugify } from '@/lib/slug';
import { buildManualStep, type ManualStepAction } from '@/lib/build/manual-step';
import { stepSelector } from '@/lib/runner/dom';
import type { RunnerContentCommand, RunnerContentEvent } from '@/lib/runner/messages';
import RecordingControls from './build/RecordingControls';
import StepList from './build/StepList';
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconSave,
  IconSparkles,
} from '@/components/ui/icons';

type BuildMode = UiPrefs['buildMode'];

export interface BuildViewProps {
  /** A scenario id (from RunView's "Edit" button) to load into the editor. */
  editScenarioId?: string | null;
  /** Called once the scenario named by editScenarioId has been loaded. */
  onEditConsumed?: () => void;
}

export default function BuildView({ editScenarioId, onEditConsumed }: BuildViewProps) {
  const [mode, setMode] = useState<BuildMode>('simple');
  const [tabId, setTabId] = useState<number | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderSessionState>(initialSessionState);
  const [steps, setSteps] = useState<Step[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDesc, setScenarioDesc] = useState('');
  const [scenarioBaseUrl, setScenarioBaseUrl] = useState('');
  const [scenarioSlug, setScenarioSlug] = useState('');
  const slugTouched = useRef(false);
  const [scenarioTags, setScenarioTags] = useState('');
  const [saveStatus, setSaveStatus] = useState<null | 'saving' | 'saved' | 'duplicate' | 'error'>(
    null,
  );
  const [incompleteError, setIncompleteError] = useState('');
  const [locateError, setLocateError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mounted = useRef(true);

  // Load UI prefs + current tab on mount
  useEffect(() => {
    mounted.current = true;
    getUiPrefs().then((prefs) => {
      if (mounted.current) setMode(prefs.buildMode);
    });
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.id && mounted.current) setTabId(tab.id);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  // Refresh state + steps from background
  const refresh = useCallback(async () => {
    if (!tabId) return;
    try {
      const stateResp = await browser.runtime.sendMessage({
        type: 'aitomate:recorder:get-state',
        tabId,
      } satisfies RecorderCommand);
      if (stateResp && mounted.current) {
        setRecorderState(stateResp as RecorderSessionState);
      }
      const stepsResp = await browser.runtime.sendMessage({
        type: 'aitomate:recorder:get-steps',
        tabId,
      } as RecorderCommand);
      if (stepsResp && mounted.current) {
        setSteps((stepsResp as { steps: Step[] }).steps);
      }
    } catch {
      // Background may not be ready
    }
  }, [tabId]);

  // Refresh on mount + listen for state broadcasts from background
  useEffect(() => {
    if (!tabId) return;
    void refresh();

    const handler = (msg: unknown) => {
      const m = msg as RecorderPopupMessage;
      if (m.type === 'aitomate:recorder:state-change' && m.tabId === tabId && mounted.current) {
        setRecorderState(m.state);
        void refresh();
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => {
      browser.runtime.onMessage.removeListener(handler);
    };
  }, [tabId, refresh]);

  // Load an already-imported scenario for editing
  useEffect(() => {
    if (!editScenarioId || !tabId) return;
    let cancelled = false;
    void getScenarioById(editScenarioId).then(async (entry) => {
      if (!entry || cancelled) return;
      await browser.runtime.sendMessage({
        type: 'aitomate:recorder:set-steps',
        tabId,
        steps: entry.scenario.steps,
      } as RecorderCommand);
      if (cancelled) return;
      setSteps(entry.scenario.steps);
      setScenarioName(entry.scenario.meta.name);
      setScenarioDesc(entry.scenario.meta.description ?? '');
      setScenarioBaseUrl(entry.scenario.meta.baseUrl ?? '');
      setScenarioSlug(effectiveSlug(entry.scenario));
      slugTouched.current = true;
      setScenarioTags(entry.scenario.meta.tags.join(', '));
      setDetailsOpen(true);
      onEditConsumed?.();
    });
    return () => {
      cancelled = true;
    };
  }, [editScenarioId, tabId, onEditConsumed]);

  const sendCmd = useCallback(
    (type: 'aitomate:recorder:start' | 'aitomate:recorder:stop' | 'aitomate:recorder:resume') => {
      if (!tabId) return;
      void browser.runtime
        .sendMessage({ type, tabId } as RecorderCommand)
        .then(() => refresh());
    },
    [tabId, refresh],
  );

  const startRecording = useCallback(() => sendCmd('aitomate:recorder:start'), [sendCmd]);
  const stopRecording = useCallback(() => sendCmd('aitomate:recorder:stop'), [sendCmd]);
  const resumeRecording = useCallback(() => sendCmd('aitomate:recorder:resume'), [sendCmd]);

  const deleteStep = useCallback(
    (index: number) => {
      if (!tabId) return;
      const next = steps.filter((_, i) => i !== index);
      setSteps(next);
      void browser.runtime.sendMessage({
        type: 'aitomate:recorder:set-steps',
        tabId,
        steps: next,
      } as RecorderCommand);
    },
    [tabId, steps],
  );

  const updateStep = useCallback(
    (index: number, patch: Partial<Step>) => {
      if (!tabId) return;
      const step = steps[index];
      if (!step) return;
      const updated = { ...step, ...patch } as Step;
      const next = [...steps];
      next[index] = updated;
      setSteps(next);
      void browser.runtime.sendMessage({
        type: 'aitomate:recorder:update-step',
        tabId,
        stepId: step.id,
        patch,
      } as RecorderCommand);
    },
    [tabId, steps],
  );

  const moveStep = useCallback(
    (from: number, to: number) => {
      if (!tabId) return;
      const next = [...steps];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      setSteps(next);
      void browser.runtime.sendMessage({
        type: 'aitomate:recorder:set-steps',
        tabId,
        steps: next,
      } as RecorderCommand);
    },
    [tabId, steps],
  );

  const addStep = useCallback(
    (action: ManualStepAction) => {
      if (!tabId) return;
      const step = buildManualStep(action, crypto.randomUUID());
      const next = [...steps, step];
      setSteps(next);
      void browser.runtime.sendMessage({
        type: 'aitomate:recorder:set-steps',
        tabId,
        steps: next,
      } as RecorderCommand);
    },
    [tabId, steps],
  );

  const handleLocate = useCallback(
    async (index: number) => {
      const step = steps[index];
      if (!step) return;
      const sel = stepSelector(step);
      if (!sel) return;
      setLocateError('');
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          setLocateError('No active tab found. Open the page first.');
          return;
        }
        const response = (await browser.tabs.sendMessage(tab.id, {
          type: 'aitomate:runner:locate-element',
          selector: sel,
        } satisfies RunnerContentCommand)) as RunnerContentEvent | undefined;
        if (response?.type === 'aitomate:runner:element-located' && !response.found) {
          setLocateError(response.error ?? 'Element not found on this page.');
        }
      } catch {
        setLocateError('Could not reach the page — open/reload it and try again.');
      }
    },
    [steps],
  );

  const selectMode = (next: BuildMode) => {
    setMode(next);
    void setUiPref('buildMode', next);
  };

  const handleExport = useCallback(() => {
    if (steps.length === 0) return;
    const incomplete = findIncompleteStep(steps);
    if (incomplete) {
      setIncompleteError(incomplete.message);
      return;
    }
    setIncompleteError('');
    const meta: ExportMeta = {
      name: scenarioName.trim() || undefined,
      description: scenarioDesc.trim() || undefined,
      baseUrl: scenarioBaseUrl.trim() || undefined,
      slug: scenarioSlug.trim() || undefined,
      tags: scenarioTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    const json = buildScenarioJson(steps, meta);
    const name = scenarioName.trim() || 'scenario';
    downloadJson(json, name);
  }, [steps, scenarioName, scenarioDesc, scenarioBaseUrl, scenarioSlug, scenarioTags]);

  const handleSave = useCallback(async () => {
    if (steps.length === 0) return;
    const incomplete = findIncompleteStep(steps);
    if (incomplete) {
      setIncompleteError(incomplete.message);
      return;
    }
    setIncompleteError('');
    const name = scenarioName.trim() || 'Untitled Scenario';
    const meta: ExportMeta = {
      name,
      description: scenarioDesc.trim() || undefined,
      baseUrl: scenarioBaseUrl.trim() || undefined,
      slug: scenarioSlug.trim() || undefined,
      tags: scenarioTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setSaveStatus('saving');
    try {
      const scenario = buildScenarioObject(steps, meta);
      const result = await saveScenarioDeduped(scenario, (existingName) =>
        window.confirm(
          `A scenario with the same slug already exists ("${existingName}"). Overwrite it?`,
        ),
      );
      if (!result.ok) {
        setSaveStatus('duplicate');
        setTimeout(() => {
          setSaveStatus((s) => (s === 'duplicate' ? null : s));
        }, 3000);
        return;
      }
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus((s) => (s === 'saved' ? null : s));
      }, 3000);
    } catch {
      setSaveStatus('error');
    }
  }, [steps, scenarioName, scenarioDesc, scenarioBaseUrl, scenarioSlug, scenarioTags]);

  if (!tabId) {
    return (
      <div className="ait-card" style={{ textAlign: 'center', padding: 24 }}>
        <IconAlert size={24} color="var(--status-warning)" />
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
          Open a web page in Chrome to start building test scenarios.
        </p>
      </div>
    );
  }

  return (
    <section>
      {/* Mode Switcher Segment Controls */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-surface)',
          padding: 3,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          marginBottom: 12,
        }}
      >
        {(['simple', 'advanced'] as const).map((m) => {
          const isActive = mode === m;
          return (
            <button
              key={m}
              onClick={() => selectMode(m)}
              aria-pressed={isActive}
              style={{
                flex: 1,
                padding: '5px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--accent-gradient)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isActive ? '0 2px 8px rgba(99, 102, 241, 0.25)' : 'none',
              }}
            >
              {m === 'simple' ? 'Simple View' : 'Advanced View'}
            </button>
          );
        })}
      </div>

      <RecordingControls
        state={recorderState}
        onStart={startRecording}
        onStop={stopRecording}
        onResume={resumeRecording}
      />

      <StepList
        steps={steps}
        advanced={mode === 'advanced'}
        onUpdate={updateStep}
        onDelete={deleteStep}
        onMove={moveStep}
        onAdd={addStep}
        onLocate={handleLocate}
      />

      {locateError && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'var(--status-error-bg)',
            border: '1px solid var(--status-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--status-error)',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconAlert size={14} color="var(--status-error)" />
          <span>{locateError}</span>
        </div>
      )}

      {/* Save & Metadata Section */}
      {steps.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="ait-btn ait-btn-ghost"
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '6px 4px',
              fontSize: 11,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconSparkles size={13} color="var(--accent-primary)" />
              <span style={{ fontWeight: 600 }}>Save & Export Options</span>
              <span className="ait-badge ait-badge-muted" style={{ fontSize: 9 }}>
                {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              </span>
            </div>
            {detailsOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>

          {detailsOpen && (
            <div
              className="ait-card animate-fade-in"
              style={{ marginTop: 6, padding: 12, background: 'var(--bg-surface)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>SCENARIO NAME</label>
                  <input
                    value={scenarioName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setScenarioName(value);
                      if (!slugTouched.current) setScenarioSlug(slugify(value));
                    }}
                    placeholder="e.g. Guest Checkout Flow"
                    className="ait-input"
                    style={{ marginTop: 2 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>SLUG (DEDUPE ID)</label>
                  <input
                    value={scenarioSlug}
                    onChange={(e) => {
                      slugTouched.current = true;
                      setScenarioSlug(e.target.value);
                    }}
                    placeholder="guest-checkout-flow"
                    className="ait-input"
                    style={{ marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>DESCRIPTION (OPTIONAL)</label>
                  <input
                    value={scenarioDesc}
                    onChange={(e) => setScenarioDesc(e.target.value)}
                    placeholder="Brief summary of what this scenario tests"
                    className="ait-input"
                    style={{ marginTop: 2 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>BASE URL (OPTIONAL)</label>
                  <input
                    value={scenarioBaseUrl}
                    onChange={(e) => setScenarioBaseUrl(e.target.value)}
                    placeholder="e.g. {{BASE_URL}} or https://app.test"
                    className="ait-input"
                    style={{ marginTop: 2 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>TAGS (COMMA SEPARATED)</label>
                  <input
                    value={scenarioTags}
                    onChange={(e) => setScenarioTags(e.target.value)}
                    placeholder="checkout, guest, critical"
                    className="ait-input"
                    style={{ marginTop: 2 }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={handleSave}
                    disabled={saveStatus === 'saving'}
                    className="ait-btn ait-btn-primary ait-btn-sm"
                    style={{
                      background: saveStatus === 'saved' ? 'var(--status-success)' : undefined,
                    }}
                  >
                    {saveStatus === 'saved' ? <IconCheck size={13} /> : <IconSave size={13} />}
                    <span>
                      {saveStatus === 'saving'
                        ? 'Saving…'
                        : saveStatus === 'saved'
                          ? 'Saved ✓'
                          : 'Save to Library'}
                    </span>
                  </button>

                  <button onClick={handleExport} className="ait-btn ait-btn-secondary ait-btn-sm">
                    <IconDownload size={13} />
                    <span>Export JSON</span>
                  </button>
                </div>

                {saveStatus === 'error' && (
                  <p style={{ fontSize: 11, color: 'var(--status-error)', margin: '4px 0 0' }}>
                    Failed to save scenario. Try again.
                  </p>
                )}
                {saveStatus === 'duplicate' && (
                  <p style={{ fontSize: 11, color: 'var(--status-warning)', margin: '4px 0 0' }}>
                    Not saved — a scenario with that slug already exists.
                  </p>
                )}
                {incompleteError && (
                  <p style={{ fontSize: 11, color: 'var(--status-error)', margin: '4px 0 0' }}>
                    {incompleteError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
