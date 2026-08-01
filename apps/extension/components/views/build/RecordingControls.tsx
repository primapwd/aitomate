import type { RecorderSessionState } from '@/lib/recorder/session';
import { IconPause, IconPlay, IconRecord, IconSquare } from '@/components/ui/icons';

interface Props {
  state: RecorderSessionState;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
}

export default function RecordingControls({ state, onStart, onStop, onResume }: Props) {
  const isRecording = state.status === 'recording';
  const isPaused = state.status === 'paused';

  return (
    <div
      className="ait-card"
      style={{
        padding: '12px 14px',
        marginBottom: 14,
        background: isRecording
          ? 'linear-gradient(135deg, rgba(244, 63, 94, 0.12) 0%, rgba(19, 25, 36, 0.9) 100%)'
          : isPaused
            ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(19, 25, 36, 0.9) 100%)'
            : 'var(--bg-card)',
        borderColor: isRecording
          ? 'rgba(244, 63, 94, 0.4)'
          : isPaused
            ? 'rgba(245, 158, 11, 0.4)'
            : 'var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {state.status === 'idle' && (
            <button
              onClick={onStart}
              className="ait-btn ait-btn-danger"
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#fff',
                boxShadow: '0 2px 10px rgba(239, 68, 68, 0.35)',
              }}
            >
              <IconRecord size={14} color="#fff" />
              <span>Record</span>
            </button>
          )}

          {isRecording && (
            <button
              onClick={onStop}
              className="ait-btn ait-btn-secondary"
              style={{ background: '#1f2937', color: '#f3f4f6', borderColor: 'rgba(255,255,255,0.15)' }}
            >
              <IconSquare size={13} color="#f43f5e" />
              <span>Stop Recording</span>
            </button>
          )}

          {isPaused && (
            <>
              <button
                onClick={onResume}
                className="ait-btn ait-btn-primary"
                style={{ padding: '6px 12px' }}
              >
                <IconPlay size={13} color="#fff" />
                <span>Resume</span>
              </button>
              <button
                onClick={onStop}
                className="ait-btn ait-btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                <IconSquare size={13} color="#f43f5e" />
                <span>Stop</span>
              </button>
            </>
          )}
        </div>

        {/* Status indicator & badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isRecording && (
            <span
              className="pulse-recording"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#f43f5e',
                display: 'inline-block',
              }}
            />
          )}

          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: isRecording ? '#f43f5e' : isPaused ? '#f59e0b' : 'var(--text-muted)',
              textAlign: 'right',
            }}
          >
            {isRecording
              ? 'Recording actions...'
              : isPaused
                ? state.pauseReason === 'origin-change'
                  ? 'Paused (New origin)'
                  : state.pauseReason === 'new-tab'
                    ? 'Paused (New tab)'
                    : 'Paused'
                : 'Ready to record'}
          </span>
        </div>
      </div>
    </div>
  );
}
