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
 *      has been stable for a grace period or the step timeout fires. A
 *      rejected send means "no content script listener yet" (post-navigation
 *      injection race, error page, extension reload) — re-probed (each probe
 *      carrying only the *remaining* budget) until the step timeout instead
 *      of surfacing the raw browser error.
 *   2. Execute: send `execute-step` to content script; the content script
 *      performs the actual DOM interaction (T2.4 extends this with
 *      React/Vue/shadow-DOM/iframe support).
 *   3. Retry on failure: exponential backoff with jitter, up to the step's
 *      configured retry count (default 3). The retry budget covers *action*
 *      failures; an unreachable content script fails fast after the
 *      smart-wait horizon (attempts would only burn time on a page that
 *      cannot answer).
 *
 * The content-script response (`passed: boolean`) drives retry logic here.
 * `durationMs` is the step's total elapsed time across all attempts.
 */

export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_BACKOFF_MS = 1000;
export const DEFAULT_DOM_WAIT_TIMEOUT_MS = 30_000;

/** Re-probe interval while waiting for the content script to become reachable. */
export const CONTENT_SCRIPT_PROBE_MS = 300;

/** Run was stopped while the smart-wait probe was waiting. */
class RunAbortedError extends Error {
  constructor() {
    super('Run stopped');
    this.name = 'RunAbortedError';
  }
}

/**
 * The content script never became reachable within the smart-wait horizon.
 * The content-side stability wait never rejects (it resolves on stability or
 * its own timeout), so a `wait-for-dom` rejection always means "no listener
 * right now" — and if that persists for the whole horizon, the page will
 * never answer (error page, extension reloaded, tab killed).
 */
class ContentScriptUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      `The page's content script could not be reached${
        cause !== undefined ? ` (${String(cause)})` : ''
      }`,
    );
    this.name = 'ContentScriptUnreachableError';
  }
}

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

  // Total step time (all attempts + backoff), not just the last attempt —
  // a step that exhausted 3 retries over 3.5s of backoff must report that.
  const stepStartedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - stepStartedAt);

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
      durationMs: elapsed(),
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
        durationMs: elapsed(),
      };
    }

    try {
      await waitForDomStability(tabId, timeoutMs, signal);
    } catch (err) {
      if (err instanceof RunAbortedError) {
        return {
          stepId: step.id,
          passed: false,
          error: err.message,
          attempts: attempt - 1,
          durationMs: elapsed(),
        };
      }
      if (err instanceof ContentScriptUnreachableError) {
        // The precondition (reachable + stable DOM) can never be satisfied
        // on this page — the content script never answered within the step
        // timeout. Re-looping would burn the action's retry budget on a page
        // that will not respond. Fail loud with the real elapsed time.
        return {
          stepId: step.id,
          passed: false,
          error: `DOM stability check failed: ${err.message}`,
          attempts: attempt,
          durationMs: elapsed(),
        };
      }
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
          durationMs: elapsed(),
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
    durationMs: elapsed(),
  };
}

/**
 * Smart-wait: asks the content script to report when the DOM has been stable
 * (no mutations for a grace period). Resolves on success.
 *
 * The content-side stability wait never rejects (it resolves on stability or
 * its own timeout), so a rejection here always means "no content script
 * listener right now" — the classic post-navigation injection race, an error
 * page, or an extension reload. Listener presence is *eventual* when the
 * page loads fine, so re-probe instead of surfacing the raw browser
 * "Receiving end does not exist" and burning the action's retry budget (the
 * smart-wait already runs before the action loop).
 *
 * Each probe carries the *remaining* budget (`timeoutMs - elapsed`), not the
 * full step timeout — the content script opens a stability window per send,
 * so a full budget on every probe would extend the effective horizon to
 * ~2×timeoutMs (probe time + a fresh in-flight window). With the remaining
 * budget the end-to-end horizon is exactly the step timeout.
 */
async function waitForDomStability(
  tabId: number,
  timeoutMs: number,
  signal?: { stopped: () => boolean },
): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (true) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    if (signal?.stopped()) throw new RunAbortedError();
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'aitomate:runner:wait-for-dom',
        timeoutMs: remaining,
      } as RunnerContentCommand);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(CONTENT_SCRIPT_PROBE_MS);
    }
  }
  throw new ContentScriptUnreachableError(lastErr);
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
