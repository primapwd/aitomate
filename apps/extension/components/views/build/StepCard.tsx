import { useState } from 'react';
import type { Resolver, Selector, Step } from '@aitomate/schema';

interface Props {
  step: Step;
  index: number;
  advanced?: boolean;
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onLocate?: () => void;
}

export default function StepCard(props: Props) {
  const { step, index, advanced, onDelete, onUpdate, onMoveUp, onMoveDown, onLocate } = props;
  const description = describeStep(step, advanced ?? false);

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={num}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StepIcon action={step.action} />
          <span style={{ fontSize: 12, color: '#333', marginLeft: 4 }}>{description}</span>
          {advanced && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
              <code style={{ fontSize: 10 }}>{step.id}</code>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {onMoveUp && <MiniBtn onClick={onMoveUp} label="Move up" symbol="↑" />}
          {onMoveDown && <MiniBtn onClick={onMoveDown} label="Move down" symbol="↓" />}
          {onLocate && <MiniBtn onClick={onLocate} label="Locate on page" symbol="👁" />}
          <MiniBtn onClick={onDelete} label="Delete step" symbol="✕" danger />
        </div>
      </div>

      {/* === Inline editors === */}

      {/* Static fill value — Simple-mode scope per spec T2.6. In Advanced
          mode the ResolverEditor below already covers it. */}
      {!advanced && step.action === 'fill' && step.resolver.type === 'static' && (
        <FieldGroup>
          <InlineInput
            label="Value"
            value={String(step.resolver.value)}
            onChange={(v) => onUpdate({ resolver: { type: 'static', value: v } })}
            placeholder="Static value"
          />
        </FieldGroup>
      )}

      {/* Advanced-mode panels */}
      {advanced && (
        <>
          {/* Selector editor (any step with a selector) */}
          {'selector' in step && (
            <FieldGroup label="Selector">
              <SelectorEditor
                selector={step.selector as Selector}
                onChange={(sel) => onUpdate({ selector: sel } as Partial<Step>)}
              />
            </FieldGroup>
          )}

          {/* Resolver config (fill steps only) */}
          {step.action === 'fill' && (
            <FieldGroup label="Resolver">
              <ResolverEditor
                resolver={step.resolver}
                onChange={(res) => onUpdate({ resolver: res } as Partial<Step>)}
              />
            </FieldGroup>
          )}

          {/* Assertion editor (assert steps only) */}
          {step.action === 'assert' && (
            <FieldGroup label="Assertion">
              <AssertionEditor
                step={step}
                onChange={(patch) => onUpdate(patch)}
              />
            </FieldGroup>
          )}

          {/* URL editor */}
          {step.action === 'navigate' && (
            <FieldGroup label="URL">
              <InlineInput
                value={step.url}
                onChange={(v) => onUpdate({ url: v } as Partial<Step>)}
                placeholder="/path"
              />
            </FieldGroup>
          )}

          {/* Wait step details */}
          {step.action === 'wait' && (
            <FieldGroup>
              {!step.forSelector && (
                // Gated on `!forSelector` (which mode this wait step is in),
                // not on `durationMs !== undefined` — the old condition tied
                // the field's visibility to the very value it edits, so
                // clearing the number to '' set durationMs to undefined
                // (`Number('') || undefined`), which then hid the input
                // entirely with no way to type a new value back in.
                <InlineInput
                  label="Duration (ms)"
                  value={step.durationMs !== undefined ? String(step.durationMs) : ''}
                  onChange={(v) => onUpdate({ durationMs: Number(v) || undefined } as Partial<Step>)}
                />
              )}
              {step.forSelector && (
                <SelectorEditor
                  label="Wait for element"
                  selector={step.forSelector}
                  onChange={(sel) => onUpdate({ forSelector: sel } as Partial<Step>)}
                />
              )}
            </FieldGroup>
          )}

          {/* Fixture ref (upload steps) */}
          {step.action === 'upload' && (
            <FieldGroup label="Fixture">
              <InlineInput
                value={step.fixtureRef}
                onChange={(v) => onUpdate({ fixtureRef: v } as Partial<Step>)}
                placeholder="e.g. sample.pdf"
              />
            </FieldGroup>
          )}

          {/* Timeout + retry */}
          <FieldGroup label="Options">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <InlineInput
                label="Timeout (ms)"
                value={step.options?.timeoutMs !== undefined ? String(step.options.timeoutMs) : ''}
                onChange={(v) =>
                  onUpdate({
                    options: { ...(step.options ?? {}), timeoutMs: v ? Number(v) : undefined },
                  } as Partial<Step>)
                }
                placeholder="30000"
                compact
              />
              <InlineInput
                label="Retries"
                value={step.options?.retry?.count !== undefined ? String(step.options.retry.count) : ''}
                onChange={(v) =>
                  onUpdate({
                    options: {
                      ...(step.options ?? {}),
                      retry: v
                        ? { ...(step.options?.retry ?? {}), count: Number(v) }
                        : undefined,
                    },
                  } as Partial<Step>)
                }
                placeholder="3"
                compact
              />
            </div>
          </FieldGroup>
        </>
      )}
    </div>
  );
}

