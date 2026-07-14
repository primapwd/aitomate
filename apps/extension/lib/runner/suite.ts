import type { StepResult } from './messages';

/**
 * T2.10: Suite runner — sequential batch execution across stored scenarios.
 *
 * Pure orchestration: given scenario refs and an injected `runOne` callback,
 * it runs them sequentially and aggregates a report. Never reaches into
 * `browser.storage` or knows how a scenario is actually executed.
 *
 * Sequential, not parallel — MV3 has one active tab driving playback.
 * A crashing scenario does not abort the suite; the next scenario runs.
 */

export interface SuiteScenarioRef {
  id: string;
  name: string;
}

export interface ScenarioRunReport {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  results: StepResult[];
}

export interface SuiteReport {
  passed: boolean;
  scenarios: ScenarioRunReport[];
}

export type ScenarioRunner = (
  ref: SuiteScenarioRef,
) => Promise<{ passed: boolean; error?: string; results: StepResult[] }>;

export interface SuiteOptions {
  stopOnFirstFailure?: boolean;
}

const EMPTY_RESULTS: StepResult[] = [];

function emptyReport(name: string): ScenarioRunReport {
  return { name, status: 'skipped', results: EMPTY_RESULTS };
}

export async function runSuite(
  scenarios: SuiteScenarioRef[],
  runOne: ScenarioRunner,
  signal: { stopped: () => boolean },
  options?: SuiteOptions,
): Promise<SuiteReport> {
  const stopOnFirst = options?.stopOnFirstFailure ?? false;
  const entries: ScenarioRunReport[] = [];
  let suitePassed = true;

  for (const ref of scenarios) {
    if (signal.stopped()) {
      entries.push(emptyReport(ref.name));
      suitePassed = false;
      continue;
    }

    try {
      const outcome = await runOne(ref);
      if (outcome.passed) {
        entries.push({ name: ref.name, status: 'passed', results: outcome.results });
      } else {
        suitePassed = false;
        entries.push({
          name: ref.name,
          status: 'failed',
          error: outcome.error ?? 'Scenario failed',
          results: outcome.results,
        });
        if (stopOnFirst) {
          // Mark remaining as skipped
          const remaining = scenarios.slice(entries.length);
          for (const r of remaining) {
            entries.push(emptyReport(r.name));
          }
          break;
        }
      }
    } catch (err) {
      suitePassed = false;
      const message = err instanceof Error ? err.message : String(err);
      entries.push({
        name: ref.name,
        status: 'failed',
        error: `Scenario "${ref.name}" crashed: ${message}`,
        results: EMPTY_RESULTS,
      });
      if (stopOnFirst) {
        const remaining = scenarios.slice(entries.length);
        for (const r of remaining) {
          entries.push(emptyReport(r.name));
        }
        break;
      }
    }
  }

  return { passed: suitePassed, scenarios: entries };
}
