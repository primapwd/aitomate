import type { Selector, Step } from '@aitomate/schema';
import { generateSelector } from '@/lib/recorder/selector';
import { computeFramePath } from '@/lib/recorder/frame-path';
import { isExcludedField } from '@/lib/recorder/exclusions';
import {
  buildClickStep,
  buildFillStep,
  buildKeypressStep,
  buildUploadStep,
  isFileInput,
  isValueControl,
  valueOfControl,
} from '@/lib/recorder/capture';
import type { RecorderEvent, RecorderStateMessage } from '@/lib/recorder/messages';
import { initialSessionState, type RecorderSessionState } from '@/lib/recorder/session';
import type { RunnerContentCommand, RunnerContentEvent } from '@/lib/runner/messages';
import { parseCaptureMessage } from '@/lib/runner/capture';
import {
  isTruthyValue,
  isVisible,
  matchGlob,
  queryElement,
  queryElements,
  sameFramePath,
  selectorDescription,
  setNativeChecked,
  setNativeValue,
  stepSelector,
  waitForAssertion,
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
        generation: recorderState.generation,
      };
      void browser.runtime.sendMessage(message);
    }

    function withFramePath<T extends { selector?: { framePath?: string[] } }>(step: T): T {
      if (!framePath?.length || !step.selector) return step;
      return { ...step, selector: { ...step.selector, framePath } };
    }

    // ── Run-report capture relay (FR-5) ──
    // Top frame only: with `allFrames: true`, every frame would otherwise
    // forward the same tab's errors and race writes; iframe page errors are
    // a documented v1 limitation. Installed synchronously at boot — no
    // bootstrap round trip — so no page error in the first moments of a
    // page can be missed.
    //
    // Page errors arrive over postMessage from the MAIN-world capture
    // script (entrypoints/capture.content.ts): an isolated-world `error`
    // listener does NOT receive page-world uncaught exceptions.
    //
    // The relay forwards to the background rather than writing
    // storage.session directly — content scripts cannot access it
    // ("Access to storage is not allowed from this context"); the
    // background keys the entry by `sender.tab.id`.
    if (!framePath) {
      window.addEventListener('message', (event) => {
        const entry = parseCaptureMessage(
          event.data,
          event.origin,
          window.location.origin,
        );
        if (!entry) return;
        void browser.runtime.sendMessage({
          type: 'aitomate:runner:capture-entry',
          entry,
        } as RunnerContentEvent);
      });
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
        if (!(target instanceof Element)) return;
        if (isExcludedField(target)) return;

        const selector = generateSelector(target);

        // File inputs become upload steps (T2.4); all other value controls
        // become fill steps.
        if (isFileInput(target)) {
          // The file name is used as a placeholder fixtureRef — the user
          // replaces it via the Build UI before playback.
          const files = (target as HTMLInputElement).files;
          const fixtureRef = files?.length ? files[0].name : 'upload';
          sendStep(withFramePath(buildUploadStep(selector, fixtureRef)));
          return;
        }

        if (!isValueControl(target)) return;
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
        | Promise<RunnerContentEvent | { found: boolean; error?: string }> => {
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
          case 'aitomate:runner:locate-element':
            if (!sameFramePath(message.selector.framePath, framePath)) return;
            return handleLocateElement(message.selector);
          case 'aitomate:runner:pick-element':
            return handlePickElement();
          case 'aitomate:runner:cancel-pick':
            cancelPick();
            return;
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
        return executeUpload(step);
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
  // Checkbox/radio state lives in `checked`, not `value` — the recorder
  // captures it as a boolean, and setting value never toggles the control.
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    setNativeChecked(el, isTruthyValue(step.resolver.value));
    el.blur();
    return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
  }
  const value = String(step.resolver.value);
  // Use native prototype setter so React/Vue controlled inputs register the
  // change (T2.4). The setter dispatches input + change events.
  setNativeValue(el, value);
  el.blur();
  return { type: 'aitomate:runner:step-executed', stepId: step.id, passed: true };
}

