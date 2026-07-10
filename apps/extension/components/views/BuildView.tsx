import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Step } from '@aitomate/schema';
import type { RecorderCommand, RecorderPopupMessage } from '@/lib/recorder/messages';
import { initialSessionState, type RecorderSessionState } from '@/lib/recorder/session';
import { getUiPrefs, setUiPref, type UiPrefs } from '@/lib/ui-prefs';
import RecordingControls from './build/RecordingControls';
import StepList from './build/StepList';

type BuildMode = UiPrefs['buildMode'];

export default function BuildView() {
  const [mode, setMode] = useState<BuildMode>('simple');
  const [tabId, setTabId] = useState<number | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderSessionState>(initialSessionState);
  const [steps, setSteps] = useState<Step[]>([]);
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

  const selectMode = (next: BuildMode) => {
    setMode(next);
    void setUiPref('buildMode', next);
  };

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
      />

      {steps.length > 0 && (
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'center' }}>
          {steps.length} step{steps.length === 1 ? '' : 's'} recorded
        </div>
      )}
    </section>
  );
}
