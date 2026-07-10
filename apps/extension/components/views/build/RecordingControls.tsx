import type { RecorderSessionState } from '@/lib/recorder/session';

interface Props {
  state: RecorderSessionState;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
}

export default function RecordingControls({ state, onStart, onStop, onResume }: Props) {
  const isBusy = state.status === 'recording' || state.status === 'paused';

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {state.status === 'idle' && (
        <button onClick={onStart} style={btnActive}>
          ● Record
        </button>
      )}
      {state.status === 'recording' && (
        <button onClick={onStop} style={btnDanger}>
          ■ Stop
        </button>
      )}
      {state.status === 'paused' && (
        <>
          <button onClick={onResume} style={btnActive}>
            ▶ Resume
          </button>
          <button onClick={onStop} style={btnDanger}>
            ■ Stop
          </button>
        </>
      )}
      <span style={{ fontSize: 11, color: '#888', marginLeft: 4, alignSelf: 'center' }}>
        {state.status === 'recording'
          ? 'Recording… interact with the page'
          : state.status === 'paused'
            ? state.pauseReason === 'origin-change'
              ? 'Paused — navigation to different origin'
              : state.pauseReason === 'new-tab'
                ? 'Paused — a new tab was opened'
                : 'Paused'
            : 'Click Record to start'}
      </span>
    </div>
  );
}

const baseBtn: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const btnActive: React.CSSProperties = { ...baseBtn, background: '#e03a3a', color: '#fff' };
const btnDanger: React.CSSProperties = { ...baseBtn, background: '#333', color: '#fff' };