async function executeUpload(step: Step & { action: 'upload' }): Promise<RunnerContentEvent> {
  const el = queryElement(step.selector);
  if (!el || !(el instanceof HTMLInputElement) || el.type !== 'file') {
    return result(step.id, false, 'Target is not a file input');
  }

  // Load the fixture from the extension's bundled fixtures/ directory.
  // fixtureRef is dynamic, so it can't satisfy WXT's generated PublicPath
  // union — hence the argument cast. fixtures/* must stay listed in
  // web_accessible_resources or this fetch is blocked on real pages.
  const fixtureUrl = browser.runtime.getURL(
    `/fixtures/${step.fixtureRef}` as Parameters<typeof browser.runtime.getURL>[0],
  );
  const fileName = step.fixtureRef.split('/').pop() ?? 'file';

  let blob: Blob;
  try {
    const response = await fetch(fixtureUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (err) {
    return result(step.id, false, `Cannot load fixture "${step.fixtureRef}": ${err}`);
  }

  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  const dt = new DataTransfer();
  dt.items.add(file);

  // Set the FileList via the native prototype setter — React intercepts the
  // instance 'files' property the same way it does for 'value'.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
  if (descriptor?.set) {
    descriptor.set.call(el, dt.files);
  } else {
    el.files = dt.files;
  }
  // Real file selection fires input then change; dispatch both for parity.
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return result(step.id, true);
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
  // Assertions poll until the condition is met or the timeout fires, like
  // real test assertions. Default 10s; override via step.options.timeoutMs.
  const timeout = step.options?.timeoutMs ?? 10_000;

  switch (a) {
    case 'elementVisible': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        return el !== null && isVisible(el);
      }, timeout);
      if (ok) return result(stepId, true);
      return result(
        stepId,
        false,
        `Expected element to be visible but it was not found or is hidden: ${selectorDescription(step.selector)}`,
      );
    }

    case 'elementNotVisible': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        return el === null || !isVisible(el);
      }, timeout);
      if (ok) return result(stepId, true);
      return result(
        stepId,
        false,
        `Expected element to be absent or hidden but it is visible: ${selectorDescription(step.selector)}`,
      );
    }

    case 'textContains': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        if (!el) return false;
        const text = el.textContent?.trim() ?? '';
        return step.caseInsensitive
          ? text.toLowerCase().includes(step.value.toLowerCase())
          : text.includes(step.value);
      }, timeout);
      if (ok) return result(stepId, true);
      const el = queryElement(step.selector);
      const actual = el?.textContent?.trim() ?? '(element not found)';
      return result(
        stepId,
        false,
        `Expected element text to contain "${step.value}" but found "${actual}": ${selectorDescription(step.selector)}`,
      );
    }

    case 'textEquals': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        if (!el) return false;
        return (el.textContent?.trim() ?? '') === step.value;
      }, timeout);
      if (ok) return result(stepId, true);
      const el = queryElement(step.selector);
      const actual = el?.textContent?.trim() ?? '(element not found)';
      return result(
        stepId,
        false,
        `Expected element text to equal "${step.value}" but found "${actual}": ${selectorDescription(step.selector)}`,
      );
    }

    case 'inputValue': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        if (!el) return false;
        return ((el as HTMLInputElement).value ?? '') === step.value;
      }, timeout);
      if (ok) return result(stepId, true);
      const el = queryElement(step.selector);
      const actual = el ? (el as HTMLInputElement).value ?? '' : '(element not found)';
      return result(
        stepId,
        false,
        `Expected input value to be "${step.value}" but found "${actual}": ${selectorDescription(step.selector)}`,
      );
    }

    case 'urlMatches': {
      if (step.patternType === 'regex') {
        try {
          const ok = await waitForAssertion(
            () => new RegExp(step.pattern).test(window.location.href),
            timeout,
          );
          if (ok) return result(stepId, true);
          return result(
            stepId,
            false,
            `Expected URL to match regex "${step.pattern}" but current URL is "${window.location.href}"`,
          );
        } catch {
          return result(
            stepId,
            false,
            `URL pattern is not a valid regular expression: "${step.pattern}"`,
          );
        }
      }
      const ok = await waitForAssertion(
        () => matchGlob(window.location.href, step.pattern),
        timeout,
      );
      if (ok) return result(stepId, true);
      return result(
        stepId,
        false,
        `Expected URL to match pattern "${step.pattern}" but current URL is "${window.location.href}"`,
      );
    }

    case 'elementCount': {
      const ok = await waitForAssertion(() => {
        const count = queryElements(step.selector).length;
        switch (step.comparator) {
          case 'eq':
            return count === step.count;
          case 'gte':
            return count >= step.count;
          case 'lte':
            return count <= step.count;
          default:
            return false;
        }
      }, timeout);
      if (ok) return result(stepId, true);
      const actualCount = queryElements(step.selector).length;
      const cmp = step.comparator === 'eq' ? '=' : step.comparator === 'gte' ? '≥' : '≤';
      return result(
        stepId,
        false,
        `Expected element count ${cmp} ${step.count} but found ${actualCount}: ${selectorDescription(step.selector)}`,
      );
    }

    case 'elementEnabled': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        return el !== null && !(el as HTMLInputElement).disabled;
      }, timeout);
      if (ok) return result(stepId, true);
      return result(
        stepId,
        false,
        `Expected element to be enabled but it is disabled: ${selectorDescription(step.selector)}`,
      );
    }

    case 'elementDisabled': {
      const ok = await waitForAssertion(() => {
        const el = queryElement(step.selector);
        return el !== null && (el as HTMLInputElement).disabled === true;
      }, timeout);
      if (ok) return result(stepId, true);
      return result(
        stepId,
        false,
        `Expected element to be disabled but it is enabled: ${selectorDescription(step.selector)}`,
      );
    }

    default:
      return result(
        stepId,
        false,
        `Unknown assertion "${a}". Valid assertions: elementVisible, elementNotVisible, textContains, textEquals, inputValue, urlMatches, elementCount, elementEnabled, elementDisabled`,
      );
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

