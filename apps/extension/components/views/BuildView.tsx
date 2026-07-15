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
  findIncompleteStep,
  findScenarioByName,
  upsertScenario,
  type ExportMeta,
} from '@/lib/import-export';
import { buildManualStep, type ManualStepAction } from '@/lib/build/manual-step';
import RecordingControls from './build/RecordingControls';
import StepList from './build/StepList';

type BuildMode = UiPrefs['buildMode'];

export default function BuildView() {
  const [mode, setMode] = useState<BuildMode>('simple');
  const [tabId, setTabId] = useState<number | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderSessionState>(initialSessionState);
  const [steps, setSteps] = useState<Step[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDesc, setScenarioDesc] = useState('');
  const [scenarioBaseUrl, setScenarioBaseUrl] = useState('');
  const [scenarioTags, setScenarioTags] = useState('');
  const [saveStatus, setSaveStatus] = useState<null | 'saving' | 'saved' | 'duplicate' | 'error'>(
    null,
  );
  const [incompleteError, setIncompleteError] = useState('');
  const mounted = useRef(true);

  // Load UI prefs + current tab on mount
  useEffect(() => {
    // Reset on every (re)mount — StrictMode runs mount→cleanup→mount, and the
    // ref would otherwise stay false after the first cleanup.
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
      // Only react to broadcasts about our own tab — a recording running in
      // another tab must not leak into this panel's state.
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
      tags: scenarioTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    const json = buildScenarioJson(steps, meta);
    const name = scenarioName.trim() || 'scenario';
    downloadJson(json, name);
  }, [steps, scenarioName, scenarioDesc, scenarioBaseUrl, scenarioTags]);

  const handleSave = useCallback(async () => {
    if (steps.length === 0) return;
    const incomplete = findIncompleteStep(steps);
    if (incomplete) {
      setIncompleteError(incomplete.message);
      return;
    }
    setIncompleteError('');
    const name = scenarioName.trim() || 'Untitled Scenario';
    // upsertScenario matches by name and silently overwrites — an unnamed
    // save collides with any prior unnamed save under the same default name.
    // Confirm before clobbering an existing library entry (fail loud, fail
    // clear: a green "Saved" checkmark must never hide a destroyed scenario).
    const existing = await findScenarioByName(name);
    if (existing) {
      const overwrite = window.confirm(
        `A scenario named "${name}" already exists in the library. Overwrite it?`,
      );
      if (!overwrite) {
        setSaveStatus('duplicate');
        setTimeout(() => {
          setSaveStatus((s) => (s === 'duplicate' ? null : s));
        }, 3000);
        return;
      }
    }

    setSaveStatus('saving');
    const meta: ExportMeta = {
      name,
      description: scenarioDesc.trim() || undefined,
      baseUrl: scenarioBaseUrl.trim() || undefined,
      tags: scenarioTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      const scenario = buildScenarioObject(steps, meta);
      await upsertScenario(scenario);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus((s) => (s === 'saved' ? null : s));
      }, 3000);
    } catch {
      setSaveStatus('error');
    }
  }, [steps, scenarioName, scenarioDesc, scenarioBaseUrl, scenarioTags]);

  if (!tabId) {
    return (
      <section>
        <p style={{ fontSize: 13, color: '#999' }}>Open a web page to start recording.</p>
      </section>
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['simple', 'advanced'] as const).map((m) => (
          <button
            key={m}
            onClick={() => selectMode(m)}
            aria-pressed={mode === m}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid ' + (mode === m ? '#1a1a1a' : '#ccc'),
              background: mode === m ? '#1a1a1a' : '#fff',
              color: mode === m ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {m === 'simple' ? 'Simple' : 'Advanced'}
          </button>
        ))}
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
      />

      {steps.length > 0 && (
        <>
          <details style={{ marginTop: 12 }}>
            <summary style={exportSummary}>Export scenario</summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="Scenario name"
                style={exportInput}
              />
              <input
                value={scenarioDesc}
                onChange={(e) => setScenarioDesc(e.target.value)}
                placeholder="Description (optional)"
                style={exportInput}
              />
              <input
                value={scenarioBaseUrl}
                onChange={(e) => setScenarioBaseUrl(e.target.value)}
                placeholder="Base URL (optional, e.g. https://app.test or {{BASE_URL}})"
                style={exportInput}
              />
              <input
                value={scenarioTags}
                onChange={(e) => setScenarioTags(e.target.value)}
                placeholder="Tags (comma-separated, optional)"
                style={exportInput}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                  style={{
                    ...exportBtn,
                    background: saveStatus === 'saved' ? '#2e7d32' : '#1a1a1a',
                    opacity: saveStatus === 'saving' ? 0.6 : 1,
                  }}
                >
                  {saveStatus === 'saving'
                    ? 'Saving…'
                    : saveStatus === 'saved'
                      ? 'Saved ✓'
                      : 'Save to library'}
                </button>
                <button onClick={handleExport} style={exportBtn}>
                  Export as .aitomate.json
                </button>
              </div>
              {saveStatus === 'error' && (
                <p style={{ fontSize: 11, color: '#d32f2f', margin: '4px 0 0' }}>
                  Failed to save. Try again.
                </p>
              )}
              {saveStatus === 'duplicate' && (
                <p style={{ fontSize: 11, color: '#999', margin: '4px 0 0' }}>
                  Not saved — a scenario with that name already exists.
                </p>
              )}
              {incompleteError && (
                <p style={{ fontSize: 11, color: '#d32f2f', margin: '4px 0 0' }}>
                  {incompleteError}
                </p>
              )}
            </div>
          </details>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 6, textAlign: 'center' }}>
            {steps.length} step{steps.length === 1 ? '' : 's'} recorded
          </div>
        </>
      )}
    </section>
  );
}

const exportSummary: React.CSSProperties = {
  fontSize: 12,
  color: '#555',
  cursor: 'pointer',
  padding: '4px 0',
};

const exportInput: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid #ddd',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
};

const exportBtn: React.CSSProperties = {
  fontSize: 12,
  padding: '5px 14px',
  border: '1px solid #1a1a1a',
  borderRadius: 6,
  background: '#1a1a1a',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
