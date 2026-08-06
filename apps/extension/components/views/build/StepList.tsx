import type { Step } from '@aitomate/schema';
import { MANUAL_STEP_ACTIONS, type ManualStepAction } from '@/lib/build/manual-step';
import { stepSelector } from '@/lib/runner/dom';
import StepCard from './StepCard';
import { IconAssert, IconClick, IconCode, IconFill, IconNavigate, IconPlus, IconWait } from '@/components/ui/icons';

interface Props {
  steps: Step[];
  advanced?: boolean;
  onUpdate: (index: number, patch: Partial<Step>) => void;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (action: ManualStepAction) => void;
  onLocate?: (index: number) => void;
  onPick?: (index: number) => void;
  onCancelPick?: () => void;
  pickingIndex?: number | null;
}

const ACTION_ICONS: Record<ManualStepAction, React.ReactNode> = {
  click: <IconClick size={12} />,
  fill: <IconFill size={12} />,
  navigate: <IconNavigate size={12} />,
  wait: <IconWait size={12} />,
  assert: <IconAssert size={12} />,
};

const ACTION_LABELS: Record<ManualStepAction, string> = {
  click: 'Click',
  fill: 'Fill',
  navigate: 'Navigate',
  wait: 'Wait',
  assert: 'Assert',
};

export default function StepList({
  steps,
  advanced,
  onUpdate,
  onDelete,
  onMove,
  onAdd,
  onLocate,
  onPick,
  onCancelPick,
  pickingIndex,
}: Props) {
  return (
    <div>
      {steps.length === 0 && (
        <div
          className="ait-card"
          style={{
            textAlign: 'center',
            padding: '24px 16px',
            background: 'var(--bg-surface)',
            borderStyle: 'dashed',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.12)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
              color: 'var(--accent-primary)',
            }}
          >
            <IconCode size={18} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            No steps in scenario
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 260, margin: '0 auto' }}>
            Click <strong style={{ color: '#ef4444' }}>Record</strong> above to capture page interactions{advanced ? ', or add steps manually using the buttons below' : ''}.
          </div>
        </div>
      )}

      {steps.map((step, i) => (
        <StepCard
          key={step.id}
          step={step}
          index={i}
          advanced={advanced}
          onDelete={() => onDelete(i)}
          onUpdate={(patch) => onUpdate(i, patch)}
          onMoveUp={i > 0 ? () => onMove(i, i - 1) : null}
          onMoveDown={i < steps.length - 1 ? () => onMove(i, i + 1) : null}
          onLocate={onLocate && stepSelector(step) ? () => onLocate(i) : undefined}
          onPick={onPick && stepSelector(step) ? () => onPick(i) : undefined}
          picking={pickingIndex === i}
          onCancelPick={onCancelPick}
        />
      ))}

      {/* Manual step insertion in Advanced mode */}
      {advanced && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 6,
            }}
          >
            Add Step Manually
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MANUAL_STEP_ACTIONS.map((action) => (
              <button
                key={action}
                onClick={() => onAdd(action)}
                className="ait-btn ait-btn-secondary ait-btn-sm"
                style={{
                  flex: 1,
                  minWidth: 60,
                  fontSize: 11,
                  padding: '5px 8px',
                  borderStyle: 'dashed',
                }}
              >
                <IconPlus size={11} />
                {ACTION_ICONS[action]}
                <span>{ACTION_LABELS[action]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
