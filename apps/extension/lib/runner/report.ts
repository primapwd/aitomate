import type { Step } from '@aitomate/schema';
import type { StepResult } from './messages';

export interface RunReportStep {
  stepId: string;
  action: Step['action'];
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  attempts?: number;
  durationMs?: number;
}

export interface RunReport {
  passed: boolean;
  scenarioName: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: RunReportStep[];
  screenshotOnFailure?: string;
  consoleErrors: string[];
  networkErrors: string[];
}

export interface BuildRunReportInput {
  scenarioName: string;
  steps: Step[];
  results: StepResult[];
  startedAt: number;
  finishedAt: number;
  screenshotOnFailure?: string;
  consoleErrors?: string[];
  networkErrors?: string[];
}

export function buildRunReport(input: BuildRunReportInput): RunReport {
  const { scenarioName, steps, results, startedAt, finishedAt } = input;
  const durationMs = Math.max(0, finishedAt - startedAt);

  const stepById = new Map<string, StepResult>();
  for (const r of results) stepById.set(r.stepId, r);

  const reportSteps: RunReportStep[] = steps.map((step) => {
    const result = stepById.get(step.id);
    if (!result) {
      return { stepId: step.id, action: step.action, status: 'skipped' };
    }
    if (result.passed) {
      return {
        stepId: result.stepId,
        action: step.action,
        status: 'passed',
        attempts: result.attempts,
        durationMs: result.durationMs,
      };
    }
    return {
      stepId: result.stepId,
      action: step.action,
      status: 'failed',
      error: result.error,
      attempts: result.attempts,
      durationMs: result.durationMs,
    };
  });

  const passed =
    results.length === steps.length && results.every((r) => r.passed);

  const screenshotOnFailure = passed ? undefined : input.screenshotOnFailure;

  return {
    passed,
    scenarioName,
    startedAt,
    finishedAt,
    durationMs,
    steps: reportSteps,
    screenshotOnFailure,
    consoleErrors: input.consoleErrors ?? [],
    networkErrors: input.networkErrors ?? [],
  };
}
