import type { Step } from '@aitomate/schema';
import { MANUAL_STEP_ACTIONS, type ManualStepAction } from '@/lib/build/manual-step';
import StepCard from './StepCard';

interface Props {
  steps: Step[];
  advanced?: boolean;
  onUpdate: (index: number, patch: Partial<Step>) => void;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (action: ManualStepAction) => void;
}

const ACTION_LABELS: Record<ManualStepAction, string> = {
  click: 'Click',
  fill: 'Fill',
  navigate: 'Navigate',
  wait: 'Wait',
  assert: 'Assert',
};

export default function StepList({ steps, advanced, onUpdate, onDelete, onMove, onAdd }: Props) {
  return (
    <div>
      {steps.length === 0 && (
        <p style={{ fontSize: 12, color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
          No steps yet. Click Record and interact with the page{advanced ? ', or add one manually below' : ''}.
        </p>
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
        />
      ))}

      {/* Manual step insertion needs raw selector/URL editing to be usable,
          which only Advanced mode exposes (Constitution: Simple mode never
          shows raw selector syntax) — a step added blank in Simple mode would
          have no way to be completed. */}
      {advanced && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {MANUAL_STEP_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => onAdd(action)}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                border: '1px dashed #ccc',
                borderRadius: 6,
                background: '#fff',
                color: '#666',
                cursor: 'pointer',
                flex: 1,
                minWidth: 50,
              }}
            >
              + {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
