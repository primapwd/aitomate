import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  calculateBackoff,
  DEFAULT_BACKOFF_MS,
  DEFAULT_RETRY_COUNT,
  executeStepWithRetry,
} from './step-executor';

const TAB_ID = 42;

function makeStep(overrides?: Record<string, unknown>) {
  return {
    id: 'step-1',
    action: 'click',
    selector: { strategy: 'testid', value: 'submit-btn' },
    ...overrides,
  } as Parameters<typeof executeStepWithRetry>[1];
}

function executedResponse(passed: boolean, error?: string) {
  return {
    type: 'aitomate:runner:step-executed' as const,
    stepId: 'step-1',
    passed,
    error,
  } as any;
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeStepWithRetry', () => {
  it('returns passed=true when the content script succeeds', async () => {
    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));

    const result = await executeStepWithRetry(TAB_ID, makeStep());
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.stepId).toBe('step-1');
  });

  it('retries on failure and succeeds on the 2nd attempt', async () => {
    const step = makeStep({ options: { retry: { count: 3, backoffMs: 10 } } });

    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Element not found'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));

    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('exhausts retries and returns failed=false', async () => {
    const step = makeStep({ options: { retry: { count: 2, backoffMs: 10 } } });

    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'));

    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toBe('Timeout');
  });

  it('uses default retry count when step has no options', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('Tab not reachable'));

    const result = await executeStepWithRetry(TAB_ID, makeStep());
    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(DEFAULT_RETRY_COUNT);
  });

  it('stops early if the stop signal fires', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(undefined);

    const signal = { stopped: () => true };
    const result = await executeStepWithRetry(TAB_ID, makeStep(), signal);
    expect(result.passed).toBe(false);
    expect(result.error).toBe('Run stopped');
    expect(result.attempts).toBe(0);
  });

  it('handles sendMessage rejection as a failure', async () => {
    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Content script not ready'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));

    const step = makeStep({ options: { retry: { count: 2, backoffMs: 10 } } });
    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('fails gracefully when no AI provider is configured', async () => {
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage');
    const step = makeStep({
      action: 'fill',
      resolver: { type: 'dynamic', mode: 'ai', prompt: 'an email', provider: 'configured-default' },
    });

    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(false);
    expect(result.error).toContain('AI provider');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('resolves a dynamic array value to a static resolver before sending', async () => {
    const sendMessage = vi
      .spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));
    const step = makeStep({
      action: 'fill',
      resolver: { type: 'dynamic', mode: 'array', values: ['a@b.com'], order: 'random' },
    });

    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(true);
    const sent = sendMessage.mock.calls[1][1] as {
      step: { resolver: { type: string; value: string } };
    };
    expect(sent.step.resolver).toEqual({ type: 'static', value: 'a@b.com' });
  });

  it('handles navigate steps via tabs.update without retry', async () => {
    const navigateStep = makeStep({
      action: 'navigate',
      url: 'https://app.test/dashboard',
    });

    vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ status: 'complete' } as any);

    const result = await executeStepWithRetry(TAB_ID, navigateStep);
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(browser.tabs.update).toHaveBeenCalledWith(TAB_ID, {
      url: 'https://app.test/dashboard',
    });
  });

  it('returns failed for navigate step when tabs.update rejects', async () => {
    const navigateStep = makeStep({
      action: 'navigate',
      url: '/relative-path',
    });

    vi.spyOn(browser.tabs, 'update').mockRejectedValue(new Error('Tab removed'));

    const result = await executeStepWithRetry(TAB_ID, navigateStep);
    expect(result.passed).toBe(false);
    expect(result.error).toContain('Navigation failed');
  });

  it('waits for tab load after full-url navigation', async () => {
    const navigateStep = makeStep({
      action: 'navigate',
      url: 'https://app.test/orders',
    });

    vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    vi.spyOn(browser.tabs, 'get')
      .mockResolvedValueOnce({ status: 'loading' } as any)
      .mockResolvedValueOnce({ status: 'complete' } as any);

    const result = await executeStepWithRetry(TAB_ID, navigateStep);
    expect(result.passed).toBe(true);
  });
});

describe('calculateBackoff', () => {
  it('produces increasing values for successive attempts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const b1 = calculateBackoff(1000, 1);
    const b2 = calculateBackoff(1000, 2);
    const b3 = calculateBackoff(1000, 3);

    expect(b1).toBe(1000);
    expect(b2).toBe(2000);
    expect(b3).toBe(4000);

    vi.restoreAllMocks();
  });

  it('includes jitter in the result', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const backoff = calculateBackoff(1000, 1);
    expect(backoff).toBe(1500);

    vi.restoreAllMocks();
  });
});
