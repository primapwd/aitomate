import { useState } from 'react';
import type { Resolver, Selector, Step } from '@aitomate/schema';
import {
  IconAssert,
  IconChevronDown,
  IconChevronUp,
  IconClick,
  IconCross,
  IconCrosshair,
  IconDatabase,
  IconEye,
  IconFill,
  IconNavigate,
  IconTrash,
  IconWait,
  IconWand,
} from '@/components/ui/icons';

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

  const actionColors: Record<string, { bg: string; border: string; text: string }> = {
    click: { bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.3)', text: '#38bdf8' },
    fill: { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', text: '#a78bfa' },
    navigate: { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', text: '#34d399' },
    wait: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)', text: '#fbbf24' },
    assert: { bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.3)', text: '#f87171' },
    upload: { bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.3)', text: '#c084fc' },
    keypress: { bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.3)', text: '#818cf8' },
  };

  const currentTheme = actionColors[step.action] ?? {
    bg: 'rgba(255, 255, 255, 0.05)',
    border: 'var(--border-subtle)',
    text: 'var(--text-secondary)',
  };

  return (
    <div
      className="ait-card animate-fade-in"
      style={{
        padding: '10px 12px',
        marginBottom: 8,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${currentTheme.text}`,
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            minWidth: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.06)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 2,
          }}
        >
          {index + 1}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="ait-badge"
              style={{
                background: currentTheme.bg,
                color: currentTheme.text,
                border: `1px solid ${currentTheme.border}`,
                fontSize: 9,
              }}
            >
              <StepIcon action={step.action} />
              {step.action}
            </span>

            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
              {description}
            </span>
          </div>

          {advanced && (
            <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-muted)' }}>
              ID: <code style={{ fontSize: 10, color: '#a5b4fc' }}>{step.id}</code>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {onMoveUp && <MiniBtn onClick={onMoveUp} label="Move up" symbol={<IconChevronUp size={12} />} />}
          {onMoveDown && <MiniBtn onClick={onMoveDown} label="Move down" symbol={<IconChevronDown size={12} />} />}
          {onLocate && (
            <MiniBtn
              onClick={onLocate}
              label="Locate element on page"
              symbol={<IconCrosshair size={12} color="#38bdf8" />}
              highlight
            />
          )}
          <MiniBtn onClick={onDelete} label="Delete step" symbol={<IconTrash size={12} />} danger />
        </div>
      </div>

      {/* Inline Editors */}
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

      {/* Advanced Mode Panels */}
      {advanced && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border-subtle)' }}>
          {/* Selector Editor */}
          {'selector' in step && (
            <FieldGroup label="Target Selector">
              <SelectorEditor
                selector={step.selector as Selector}
                onChange={(sel) => onUpdate({ selector: sel } as Partial<Step>)}
              />
            </FieldGroup>
          )}

          {/* Resolver Config */}
          {step.action === 'fill' && (
            <FieldGroup label="Value Resolver">
              <ResolverEditor
                resolver={step.resolver}
                onChange={(res) => onUpdate({ resolver: res } as Partial<Step>)}
              />
            </FieldGroup>
          )}

          {/* Assertion Editor */}
          {step.action === 'assert' && (
            <FieldGroup label="Assertion Configuration">
              <AssertionEditor step={step} onChange={(patch) => onUpdate(patch)} />
            </FieldGroup>
          )}

          {/* URL Editor */}
          {step.action === 'navigate' && (
            <FieldGroup label="Target URL">
              <InlineInput
                value={step.url}
                onChange={(v) => onUpdate({ url: v } as Partial<Step>)}
                placeholder="/path or https://..."
              />
            </FieldGroup>
          )}

          {/* Wait Step Details */}
          {step.action === 'wait' && (
            <FieldGroup>
              {!step.forSelector && (
                <InlineInput
                  label="Duration (ms)"
                  value={step.durationMs !== undefined ? String(step.durationMs) : ''}
                  onChange={(v) => onUpdate({ durationMs: Number(v) || undefined } as Partial<Step>)}
                />
              )}
              {step.forSelector && (
                <SelectorEditor
                  label="Wait for Element"
                  selector={step.forSelector}
                  onChange={(sel) => onUpdate({ forSelector: sel } as Partial<Step>)}
                />
              )}
            </FieldGroup>
          )}

          {/* Fixture Ref */}
          {step.action === 'upload' && (
            <FieldGroup label="File Fixture">
              <InlineInput
                value={step.fixtureRef}
                onChange={(v) => onUpdate({ fixtureRef: v } as Partial<Step>)}
                placeholder="e.g. sample.pdf"
              />
            </FieldGroup>
          )}

          {/* Timeout + Retry Options */}
          <FieldGroup label="Step Options">
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
        </div>
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
          className="ait-select"
          style={{ width: 90, flexShrink: 0, padding: '4px 22px 4px 6px', fontSize: 11 }}
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
          className="ait-input"
          style={{ padding: '4px 8px', fontSize: 11 }}
          placeholder="value"
        />
      </div>
    </div>
  );
}

// ── Resolver editor ──

const RESOLVER_TYPES = [
  { type: 'static', label: 'Static Value' },
  { type: 'dynamic', mode: 'array', label: 'Dynamic — Pick from List' },
  { type: 'dynamic', mode: 'ai', label: 'Dynamic — AI Generated' },
  { type: 'database', label: 'Database Query' },
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
        className="ait-select"
        style={{ padding: '4px 22px 4px 8px', fontSize: 11 }}
      >
        {RESOLVER_TYPES.map((r, i) => (
          <option key={i} value={i}>
            {r.label}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 6 }}>
        {active.type === 'static' && (
          <ResolverFields label="Static Value">
            <input
              value={String((resolver as { value: string | number | boolean }).value ?? '')}
              onChange={(e) => onChange({ type: 'static', value: e.target.value })}
              className="ait-input"
              style={{ padding: '4px 8px', fontSize: 11 }}
              placeholder="Value"
            />
          </ResolverFields>
        )}
        {active.type === 'dynamic' && active.mode === 'array' && (
          <ResolverFields label="Values (JSON Array)">
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
            <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, color: 'var(--text-secondary)' }}>
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
              Sequential Order
            </label>
          </ResolverFields>
        )}
        {active.type === 'dynamic' && active.mode === 'ai' && (
          <ResolverFields label="AI Generation Prompt">
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
              className="ait-textarea"
              style={{ minHeight: 45, resize: 'vertical', fontSize: 11 }}
              placeholder="Describe the value to generate (e.g. realistic Indonesian full name)"
            />
            <div style={{ marginTop: 4 }}>
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
            </div>
          </ResolverFields>
        )}
        {active.type === 'database' && (
          <ResolverFields label="Database Integration">
            <InlineInput
              label="Data Source"
              value={(resolver as { dataSourceRef: string }).dataSourceRef ?? ''}
              onChange={(v) => onChange({ ...(resolver as object), dataSourceRef: v } as Resolver)}
              compact
            />
            <div style={{ marginTop: 4 }}>
              <textarea
                value={(resolver as { query: string }).query ?? ''}
                onChange={(e) => onChange({ ...(resolver as object), query: e.target.value } as Resolver)}
                className="ait-textarea"
                style={{ minHeight: 45, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                placeholder="SELECT email FROM users WHERE role = :role LIMIT 1"
              />
            </div>
          </ResolverFields>
        )}
      </div>
    </div>
  );
}

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
          // Keep typing — commit on valid parse
        }
      }}
      className="ait-input"
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        borderColor: invalid ? 'var(--status-error)' : undefined,
      }}
      placeholder='["value1", "value2"]'
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
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Uses the selector specified above. No extra parameters required.
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
          <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={step.caseInsensitive ?? false}
              onChange={(e) => patch({ caseInsensitive: e.target.checked } as Partial<Step>)}
            />
            Case Insensitive
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
          placeholder="Expected input value"
        />
      );

    case 'urlMatches':
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          <select
            value={step.patternType ?? 'glob'}
            onChange={(e) => patch({ patternType: e.target.value as 'glob' | 'regex' } as Partial<Step>)}
            className="ait-select"
            style={{ width: 80, flexShrink: 0, padding: '4px 20px 4px 6px', fontSize: 11 }}
          >
            <option value="glob">Glob</option>
            <option value="regex">Regex</option>
          </select>
          <input
            value={step.pattern}
            onChange={(e) => patch({ pattern: e.target.value } as Partial<Step>)}
            className="ait-input"
            style={{ padding: '4px 8px', fontSize: 11 }}
            placeholder={step.patternType === 'regex' ? '\\/orders\\/\\d+' : '**/orders/*'}
          />
        </div>
      );

    case 'elementCount':
      return (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={step.comparator ?? 'eq'}
            onChange={(e) => patch({ comparator: e.target.value as 'eq' | 'gte' | 'lte' } as Partial<Step>)}
            className="ait-select"
            style={{ width: 60, padding: '4px 18px 4px 6px', fontSize: 11 }}
          >
            <option value="eq">=</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          <input
            type="number"
            value={String(step.count ?? 0)}
            onChange={(e) => patch({ count: Number(e.target.value) || 0 } as Partial<Step>)}
            className="ait-input"
            style={{ width: 60, padding: '4px 6px', fontSize: 11 }}
          />
        </div>
      );

    default:
      return <div style={{ fontSize: 11, color: 'var(--status-error)' }}>Unknown assertion type</div>;
  }
}

// ── Shared UI helpers ──

function StepIcon({ action }: { action: string }) {
  switch (action) {
    case 'click': return <IconClick size={12} />;
    case 'fill': return <IconFill size={12} />;
    case 'navigate': return <IconNavigate size={12} />;
    case 'wait': return <IconWait size={12} />;
    case 'assert': return <IconAssert size={12} />;
    default: return <IconEye size={12} />;
  }
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
  highlight,
}: {
  onClick: () => void;
  label: string;
  symbol: React.ReactNode;
  danger?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="ait-btn ait-btn-icon"
      style={{
        padding: '3px 5px',
        border: '1px solid',
        borderColor: danger
          ? 'var(--status-error-border)'
          : highlight
            ? 'rgba(56, 189, 248, 0.4)'
            : 'var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        background: danger
          ? 'var(--status-error-bg)'
          : highlight
            ? 'rgba(56, 189, 248, 0.12)'
            : 'var(--bg-surface-hover)',
        color: danger
          ? 'var(--status-error)'
          : highlight
            ? '#38bdf8'
            : 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {symbol}
    </button>
  );
}

function FieldGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div style={{ marginTop: 8, fontSize: 11 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
      {children}
    </div>
  );
}

function ResolverFields({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div style={{ marginTop: 6 }}>
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
    <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flex: compact ? 'none' : 1 }}>
      {label && <span style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 11 }}>{label}:</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ait-input"
        style={{ padding: '4px 8px', fontSize: 11, width: compact ? 80 : '100%' }}
        placeholder={placeholder}
      />
    </label>
  );
}
