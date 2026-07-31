import type { Step } from '@aitomate/schema';
import { browser } from 'wxt/browser';
import type {
  RunnerContentCommand,
  RunnerContentEvent,
  StepResult,
} from './messages';
import { resolveStepValues, type LlmGenerateFn } from './value-resolver';
import { debugLog } from '@/lib/debug';

/**
 * Step execution with per-step retry/backoff + smart-wait (T2.2).
 *
 * Each step goes through:
 *   1. Smart-wait: send `wait-for-dom` to content script; resolves when DOM
 *      has been stable for a grace period or the timeout fires.
 *   2. Execute: send `execute-step` to content script; the content script
 *      performs the actual DOM interaction (T2.4 extends this with
 *      React/Vue/shadow-DOM/iframe support).
 *   3. Retry on failure: exponential backoff with jitter, up to the step's
 *      configured retry count (default 3).
 *
 * The content-script response (`passed: boolean`) drives retry logic here.
 */

export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_BACKOFF_MS = 1000;
export const DEFAULT_DOM_WAIT_TIMEOUT_MS = 30_000;

/**
 * Core public API: execute a single step against the given tab, with retry.
 *
 * `navigate` steps are handled by the background via `tabs.update` (they would
 * destroy the content-script instance). All other step types are forwarded to
 * the content script for DOM interaction.
 */
/** Replace {{BASE_URL}} in a URL string with the given base. */
export function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  const trimmed = baseUrl.replace(/\/+$/, '');
  // Replacer must be a function, not a string — `String.prototype.replace`
  // treats `$&`/`$$`/`` $` ``/`$'` specially in a string replacement, so a
  // base URL containing a literal `$` (e.g. in basic-auth credentials or a
  // query param) would otherwise corrupt the resolved URL.
  return url.replace(/\{\{BASE_URL\}\}/g, () => trimmed);
}

export async function executeStepWithRetry(
  tabId: number,
  step: Step,
  signal?: { stopped: () => boolean },
  llmGenerate?: LlmGenerateFn,
  baseUrl?: string,
): Promise<StepResult> {
  const maxRetries = step.options?.retry?.count ?? DEFAULT_RETRY_COUNT;
  const baseBackoff = step.options?.retry?.backoffMs ?? DEFAULT_BACKOFF_MS;

  if (step.action === 'navigate') {
    return executeNavigation(tabId, step, baseUrl);
  }

  return executeDomStep(tabId, step, maxRetries, baseBackoff, signal, llmGenerate);
}

async function executeNavigation(
  tabId: number,
  step: Step & { action: 'navigate' },
  baseUrl?: string,
): Promise<StepResult> {
  const resolvedUrl = resolveUrl(step.url, baseUrl);
  debugLog('step-exec', `navigate tab=${tabId} url=${resolvedUrl}`);
  const startTime = performance.now();

  // tabs.update doesn't reject an unresolved "{{BASE_URL}}/..." string — it's
  // not a valid absolute URL, but Chrome accepts it and the navigation just
  // goes nowhere real. Left unchecked, this step reports passed=true and the
  // *next* step fails with an unrelated-looking "no content script" error,
  // hiding the actual cause (Constitution: fail loud, fail clear).
  if (resolvedUrl.includes('{{BASE_URL}}')) {
    return {
      stepId: step.id,
      passed: false,
      error: 'Navigate step needs {{BASE_URL}} but no Base URL is set — enter one in the Run view.',
      attempts: 1,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  try {
    const url = resolvedUrl.startsWith('http') ? resolvedUrl : undefined;
    await browser.tabs.update(tabId, { url: resolvedUrl });
    if (url) {
      await waitForTabLoad(tabId, DEFAULT_DOM_WAIT_TIMEOUT_MS);
    }
    return {
      stepId: step.id,
      passed: true,
      attempts: 1,
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return {
      stepId: step.id,
      passed: false,
      error: `Navigation failed: ${String(err)}`,
      attempts: 1,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

async function executeDomStep(
  tabId: number,
  step: Step,
  maxRetries: number,
  baseBackoff: number,
  signal?: { stopped: () => boolean },
  llmGenerate?: LlmGenerateFn,
): Promise<StepResult> {
  const timeoutMs = step.options?.timeoutMs ?? DEFAULT_DOM_WAIT_TIMEOUT_MS;

  // Resolve dynamic/AI/DB values once before the retry loop (T2.3). The
  // content script receives a static resolver and never needs to know about
  // resolver modes. On retry the same resolved value is reused. Resolution
  // failures (e.g. a resolver mode that isn't implemented yet) are a step
  // failure, not a crash — the run loop expects a StepResult, never a throw.
  try {
    step = await resolveStepValues(step, llmGenerate);
  } catch (err) {
    return {
      stepId: step.id,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      attempts: 0,
      durationMs: 0,
    };
  }

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    debugLog('step-exec', `step=${step.id} action=${step.action} attempt=${attempt}/${maxRetries}`);
    if (signal?.stopped()) {
      return {
        stepId: step.id,
        passed: false,
        error: 'Run stopped',
        attempts: attempt - 1,
        durationMs: 0,
      };
    }

    const startTime = performance.now();

    try {
      await waitForDomStability(tabId, timeoutMs);
    } catch (err) {
      lastError = `DOM stability check failed: ${String(err)}`;
      if (attempt < maxRetries) {
        await backoff(baseBackoff, attempt);
      }
      continue;
    }

    try {
      const response = (await browser.tabs.sendMessage(tabId, {
        type: 'aitomate:runner:execute-step',
        step,
      } as RunnerContentCommand)) as RunnerContentEvent;

      if (response.type === 'aitomate:runner:step-executed' && response.passed) {
        return {
          stepId: step.id,
          passed: true,
          attempts: attempt,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      lastError = response.type === 'aitomate:runner:step-executed'
        ? response.error ?? 'Step returned false without error'
        : 'Unexpected response from content script';
    } catch (err) {
      lastError = String(err);
    }

    if (attempt < maxRetries) {
      await backoff(baseBackoff, attempt);
    }
  }

  return {
    stepId: step.id,
    passed: false,
    error: lastError,
    attempts: maxRetries,
    durationMs: 0,
  };
}

/**
 * Smart-wait: asks the content script to report when the DOM has been stable
 * (no mutations for a grace period). Resolves on success; rejects on timeout.
 */
async function waitForDomStability(
  tabId: number,
  timeoutMs: number,
): Promise<void> {
  await browser.tabs.sendMessage(tabId, {
    type: 'aitomate:runner:wait-for-dom',
    timeoutMs,
  } as RunnerContentCommand);
}

/**
 * Exponential backoff with jitter: base * 2^(attempt-1) + [0, 50% jitter).
 */
export function calculateBackoff(base: number, attempt: number): number {
  const exponential = base * 2 ** (attempt - 1);
  const jitter = exponential * 0.5 * Math.random();
  return Math.round(exponential + jitter);
}

function backoff(base: number, attempt: number): Promise<void> {
  const ms = calculateBackoff(base, attempt);
  return sleep(ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a tab to finish loading after a navigation. Resolves when
 * `tab.status === 'complete'` or the timeout fires (graceful degradation).
 */
async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(300);
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      return; // tab may have been removed — bail.
    }
  }
}
