import { describe, expect, it } from 'vitest';
import { buildManualStep } from './manual-step';

describe('buildManualStep', () => {
  it('builds a navigate step with a blank url', () => {
    expect(buildManualStep('navigate', 'id-1')).toEqual({
      id: 'id-1',
      action: 'navigate',
      url: '',
    });
  });

  it('builds a click step with a blank selector', () => {
    expect(buildManualStep('click', 'id-1')).toEqual({
      id: 'id-1',
      action: 'click',
      selector: { strategy: 'css', value: '' },
    });
  });

  it('builds a fill step with a blank selector and static resolver', () => {
    expect(buildManualStep('fill', 'id-1')).toEqual({
      id: 'id-1',
      action: 'fill',
      selector: { strategy: 'css', value: '' },
      resolver: { type: 'static', value: '' },
    });
  });

  it('builds a wait step with a default duration', () => {
    expect(buildManualStep('wait', 'id-1')).toEqual({
      id: 'id-1',
      action: 'wait',
      durationMs: 1000,
    });
  });

  it('builds an assert step defaulting to elementVisible', () => {
    expect(buildManualStep('assert', 'id-1')).toEqual({
      id: 'id-1',
      action: 'assert',
      assertion: 'elementVisible',
      selector: { strategy: 'css', value: '' },
    });
  });

  it('uses the id passed in, not a generated one', () => {
    const a = buildManualStep('navigate', 'first');
    const b = buildManualStep('navigate', 'second');
    expect(a.id).toBe('first');
    expect(b.id).toBe('second');
  });
});
