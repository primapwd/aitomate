import type { Selector, Step } from '@aitomate/schema';
import { generateSelector } from '@/lib/recorder/selector';
import { computeFramePath } from '@/lib/recorder/frame-path';
import { isExcludedField } from '@/lib/recorder/exclusions';
import {
  buildClickStep,
  buildFillStep,
  buildKeypressStep,
  isValueControl,
  valueOfControl,
} from '@/lib/recorder/capture';
import type { RecorderEvent, RecorderStateMessage } from '@/lib/recorder/messages';
import { initialSessionState, type RecorderSessionState } from '@/lib/recorder/session';
import type { RunnerContentCommand, RunnerContentEvent } from '@/lib/runner/messages';
import {
  isVisible,
  matchGlob,
  queryElement,
  queryElements,
  sameFramePath,
  selectorDescription,
  waitForElement,
} from '@/lib/runner/dom';

/**
 * Content script: recorder DOM layer (FR-1, T2.1) + playback execution
 * (T2.2/T2.4). Both run in the same frame, gated on their respective state
 * machines (recorder state via broadcast, runner state via execute-step
 * commands from the background service worker).
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    let recorderState: RecorderSessionState = initialSessionState;
    const framePath = computeFramePath(window);

    // ── Recorder helpers (unchanged from T2.1) ──

    function sendStep(step: Omit<Step, 'id'>): void {
      const message: RecorderEvent = {
        type: 'aitomate:recorder:step-captured',
        step: step as Step,
      };
      void browser.runtime.sendMessage(message);
    }

    function withFramePath<T extends { selector?: { framePath?: string[] } }>(step: T): T {
      if (!framePath?.length || !step.selector) return step;
      return { ...step, selector: { ...step.selector, framePath } };
    }

    // ── Recorder DOM listeners (unchanged) ──

    document.addEventListener(
      'click',
      (event) => {
        if (recorderState.status !== 'recording') return;
        const target = event.composedPath()[0];
        if (!(target instanceof Element)) return;
        if (isValueControl(target)) return;
        if (isExcludedField(target)) return;

        const selector = generateSelector(target);
        sendStep(withFramePath(buildClickStep(selector)));
      },
      { capture: true },
    );

    document.addEventListener(
      'change',
      (event) => {
        if (recorderState.status !== 'recording') return;
        const target = event.composedPath()[0];
        if (!(target instanceof Element) || !isValueControl(target)) return;
        if (isExcludedField(target)) return;

        const selector = generateSelector(target);
        const value = valueOfControl(target);
        sendStep(withFramePath(buildFillStep(selector, value)));
      },
      { capture: true },
    );

    document.addEventListener(
      'keydown',
      (event) => {
        if (recorderState.status !== 'recording') return;
        if (event.key !== 'Enter' && event.key !== 'Tab' && event.key !== 'Escape') return;
        const target = event.composedPath()[0];
        if (!(target instanceof Element)) return;
        if (!isTypingContext(target)) return;
        if (isExcludedField(target)) return;

        const selector = generateSelector(target);
        sendStep(withFramePath(buildKeypressStep(event.key, selector)));
      },
      { capture: true },
    );

    // ── Message listener: recorder broadcasts + runner commands ──

    browser.runtime.onMessage.addListener(
      (message: RecorderStateMessage | RunnerContentCommand):
        | void
        | Promise<RunnerContentEvent> => {
        // Recorder state broadcast (background → content) — fire-and-forget.
        if (message.type === 'aitomate:recorder:state') {
          recorderState = message.state;
          return;
        }

        // Runner commands (background → content) — async responses. With
        // allFrames: true every frame gets these; only the addressed frame
        // may respond, or a wrong-frame "not found" wins the response race.
        switch (message.type) {
          case 'aitomate:runner:execute-step': {
            const target = stepSelector(message.step)?.framePath;
            if (!sameFramePath(target, framePath)) return;
            return executeStep(message.step);
          }
          case 'aitomate:runner:wait-for-dom':
            if (framePath) return; // only the top frame answers tab-wide waits
            return waitForDomStability(message.timeoutMs).then(() => ({
              type: 'aitomate:runner:dom-stable' as const,
            }));
          default:
            return;
        }
      },
    );

    // Sync session state with background on frame (re)load.
    const getStateMessage: RecorderEvent = { type: 'aitomate:recorder:get-state' };
    browser.runtime
      .sendMessage(getStateMessage)
      .then((response: RecorderSessionState | undefined) => {
        if (response) recorderState = response;
      })
      .catch(() => {});
  },
});

// ─────────────────────────────────────────────
// Runner: step execution (T2.2 basic, T2.4 extends)
// ─────────────────────────────────────────────

async function executeStep(step: Step): Promise<RunnerContentEvent> {
  try {
    switch (step.action) {
      case 'click':
        return executeClick(step);
      case 'fill':
        return executeFill(step);
      case 'keypress':
        return executeKeypress(step);
      case 'wait':
        return executeWait(step);
      case 'assert':
        return executeAssert(step);
      case 'upload':
        return {
          type: 'aitomate:runner:step-executed',
          stepId: step.id,
          passed: false,
          error: 'File upload not yet implemented (T2.4)',
        };
      default:
        return {
          type: 'aitomate:runner:step-executed',
          stepId: step.id,
          passed: false,
          error: `Unknown step action: ${(step as Step & { action: string }).action}`,
        };
    }
  } catch (err) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: String(err),
    };
  }
}

async function executeClick(step: Step & { action: 'click' }): Promise<RunnerContentEvent> {
  const el = queryElement(step.selector);
  if (!el) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: `Element not found: ${selectorDescription(step.selector)}`,
    };
  }
  scrollIntoView(el);
  (el as HTMLElement).click();
  return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
}

async function executeFill(step: Step & { action: 'fill' }): Promise<RunnerContentEvent> {
  const el = queryElement(step.selector);
  if (!el) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: `Element not found: ${selectorDescription(step.selector)}`,
    };
  }
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: 'Target is not a form control',
    };
  }
  if (step.resolver.type !== 'static') {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: `Resolver type '${step.resolver.type}' not handled by content script (resolved in background via T2.3)`,
    };
  }
  scrollIntoView(el);
  el.focus();
  const value = String(step.resolver.value);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
}

async function executeKeypress(step: Step & { action: 'keypress' }): Promise<RunnerContentEvent> {
  let target: Element | null = null;
  if (step.selector) {
    target = queryElement(step.selector);
    if (!target) {
      return {
        type: 'aitomate:runner:step-executed',
        stepId: step.id,
        passed: false,
        error: `Element not found: ${selectorDescription(step.selector)}`,
      };
    }
  } else {
    target = document.activeElement;
  }
  if (!target) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: 'No active element for keypress',
    };
  }

  const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  };
  const ev = keyMap[step.key];
  if (!ev) {
    return {
      type: 'aitomate:runner:step-executed',
      stepId: step.id,
      passed: false,
      error: `Unsupported key: ${step.key}`,
    };
  }

  target.dispatchEvent(new KeyboardEvent('keydown', { ...ev, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keypress', { ...ev, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { ...ev, bubbles: true }));
  return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
}

async function executeWait(step: Step & { action: 'wait' }): Promise<RunnerContentEvent> {
  if (step.durationMs) {
    await sleep(step.durationMs);
  }
  if (step.forSelector) {
    const found = await waitForElement(step.forSelector, step.options?.timeoutMs ?? 10_000);
    if (!found) {
      return {
        type: 'aitomate:runner:step-executed',
        stepId: step.id,
        passed: false,
        error: `Element did not appear: ${selectorDescription(step.forSelector)}`,
      };
    }
  }
  return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
}

async function executeAssert(step: Step & { action: 'assert' }): Promise<RunnerContentEvent> {
  const a = step.assertion;
  const stepId = step.id;
  switch (a) {
    case 'elementVisible': {
      const el = queryElement(step.selector);
      return result(step.id, el !== null && isVisible(el));
    }
    case 'elementNotVisible': {
      const el = queryElement(step.selector);
      return result(step.id, el === null || !isVisible(el));
    }
    case 'textContains': {
      const el = queryElement(step.selector);
      if (!el) return result(step.id, false, 'Element not found');
      const text = el.textContent?.trim() ?? '';
      const value = step.value;
      const matches = step.caseInsensitive
        ? text.toLowerCase().includes(value.toLowerCase())
        : text.includes(value);
      return result(step.id, matches);
    }
    case 'textEquals': {
      const el = queryElement(step.selector);
      if (!el) return result(step.id, false, 'Element not found');
      return result(step.id, (el.textContent?.trim() ?? '') === step.value);
    }
    case 'inputValue': {
      const el = queryElement(step.selector);
      if (!el) return result(step.id, false, 'Element not found');
      const val = (el as HTMLInputElement).value ?? '';
      return result(step.id, val === step.value);
    }
    case 'urlMatches': {
      const current = window.location.href;
      if (step.patternType === 'regex') {
        try {
          return result(step.id, new RegExp(step.pattern).test(current));
        } catch {
          return result(step.id, false, `Invalid regex: ${step.pattern}`);
        }
      }
      // Glob pattern — simple implementation supporting ** and *
      return result(step.id, matchGlob(current, step.pattern));
    }
    case 'elementCount': {
      const count = queryElements(step.selector).length;
      switch (step.comparator) {
        case 'eq':
          return result(step.id, count === step.count);
        case 'gte':
          return result(step.id, count >= step.count);
        case 'lte':
          return result(step.id, count <= step.count);
        default:
          return result(step.id, false, `Unknown comparator: ${String(step.comparator)}`);
      }
    }
    case 'elementEnabled': {
      const el = queryElement(step.selector);
      if (!el) return result(step.id, false, 'Element not found');
      return result(step.id, !(el as HTMLInputElement).disabled);
    }
    case 'elementDisabled': {
      const el = queryElement(step.selector);
      if (!el) return result(step.id, false, 'Element not found');
      return result(step.id, (el as HTMLInputElement).disabled === true);
    }
    default:
      return result(stepId, false, `Unknown assertion: ${a}`);
  }
}

function result(
  stepId: string,
  passed: boolean,
  error?: string,
): RunnerContentEvent {
  return { type: 'aitomate:runner:step-executed', stepId, passed, error };
}

// ─────────────────────────────────────────────
// DOM stability / smart-wait
// ─────────────────────────────────────────────

async function waitForDomStability(timeoutMs = 30_000): Promise<void> {
  if (document.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let observer: MutationObserver;

    const done = () => {
      clearTimeout(timer);
      observer?.disconnect();
      resolve();
    };

    // If no mutations for 500ms, DOM is stable.
    const onMutation = () => {
      clearTimeout(timer);
      timer = setTimeout(done, 500);
    };

    observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    // Prime the timer so stability is detected even if no mutations occur.
    timer = setTimeout(done, 500);

    // Overall timeout: resolve anyway to avoid hanging the runner.
    setTimeout(() => {
      observer?.disconnect();
      resolve();
    }, timeoutMs);
  });
}

// ─────────────────────────────────────────────
// Local DOM glue (pure lookup helpers live in lib/runner/dom.ts)
// ─────────────────────────────────────────────

/** The selector a step targets, deciding which frame executes it. */
function stepSelector(step: Step): Selector | undefined {
  switch (step.action) {
    case 'click':
    case 'fill':
    case 'upload':
      return step.selector;
    case 'keypress':
      return step.selector;
    case 'wait':
      return step.forSelector;
    case 'assert':
      return 'selector' in step ? step.selector : undefined;
    default:
      return undefined;
  }
}

function scrollIntoView(el: Element): void {
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Recorder helpers (unchanged from T2.1)
// ─────────────────────────────────────────────

function isTypingContext(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}
