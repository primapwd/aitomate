import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  calculateBackoff,
  DEFAULT_BACKOFF_MS,
  DEFAULT_RETRY_COUNT,
  executeStepWithRetry,
  resolveUrl,
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
  vi.useRealTimers();
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
    expect(result.durationMs).toBeGreaterThan(0);
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
    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'));

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

  it('recovers when the content script is briefly unreachable', async () => {
    // First wait-for-dom send hits the post-navigation injection race;
    // the probe re-sends until the content script answers. The action's
    // retry budget must NOT be consumed by the probe.
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage')
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));

    const step = makeStep({ options: { retry: { count: 2, backoffMs: 10 } } });
    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('fails fast when the content script never becomes reachable', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );

    const step = makeStep({ options: { timeoutMs: 50 } });
    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(false);
    // One smart-wait attempt, not the full action retry budget — re-looping
    // on a page that will never answer just burns backoff time.
    expect(result.attempts).toBe(1);
    expect(result.error).toContain('content script could not be reached');
    // At least one probe sleep elapsed — the timing is honest now.
    expect(result.durationMs).toBeGreaterThanOrEqual(250);
  });

  it('aborts the smart-wait probe when the run is stopped', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );

    // First stopped() check is the loop-start guard (passes); the second is
    // the probe's own check, which aborts mid-wait.
    let checks = 0;
    const signal = { stopped: () => ++checks > 1 };
    const step = makeStep({ options: { timeoutMs: 10_000 } });
    const result = await executeStepWithRetry(TAB_ID, step, signal);
    expect(result.passed).toBe(false);
    expect(result.error).toBe('Run stopped');
    expect(result.attempts).toBe(0);
  });

  it('passes the remaining smart-wait budget, not the full timeout, to each probe', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );

    const step = makeStep({ options: { timeoutMs: 1000 } });
    const pending = executeStepWithRetry(TAB_ID, step);
    await vi.advanceTimersByTimeAsync(1200); // probe sleeps 300ms each iteration
    const result = await pending;

    // Each probe carries the remaining budget (1000, 700, 400, 100) — a
    // fresh full timeout on every send would extend the horizon to ~2x.
    const payloads = sendMessage.mock.calls.map(
      (call) => (call[1] as { timeoutMs?: number }).timeoutMs,
    );
    expect(payloads).toEqual([1000, 700, 400, 100]);
    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain('content script could not be reached');
    vi.useRealTimers();
  });

  it('gives a recovering content script the remaining budget, not a fresh one', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.spyOn(browser.tabs, 'sendMessage')
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(true));

    const step = makeStep({ options: { timeoutMs: 1000 } });
    const pending = executeStepWithRetry(TAB_ID, step);
    await vi.advanceTimersByTimeAsync(600); // two rejects (300ms apart), third send answers
    const result = await pending;

    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    const payloads = sendMessage.mock.calls.map(
      (call) => (call[1] as { timeoutMs?: number }).timeoutMs,
    );
    // Third probe: remaining = 1000 - 600 = 400, not a fresh 1000.
    expect(payloads).toEqual([1000, 700, 400, undefined]);
    vi.useRealTimers();
  });

  it('reports total durationMs when retries are exhausted', async () => {
    const step = makeStep({ options: { retry: { count: 2, backoffMs: 1 } } });

    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false, 'Timeout'));

    const result = await executeStepWithRetry(TAB_ID, step);
    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(2);
    // Includes the inter-attempt backoff — not the old hardcoded 0.
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
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

  it('resolves {{BASE_URL}} in a navigate step before calling tabs.update', async () => {
    const navigateStep = makeStep({ action: 'navigate', url: '{{BASE_URL}}/checkout' });

    vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ status: 'complete' } as any);

    const result = await executeStepWithRetry(
      TAB_ID,
      navigateStep,
      undefined,
      undefined,
      'http://localhost:8080/',
    );

    expect(result.passed).toBe(true);
    expect(browser.tabs.update).toHaveBeenCalledWith(TAB_ID, {
      url: 'http://localhost:8080/checkout',
    });
  });

  it('fails loud instead of navigating when {{BASE_URL}} is unresolved', async () => {
    const navigateStep = makeStep({ action: 'navigate', url: '{{BASE_URL}}/checkout' });
    const update = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);

    const result = await executeStepWithRetry(TAB_ID, navigateStep);

    expect(result.passed).toBe(false);
    expect(result.error).toContain('Base URL');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('resolveUrl', () => {
  it('returns the url unchanged when no baseUrl is given', () => {
    expect(resolveUrl('{{BASE_URL}}/checkout')).toBe('{{BASE_URL}}/checkout');
  });

  it('returns the url unchanged when it has no placeholder', () => {
    expect(resolveUrl('/checkout', 'http://localhost:8080')).toBe('/checkout');
  });

  it('substitutes {{BASE_URL}}, stripping a trailing slash from baseUrl', () => {
    expect(resolveUrl('{{BASE_URL}}/checkout', 'http://localhost:8080/')).toBe(
      'http://localhost:8080/checkout',
    );
  });

  it('substitutes every occurrence of the placeholder', () => {
    expect(resolveUrl('{{BASE_URL}}/a?next={{BASE_URL}}/b', 'http://x.test')).toBe(
      'http://x.test/a?next=http://x.test/b',
    );
  });

  it('treats a baseUrl containing "$" as literal text, not a replace-pattern', () => {
    // String.prototype.replace treats "$&"/"$$"/"$`"/"$'" specially when the
    // replacement is a string — resolveUrl must not let a base URL
    // containing "$" (e.g. basic-auth creds, a "$"-bearing query param)
    // corrupt the result.
    expect(resolveUrl('{{BASE_URL}}/x', 'http://u:p$&ss@host')).toBe(
      'http://u:p$&ss@host/x',
    );
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
