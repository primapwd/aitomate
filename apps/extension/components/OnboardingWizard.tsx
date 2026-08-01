import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  importScenario,
  pickFile,
  saveScenarioDeduped,
} from '@/lib/import-export';
import {
  initialOnboardingState,
  reduceOnboarding,
  scenarioNeedsConfig,
  type OnboardingState,
} from '@/lib/onboarding';
import { IconAitomateLogo, IconAlert, IconCheck, IconSparkles, IconUpload } from './ui/icons';

const STORAGE_KEY = 'aitomate:onboarding';

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const [state, setState] = useState<OnboardingState>(initialOnboardingState);
  const [error, setError] = useState('');
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
      const saved = await saveScenarioDeduped(result.scenario, (existingName) =>
        window.confirm(
          `A scenario with the same slug already exists ("${existingName}"). Overwrite it?`,
        ),
      );
      if (!saved.ok) {
        setError('Import cancelled — a scenario with the same slug already exists.');
        return;
      }
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(8px)',
        padding: 16,
      }}
    >
      <div
        className="ait-card animate-fade-in"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          maxWidth: 380,
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {state.status === 'welcome' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <IconAitomateLogo size={32} />
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>
                  Welcome to Aitomate
                </h2>
                <span style={{ fontSize: 11, color: 'var(--accent-primary)' }}>
                  Collaborative AI Test Automation
                </span>
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 18px' }}>
              Aitomate lets developers, QA, and product managers record and run automated UI test scenarios right in the browser. Zero-setup baseline for static tests!
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} className="ait-btn ait-btn-ghost">
                Skip
              </button>
              <button onClick={handleStart} className="ait-btn ait-btn-primary">
                <IconSparkles size={14} />
                <span>Get Started</span>
              </button>
            </div>
          </>
        )}

        {state.status === 'import-scenario' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <IconUpload size={20} color="var(--accent-primary)" />
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                Import Your First Scenario
              </h2>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px' }}>
              Select a <code>.aitomate.json</code> scenario file from your computer to add it to your test library.
            </p>

            {error && (
              <div
                style={{
                  padding: '6px 10px',
                  background: 'var(--status-error-bg)',
                  border: '1px solid var(--status-error-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--status-error)',
                  fontSize: 11,
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <IconAlert size={14} color="var(--status-error)" />
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} className="ait-btn ait-btn-ghost">
                Skip
              </button>
              <button onClick={handleImportScenario} className="ait-btn ait-btn-primary">
                <IconUpload size={14} />
                <span>Choose File…</span>
              </button>
            </div>
          </>
        )}

        {state.status === 'import-config' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <IconSparkles size={20} color="var(--status-warning)" />
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                Configuration Needed
              </h2>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px' }}>
              This scenario uses AI or database value resolvers. You can configure your LLM provider or database connector in Settings.
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleSkip} className="ait-btn ait-btn-ghost">
                Skip
              </button>
              <button onClick={handleConfigDone} className="ait-btn ait-btn-primary">
                <IconCheck size={14} />
                <span>Got It</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
