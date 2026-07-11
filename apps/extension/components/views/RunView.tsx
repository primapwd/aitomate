import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  deleteScenario,
  importScenario,
  listScenarios,
  pickFile,
  saveScenario,
  type StoredScenario,
} from '@/lib/import-export';
import type { RunnerCommand, RunnerStateMessage } from '@/lib/runner/messages';

export default function RunView() {
  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [importError, setImportError] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runTabId, setRunTabId] = useState<number | null>(null);

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
      const m = msg as RunnerStateMessage;
      if (m.type !== 'aitomate:runner:state' || m.tabId !== runTabId) return;
      if (m.state.status === 'done' || m.state.status === 'error' || m.state.status === 'idle') {
        setRunningId(null);
        setRunTabId(null);
        if (m.state.status === 'error') {
          setImportError(m.state.error ?? 'The run failed.');
        }
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => {
      browser.runtime.onMessage.removeListener(handler);
    };
  }, [runTabId]);

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
        // Fire and forget — the runner loop runs in the background.
        await browser.runtime.sendMessage({
          type: 'aitomate:runner:play',
          tabId: tab.id,
          scenario: entry.scenario,
        } as RunnerCommand);
      } catch (err) {
        setImportError(String(err));
        setRunningId(null);
        setRunTabId(null);
      }
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteScenario(id);
      await refresh();
    },
    [refresh],
  );

  return (
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
        </div>
      )}
    </section>
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
