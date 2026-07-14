import type { Assertion, Scenario, SetupRef, Step } from '@aitomate/schema';
import { executeStepWithRetry } from './step-executor';
import type { LlmGenerateFn } from './value-resolver';
import { debugLog } from '@/lib/debug';

/**
 * Scenario chaining (FR-10, T2.8): a main scenario may declare `setup`,
 * naming another stored scenario to run first (e.g. login). One level of
 * chaining only — a setup scenario declaring its own setup is rejected.
 *
 * Extracted out of the background entrypoint so this decision logic (chain
 * depth guard, marker skip, plain-language error messages) is unit-testable
 * with a fake browser, the same way step-executor.ts is.
 */

export type SetupLookup = (
  name: string,
) => Promise<{ scenario: Scenario } | undefined>;

export interface RunSignal {
  stopped: () => boolean;
}

export type SetupOutcome = { ok: true } | { ok: false; error: string };

/**
 * Evaluate a session marker as a cheap, single-shot check: "is the session
 * active right now", not "wait for it to become active". A normal assert
 * step polls up to its timeout and retries on failure — appropriate when
 * failure is transient. Session expiry is the opposite: it's the expected
 * eventual outcome, so retrying it would burn 30s+ of polling on every
 * setup-guarded run for no benefit, defeating the point of a "cheap" marker.
 */
export async function checkSessionMarker(
  tabId: number,
  marker: Assertion,
): Promise<boolean> {
  const assertStep: Step = {
    id: '__session-marker__',
    action: 'assert',
    options: { timeoutMs: 1000, retry: { count: 1, backoffMs: 0 } },
    ...marker,
  } as unknown as Step;
  const result = await executeStepWithRetry(tabId, assertStep);
  debugLog('chaining', `session-marker tab=${tabId} result=${result.passed}`);
  return result.passed;
}

/**
 * Run a scenario's declared setup. Returns `{ ok: true }` on success
 * (including "skipped, session marker still passes"), or a plain-language
 * error prefixed "Setup failed:" so the run report can tell it apart from a
 * main-scenario step failure.
 */
export async function runSetup(
  tabId: number,
  setup: SetupRef,
  findScenario: SetupLookup,
  signal: RunSignal,
  llmGenerate?: LlmGenerateFn,
): Promise<SetupOutcome> {
  const stored = await findScenario(setup.scenarioRef);
  if (!stored) {
    return {
      ok: false,
      error: `Setup failed: setup scenario "${setup.scenarioRef}" not found. Import it first via the Run view.`,
    };
  }

  const setupSc = stored.scenario;
  debugLog('chaining', `run-setup ref="${setup.scenarioRef}" tab=${tabId} marker=${!!setupSc.meta.sessionMarker}`);

  // One level of chaining only (MVP constraint per spec §4).
  if (setupSc.setup) {
    return {
      ok: false,
      error: `Setup failed: "${setup.scenarioRef}" declares its own setup (deep chaining not supported in MVP).`,
    };
  }

  if (setupSc.meta.sessionMarker) {
    const markerOk = await checkSessionMarker(tabId, setupSc.meta.sessionMarker);
    if (markerOk) return { ok: true }; // session still active, skip re-running setup
  }

  for (let i = 0; i < setupSc.steps.length; i++) {
    if (signal.stopped()) break;

    const step: Step = setupSc.steps[i];
    const result = await executeStepWithRetry(tabId, step, signal, llmGenerate);

    if (!result.passed) {
      return {
        ok: false,
        error: `Setup failed: "${setup.scenarioRef}" step ${i + 1} failed — ${result.error ?? 'unknown error'}`,
      };
    }
  }

  return { ok: true };
}
