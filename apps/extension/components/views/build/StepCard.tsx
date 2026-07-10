import type { Step } from '@aitomate/schema';

interface Props {
  step: Step;
  index: number;
  advanced?: boolean;
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}

export default function StepCard({
  step,
  index,
  advanced,
  onDelete,
  onUpdate,
  onMoveUp,
  onMoveDown,
}: Props) {
  const description = describeStep(step, advanced ?? false);

  return (
    <div
      style={{
        padding: '8px 10px',
        marginBottom: 6,
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            color: '#999',
            minWidth: 18,
            marginTop: 2,
            textAlign: 'center',
          }}
        >
          {index + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StepIcon action={step.action} />
          <span style={{ fontSize: 12, color: '#333', marginLeft: 4 }}>
            {description}
          </span>
          {advanced && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
              <code style={{ fontSize: 10 }}>{step.id}</code>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {onMoveUp && (
            <MiniBtn onClick={onMoveUp} label="Move up" symbol="↑" />
          )}
          {onMoveDown && (
            <MiniBtn onClick={onMoveDown} label="Move down" symbol="↓" />
          )}
          <MiniBtn onClick={onDelete} label="Delete step" symbol="✕" danger />
        </div>
      </div>

      {/* Editing static values is Simple-mode scope per spec T2.6. */}
      {step.action === 'fill' && step.resolver.type === 'static' && (
        <div style={{ marginTop: 6, paddingLeft: 26 }}>
          <input
            value={String(step.resolver.value)}
            onChange={(e) =>
              onUpdate({ resolver: { type: 'static', value: e.target.value } })
            }
            style={inputStyle}
            placeholder="Static value"
          />
        </div>
      )}

      {advanced && step.action === 'navigate' && (
        <div style={{ marginTop: 6, paddingLeft: 26 }}>
          <input
            value={step.url}
            onChange={(e) => onUpdate({ url: e.target.value })}
            style={inputStyle}
            placeholder="URL or path"
          />
        </div>
      )}

      {advanced && step.action === 'wait' && (
        <div style={{ marginTop: 6, paddingLeft: 26 }}>
          {step.durationMs !== undefined && (
            <label style={{ fontSize: 11, color: '#666' }}>
              Duration: {step.durationMs}ms
            </label>
          )}
          {step.forSelector && (
            <div style={{ fontSize: 11, color: '#666' }}>
              Wait for element: {selectorLabel(step.forSelector, true)}
            </div>
          )}
        </div>
      )}

      {advanced && (
        <div style={{ marginTop: 4, paddingLeft: 26 }}>
          <label style={{ fontSize: 10, color: '#aaa' }}>
            Timeout:
            <input
              type="number"
              value={step.options?.timeoutMs ?? ''}
              onChange={(e) =>
                onUpdate({
                  options: {
                    ...(step.options ?? {}),
                    timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
              style={{ ...inputStyle, width: 70, marginLeft: 4 }}
              placeholder="30000"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function StepIcon({ action }: { action: string }) {
  const icons: Record<string, string> = {
    navigate: '↗',
    click: '👆',
    fill: '✏️',
    keypress: '⌨',
    wait: '⏳',
    upload: '📎',
    assert: '✓',
  };
  return <span style={{ fontSize: 12 }}>{icons[action] ?? '?'}</span>;
}

function describeStep(step: Step, advanced: boolean): string {
  const label = (sel: { strategy: string; value: string }) => selectorLabel(sel, advanced);
  switch (step.action) {
    case 'navigate':
      return `Navigate to ${step.url}`;
    case 'click':
      return `Click ${label(step.selector)}`;
    case 'fill':
      if (step.resolver.type === 'static')
        return `Fill ${label(step.selector)} with "${String(step.resolver.value)}"`;
      return `Fill ${label(step.selector)} («${step.resolver.type}» resolver)`;
    case 'keypress':
      return step.selector
        ? `Press ${step.key} on ${label(step.selector)}`
        : `Press ${step.key}`;
    case 'wait':
      if (step.durationMs) return `Wait ${step.durationMs}ms`;
      if (step.forSelector) return `Wait for ${label(step.forSelector)}`;
      return 'Wait';
    case 'upload':
      return `Upload "${step.fixtureRef}" to ${label(step.selector)}`;
    case 'assert':
      return `Assert: ${assertionDescription(step, advanced)}`;
    default:
      return (step as { action: string }).action;
  }
}

function assertionDescription(
  step: Step & { action: 'assert' },
  advanced: boolean,
): string {
  const label = (sel: { strategy: string; value: string }) => selectorLabel(sel, advanced);
  switch (step.assertion) {
    case 'elementVisible':
      return `element ${label(step.selector)} is visible`;
    case 'elementNotVisible':
      return `element ${label(step.selector)} is hidden`;
    case 'textContains':
      return `"${label(step.selector)}" contains "${step.value}"`;
    case 'textEquals':
      return `"${label(step.selector)}" equals "${step.value}"`;
    case 'inputValue':
      return `input ${label(step.selector)} value = "${step.value}"`;
    case 'urlMatches':
      return `URL matches ${step.patternType ?? 'glob'} "${step.pattern}"`;
    case 'elementCount':
      return `${label(step.selector)} count ${step.comparator} ${step.count}`;
    case 'elementEnabled':
      return `${label(step.selector)} is enabled`;
    case 'elementDisabled':
      return `${label(step.selector)} is disabled`;
    default:
      return (step as { assertion: string }).assertion;
  }
}

/**
 * Simple mode is for POs/QAs — never show raw selector syntax there
 * (Constitution: plain language). Advanced mode shows the full selector.
 */
function selectorLabel(sel: { strategy: string; value: string }, advanced: boolean): string {
  return advanced ? `${sel.strategy}="${sel.value}"` : `"${sel.value}"`;
}

function MiniBtn({
  onClick,
  label,
  symbol,
  danger,
}: {
  onClick: () => void;
  label: string;
  symbol: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        fontSize: 11,
        padding: '2px 5px',
        border: '1px solid #ddd',
        borderRadius: 4,
        background: danger ? '#fee' : '#fff',
        color: danger ? '#c33' : '#666',
        cursor: 'pointer',
        lineHeight: 1,
      }}
    >
      {symbol}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 6px',
  border: '1px solid #ddd',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
};