// ── Locate element (T2.12) ──────────────────

const LOCATE_FLASH_STYLE_ID = 'aitomate-locate-flash-keyframes';

/** Injects the flash @keyframes once per document instead of once per click. */
function ensureFlashKeyframes(): void {
  if (document.getElementById(LOCATE_FLASH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LOCATE_FLASH_STYLE_ID;
  style.textContent = `@keyframes aitomate-flash { 0%,100% { outline-color:#ffc10700 } 50% { outline-color:#ffc107 } }`;
  document.head.appendChild(style);
}

async function handleLocateElement(selector: Selector): Promise<RunnerContentEvent> {
  const el = queryElement(selector);
  if (!el) {
    return {
      type: 'aitomate:runner:element-located',
      found: false,
      error: `Element not found: ${selectorDescription(selector)}`,
    };
  }

  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  ensureFlashKeyframes();

  const origOutline = (el as HTMLElement).style.outline;
  const origOutlineOffset = (el as HTMLElement).style.outlineOffset;
  const origAnimation = (el as HTMLElement).style.animation;
  (el as HTMLElement).style.outline = '3px solid #ffc107';
  (el as HTMLElement).style.outlineOffset = '2px';
  (el as HTMLElement).style.animation = 'aitomate-flash 0.6s ease-in-out 3';

  setTimeout(() => {
    (el as HTMLElement).style.outline = origOutline;
    (el as HTMLElement).style.outlineOffset = origOutlineOffset;
    (el as HTMLElement).style.animation = origAnimation;
  }, 2000);

  return { type: 'aitomate:runner:element-located', found: true };
}

// ── Pick element (devtools-style inspect-and-click, PO/QA selector picking) ──

let pickCleanup: (() => void) | null = null;

/**
 * Lets a non-technical user point at an element instead of reading DOM/
 * devtools to find a selector. Runs in every frame (mirrors execute-step's
 * all_frames pattern) — whichever frame the user actually clicks in is the
 * one that resolves; that's correct here, not a race to guard against,
 * since the target frame isn't known ahead of time.
 */
function handlePickElement(): Promise<RunnerContentEvent> {
  cancelPick();

  return new Promise((resolve) => {
    document.body.style.cursor = 'crosshair';
    let hovered: HTMLElement | null = null;

    const clearHover = () => {
      if (hovered) {
        hovered.style.outline = '';
        hovered.style.outlineOffset = '';
        hovered = null;
      }
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = event.composedPath()[0];
      if (!(target instanceof HTMLElement) || target === hovered) return;
      clearHover();
      hovered = target;
      hovered.style.outline = '2px solid #ffc107';
      hovered.style.outlineOffset = '1px';
    };

    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.composedPath()[0];
      if (!(target instanceof Element)) return;
      const selector = generateSelector(target);
      const framePath = computeFramePath(window);
      finish({
        type: 'aitomate:runner:element-picked',
        selector: framePath?.length ? { ...selector, framePath } : selector,
      });
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      finish({ type: 'aitomate:runner:pick-cancelled' });
    };

    const finish = (result: RunnerContentEvent) => {
      cancelPick();
      resolve(result);
    };

    document.addEventListener('mouseover', onMouseOver, { capture: true });
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('keydown', onKeydown, { capture: true });

    pickCleanup = () => {
      document.body.style.cursor = '';
      clearHover();
      document.removeEventListener('mouseover', onMouseOver, { capture: true });
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('keydown', onKeydown, { capture: true });
    };
  });
}

function cancelPick(): void {
  pickCleanup?.();
  pickCleanup = null;
}

// ─────────────────────────────────────────────
// Local DOM glue (pure lookup helpers live in lib/runner/dom.ts)
// ─────────────────────────────────────────────

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