// ── Selector editor ──

const STRATEGIES = ['testid', 'id', 'aria', 'css', 'text'] as const;

function SelectorEditor({
  selector,
  onChange,
  label,
}: {
  selector: Selector;
  onChange: (sel: Selector) => void;
  label?: string;
}) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          value={selector.strategy}
          onChange={(e) => onChange({ ...selector, strategy: e.target.value as Selector['strategy'] })}
          style={selectStyle}
        >
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={selector.value}
          onChange={(e) => onChange({ ...selector, value: e.target.value })}
          style={fieldStyle}
          placeholder="value"
        />
      </div>
    </div>
  );
}

// ── Resolver editor ──

const RESOLVER_TYPES = [
  { type: 'static', label: 'Static' },
  { type: 'dynamic', mode: 'array', label: 'Dynamic — Array' },
  { type: 'dynamic', mode: 'ai', label: 'Dynamic — AI' },
  { type: 'database', label: 'Database' },
] as const;

function ResolverEditor({
  resolver,
  onChange,
}: {
  resolver: Resolver;
  onChange: (res: Resolver) => void;
}) {
  type ResShape = { type: string; mode?: string };
  const current = { type: resolver.type, mode: (resolver as ResShape).mode } as ResShape;

  // Determine active preset
  const activeIdx = RESOLVER_TYPES.findIndex(
    (r) => r.type === current.type && (r as ResShape).mode === current.mode,
  );
  const active = activeIdx >= 0 ? RESOLVER_TYPES[activeIdx] : RESOLVER_TYPES[0];

  return (
    <div>
      <select
        value={activeIdx >= 0 ? activeIdx : 0}
        onChange={(e) => {
          const selected = RESOLVER_TYPES[Number(e.target.value)];
          onChange(buildResolver(selected));
        }}
        style={selectStyle}
      >
        {RESOLVER_TYPES.map((r, i) => (
          <option key={i} value={i}>
            {r.label}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 6 }}>
        {active.type === 'static' && (
          <ResolverFields label="Value">
            <input
              value={String((resolver as { value: string | number | boolean }).value ?? '')}
              onChange={(e) => onChange({ type: 'static', value: e.target.value })}
              style={fieldStyle}
              placeholder="Value"
            />
          </ResolverFields>
        )}
        {active.type === 'dynamic' && active.mode === 'array' && (
          <ResolverFields label="Values (JSON array)">
            <JsonArrayInput
              values={(resolver as { values?: (string | number | boolean)[] }).values ?? []}
              onCommit={(values) =>
                onChange({
                  type: 'dynamic',
                  mode: 'array',
                  values,
                  order: (resolver as { order?: 'random' | 'sequential' }).order ?? 'random',
                })
              }
            />
            <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <input
                type="checkbox"
                checked={(resolver as { order?: string }).order === 'sequential'}
                onChange={(e) =>
                  onChange({
                    ...(resolver as object),
                    order: e.target.checked ? 'sequential' : 'random',
                  } as Resolver)
                }
              />
              Sequential
            </label>
          </ResolverFields>
        )}
        {active.type === 'dynamic' && active.mode === 'ai' && (
          <ResolverFields label="AI prompt">
            <textarea
              value={(resolver as { prompt: string }).prompt ?? ''}
              onChange={(e) =>
                onChange({
                  type: 'dynamic',
                  mode: 'ai',
                  prompt: e.target.value,
                  provider: (resolver as { provider: string }).provider ?? 'configured-default',
                })
              }
              style={{ ...fieldStyle, minHeight: 40, resize: 'vertical' }}
              placeholder="Describe the value you want"
            />
            <InlineInput
              label="Provider"
              value={(resolver as { provider: string }).provider ?? 'configured-default'}
              onChange={(v) =>
                onChange({
                  ...(resolver as object),
                  provider: v || 'configured-default',
                } as Resolver)
              }
              compact
            />
          </ResolverFields>
        )}
        {active.type === 'database' && (
          <ResolverFields label="Database query">
            <InlineInput
              label="Data source"
              value={(resolver as { dataSourceRef: string }).dataSourceRef ?? ''}
              onChange={(v) =>
                onChange({ ...(resolver as object), dataSourceRef: v } as Resolver)
              }
              compact
            />
            <div style={{ marginTop: 4 }}>
              <textarea
                value={(resolver as { query: string }).query ?? ''}
                onChange={(e) =>
                  onChange({
                    ...(resolver as object),
                    query: e.target.value,
                  } as Resolver)
                }
                style={{ ...fieldStyle, minHeight: 40, resize: 'vertical' }}
                placeholder="SELECT email FROM users LIMIT 1"
              />
            </div>
          </ResolverFields>
        )}
      </div>
    </div>
  );
}

/**
 * Free-typing JSON editor for the dynamic-array value list. A controlled
 * input bound straight to JSON.stringify(values) is uneditable: every
 * intermediate keystroke is invalid JSON, gets discarded, and the field
 * snaps back. So keep a local draft and only commit parses that yield an
 * array; an invalid draft is flagged, never sent upstream.
 */
function JsonArrayInput({
  values,
  onCommit,
}: {
  values: (string | number | boolean)[];
  onCommit: (values: (string | number | boolean)[]) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(values));
  let invalid = false;
  try {
    invalid = !Array.isArray(JSON.parse(draft));
  } catch {
    invalid = true;
  }

  return (
    <input
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        try {
          const parsed = JSON.parse(text) as unknown;
          if (Array.isArray(parsed)) onCommit(parsed as (string | number | boolean)[]);
        } catch {
          // Keep typing — commit happens on the next valid parse.
        }
      }}
      style={{ ...fieldStyle, ...(invalid ? { borderColor: '#c33' } : {}), width: '100%' }}
      placeholder='["val1","val2"]'
      aria-invalid={invalid}
    />
  );
}

