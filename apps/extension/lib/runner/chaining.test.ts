import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Scenario } from '@aitomate/schema';
import { checkSessionMarker, runSetup, type SetupLookup } from './chaining';

const TAB_ID = 42;

function executedResponse(passed: boolean, error?: string) {
  return {
    type: 'aitomate:runner:step-executed' as const,
    stepId: 'x',
    passed,
    error,
  } as any;
}

function makeScenario(overrides?: Partial<Scenario>): Scenario {
  return {
    schemaVersion: '1.0',
    meta: { name: 'Login', tags: [] },
    dataSources: [],
    steps: [
      { id: 's1', action: 'click', selector: { strategy: 'testid', value: 'login-btn' } },
    ],
    ...overrides,
  } as Scenario;
}

const alwaysStopped = { stopped: () => false };

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSetup', () => {
  it('fails when the named setup scenario is not found', async () => {
    const findScenario: SetupLookup = async () => undefined;
    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
      expect(result.error).toContain('Login');
    }
  });

  it('rejects a setup scenario that declares its own setup (one level of chaining)', async () => {
    const nested = makeScenario({ setup: { scenarioRef: 'Deeper' } });
    const findScenario: SetupLookup = async () => ({ scenario: nested });
    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('own setup');
    }
  });

  it('runs every setup step and succeeds when they all pass', async () => {
    const findScenario: SetupLookup = async () => ({ scenario: makeScenario() });
    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined) // wait-for-dom
      .mockResolvedValueOnce(executedResponse(true)); // execute-step

    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(true);
  });

  it('fails with a plain-language, step-numbered error when a setup step fails', async () => {
    const findScenario: SetupLookup = async () => ({ scenario: makeScenario() });
    vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(
      executedResponse(false, 'Element not found'),
    );

    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Login');
      expect(result.error).toContain('step 1');
      expect(result.error).toContain('Element not found');
    }
  });

  it('skips re-running the setup when its session marker still passes', async () => {
    const withMarker = makeScenario({
      meta: {
        name: 'Login',
        tags: [],
        sessionMarker: { assertion: 'elementVisible', selector: { strategy: 'testid', value: 'dashboard' } },
      },
    });
    const findScenario: SetupLookup = async () => ({ scenario: withMarker });
    const sendMessage = vi
      .spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined) // wait-for-dom for the marker check
      .mockResolvedValueOnce(executedResponse(true)); // marker assert passes

    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(true);
    // Only the marker check ran — never the setup's own steps.
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('re-runs the setup when its session marker fails', async () => {
    const withMarker = makeScenario({
      meta: {
        name: 'Login',
        tags: [],
        sessionMarker: { assertion: 'elementVisible', selector: { strategy: 'testid', value: 'dashboard' } },
      },
    });
    const findScenario: SetupLookup = async () => ({ scenario: withMarker });
    vi.spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined) // wait-for-dom for the marker check
      .mockResolvedValueOnce(executedResponse(false)) // marker assert fails, no retry
      .mockResolvedValueOnce(undefined) // wait-for-dom for the setup step
      .mockResolvedValueOnce(executedResponse(true)); // setup step passes

    const result = await runSetup(TAB_ID, { scenarioRef: 'Login' }, findScenario, alwaysStopped);
    expect(result.ok).toBe(true);
  });

  it('threads baseUrl into the setup scenario\'s own navigate steps', async () => {
    const withNavigate = makeScenario({
      steps: [{ id: 's1', action: 'navigate', url: '{{BASE_URL}}/login' }],
    });
    const findScenario: SetupLookup = async () => ({ scenario: withNavigate });
    vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ status: 'complete' } as any);

    const result = await runSetup(
      TAB_ID,
      { scenarioRef: 'Login' },
      findScenario,
      alwaysStopped,
      undefined,
      'http://localhost:8080',
    );

    expect(result.ok).toBe(true);
    expect(browser.tabs.update).toHaveBeenCalledWith(TAB_ID, {
      url: 'http://localhost:8080/login',
    });
  });
});

describe('checkSessionMarker', () => {
  it('does not retry a failing marker (cheap single-shot check)', async () => {
    const sendMessage = vi
      .spyOn(browser.tabs, 'sendMessage')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(executedResponse(false));

    const ok = await checkSessionMarker(TAB_ID, {
      assertion: 'elementVisible',
      selector: { strategy: 'testid', value: 'dashboard' },
    });
    expect(ok).toBe(false);
    // wait-for-dom + one execute-step — no backoff/retry round trips.
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
