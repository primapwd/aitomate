import type { Step } from '@aitomate/schema';
import StepCard from './StepCard';

interface Props {
  steps: Step[];
  advanced?: boolean;
  onUpdate: (index: number, patch: Partial<Step>) => void;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

export default function StepList({ steps, advanced, onUpdate, onDelete, onMove }: Props) {
  if (steps.length === 0) {
    return (
      <p style={{ fontSize: 12, color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
        No steps recorded yet. Click Record and interact with the page.
      </p>
    );
  }

  return (
    <div>
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
    </div>
  );
}