function buildResolver(selected: (typeof RESOLVER_TYPES)[number]): Resolver {
  if (selected.type === 'static') return { type: 'static', value: '' };
  if (selected.type === 'dynamic' && selected.mode === 'array')
    return { type: 'dynamic', mode: 'array', values: [], order: 'random' };
  if (selected.type === 'dynamic' && selected.mode === 'ai')
    return { type: 'dynamic', mode: 'ai', prompt: '', provider: 'configured-default' };
  if (selected.type === 'database')
    return { type: 'database', dataSourceRef: '', query: '' };
  return { type: 'static', value: '' };
}

// ── Assertion editor ──

function AssertionEditor({
  step,
  onChange,
}: {
  step: Step & { action: 'assert' };
  onChange: (patch: Partial<Step>) => void;
}) {
  const patch = (extra: Partial<Step>) => onChange(extra);

  switch (step.assertion) {
    case 'elementVisible':
    case 'elementNotVisible':
    case 'elementEnabled':
    case 'elementDisabled':
      return (
        <div style={{ fontSize: 11, color: '#666' }}>
          Uses the selector above. No extra parameters.
        </div>
      );

    case 'textContains':
      return (
        <div>
          <InlineInput
            value={step.value}
            onChange={(v) => patch({ value: v } as Partial<Step>)}
            placeholder="Substring to find"
          />
          <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <input
              type="checkbox"
              checked={step.caseInsensitive ?? false}
              onChange={(e) => patch({ caseInsensitive: e.target.checked } as Partial<Step>)}
            />
            Case insensitive
          </label>
        </div>
      );

    case 'textEquals':
      return (
        <InlineInput
          value={step.value}
          onChange={(v) => patch({ value: v } as Partial<Step>)}
          placeholder="Exact text"
        />
      );

    case 'inputValue':
      return (
        <InlineInput
          value={step.value}
          onChange={(v) => patch({ value: v } as Partial<Step>)}
          placeholder="Expected value"
        />
      );

    case 'urlMatches':
      return (
        <div>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              value={step.patternType ?? 'glob'}
              onChange={(e) => patch({ patternType: e.target.value as 'glob' | 'regex' } as Partial<Step>)}
              style={selectStyle}
            >
              <option value="glob">Glob</option>
              <option value="regex">Regex</option>
            </select>
            <input
              value={step.pattern}
              onChange={(e) => patch({ pattern: e.target.value } as Partial<Step>)}
              style={fieldStyle}
              placeholder={step.patternType === 'regex' ? '\\/orders\\/\\d+' : '**/orders/*'}
            />
          </div>
        </div>
      );

    case 'elementCount':
      return (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={step.comparator ?? 'eq'}
            onChange={(e) => patch({ comparator: e.target.value as 'eq' | 'gte' | 'lte' } as Partial<Step>)}
            style={selectStyle}
          >
            <option value="eq">=</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          <input
            type="number"
            value={String(step.count ?? 0)}
            onChange={(e) => patch({ count: Number(e.target.value) || 0 } as Partial<Step>)}
            style={{ ...fieldStyle, width: 60 }}
          />
        </div>
      );

    default:
      return <div style={{ fontSize: 11, color: '#c33' }}>Unknown assertion type</div>;
  }
}

// ── Shared UI helpers ──

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

function assertionDescription(step: Step & { action: 'assert' }, advanced: boolean): string {
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

// ── Input / field helpers ──

function FieldGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div style={{ marginTop: 8, paddingLeft: 26, fontSize: 11 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#666', marginBottom: 2 }}>{children}</div>;
}

function ResolverFields({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div style={{ marginTop: 4 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      {children}
    </div>
  );
}

function InlineInput({
  value,
  onChange,
  placeholder,
  label,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
      {label && <span style={{ whiteSpace: 'nowrap', color: '#666' }}>{label}:</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...fieldStyle, width: compact ? 80 : '100%' }}
        placeholder={placeholder}
      />
    </label>
  );
}

const card: React.CSSProperties = {
  padding: '8px 10px',
  marginBottom: 6,
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  background: '#fafafa',
};

const fieldStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 6px',
  border: '1px solid #ddd',
  borderRadius: 4,
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 4px',
  border: '1px solid #ddd',
  borderRadius: 4,
  background: '#fff',
};

const num: React.CSSProperties = {
  fontSize: 11,
  color: '#999',
  minWidth: 18,
  marginTop: 2,
  textAlign: 'center',
};
