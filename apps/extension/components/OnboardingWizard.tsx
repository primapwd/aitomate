import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  importScenario,
  pickFile,
  saveScenario,
  type StoredScenario,
} from '@/lib/import-export';
import {
  initialOnboardingState,
  reduceOnboarding,
  scenarioNeedsConfig,
  type OnboardingState,
} from '@/lib/onboarding';

const STORAGE_KEY = 'aitomate:onboarding';

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const [state, setState] = useState<OnboardingState>(initialOnboardingState);
  const [error, setError] = useState('');
  // Owns its own visibility end-to-end (mount check + hide-on-complete) so
  // the parent view doesn't need a second, independently-racing read of the
  // same storage key just to decide whether to render this component.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const val = await browser.storage.local.get(STORAGE_KEY);
      if (!val[STORAGE_KEY]) setVisible(true);
    })();
  }, []);

  const persistComplete = useCallback(async () => {
    await browser.storage.local.set({ [STORAGE_KEY]: true });
    setVisible(false);
    onComplete();
  }, [onComplete]);

  const dispatch = useCallback(
    (event: Parameters<typeof reduceOnboarding>[1]) => {
      const next = reduceOnboarding(state, event);
      setState(next);
      if (next.status === 'complete') void persistComplete();
    },
    [state, persistComplete],
  );

  const handleStart = useCallback(() => dispatch({ type: 'START' }), [dispatch]);

  const handleSkip = useCallback(() => dispatch({ type: 'SKIP' }), [dispatch]);

  const handleImportScenario = useCallback(async () => {
    setError('');
    try {
      const raw = await pickFile();
      const result = importScenario(raw);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await saveScenario(result.scenario);
      const needsConfig = scenarioNeedsConfig(result.scenario);
      dispatch({ type: 'SCENARIO_IMPORTED', needsConfig });
    } catch (err) {
      setError(String(err));
    }
  }, [dispatch]);

  const handleConfigDone = useCallback(() => {
    dispatch({ type: 'CONFIG_IMPORTED' });
  }, [dispatch]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 32, maxWidth: 400, width: '90%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }}>
        {state.status === 'welcome' && (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>Welcome to Aitomate</h2>
            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.5, margin: '0 0 16px' }}>
              Collaborative, AI-assisted test automation for your web app. Get started by importing a scenario file, then run it with one click.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} style={skipBtn}>Skip</button>
              <button onClick={handleStart} style={primaryBtn}>Get Started</button>
            </div>
          </>
        )}

        {state.status === 'import-scenario' && (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>Import a Scenario</h2>
            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.5, margin: '0 0 12px' }}>
              Pick a <code>.aitomate.json</code> file from your computer.
            </p>
            {error && <p style={{ fontSize: 11, color: '#c33', marginBottom: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} style={skipBtn}>Skip</button>
              <button onClick={handleImportScenario} style={primaryBtn}>Choose File…</button>
            </div>
          </>
        )}

        {state.status === 'import-config' && (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>Configuration Needed</h2>
            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.5, margin: '0 0 12px' }}>
              This scenario uses AI or database features. Open Settings to configure your LLM provider or database connector, then come back.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} style={skipBtn}>Skip</button>
              <button onClick={handleConfigDone} style={primaryBtn}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  fontSize: 13, padding: '6px 14px', border: 'none', borderRadius: 6,
  background: '#1a1a1a', color: '#fff', cursor: 'pointer',
};

const skipBtn: React.CSSProperties = {
  fontSize: 13, padding: '6px 14px', border: '1px solid #ccc', borderRadius: 6,
  background: '#fff', color: '#666', cursor: 'pointer',
};
