import { useEffect, useState } from 'react';
import { getUiPrefs, setUiPref, type UiPrefs } from '@/lib/ui-prefs';

type BuildMode = UiPrefs['buildMode'];

export default function BuildView() {
  const [mode, setMode] = useState<BuildMode>('simple');

  useEffect(() => {
    let cancelled = false;
    getUiPrefs().then((prefs) => {
      if (!cancelled) setMode(prefs.buildMode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectMode = (next: BuildMode) => {
    setMode(next);
    void setUiPref('buildMode', next);
  };

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

      {mode === 'simple' ? (
        <p style={{ fontSize: 13, color: '#555' }}>
          Recorder + plain-language step list. Available to every persona —
          no raw selectors. Lands with the recorder in Phase 2 (T2.1, T2.6).
        </p>
      ) : (
        <p style={{ fontSize: 13, color: '#555' }}>
          Full step editor: selector picker, resolver config (static /
          dynamic / AI / database), session-marker config, plugin manager.
          Developer surface — lands with T2.6.
        </p>
      )}
    </section>
  );
}
