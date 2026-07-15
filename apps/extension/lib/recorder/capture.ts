import type {
  ClickStep,
  FillStep,
  KeypressStep,
  NavigateStep,
  Selector,
  UploadStep,
} from '@aitomate/schema';
import { reduceSession, type RecorderSessionState } from './session';

/** Pure Step builders — the recorder assigns `id` when it appends to the log. */
export type RecordedStep =
  | Omit<ClickStep, 'id'>
  | Omit<FillStep, 'id'>
  | Omit<KeypressStep, 'id'>
  | Omit<NavigateStep, 'id'>
  | Omit<UploadStep, 'id'>;

export function buildClickStep(selector: Selector): Omit<ClickStep, 'id'> {
  return { action: 'click', selector };
}

export function buildFillStep(
  selector: Selector,
  value: string | number | boolean,
): Omit<FillStep, 'id'> {
  return { action: 'fill', selector, resolver: { type: 'static', value } };
}

export function buildKeypressStep(
  key: KeypressStep['key'],
  selector?: Selector,
): Omit<KeypressStep, 'id'> {
  return { action: 'keypress', key, selector };
}

export function buildNavigateStep(url: string): Omit<NavigateStep, 'id'> {
  return { action: 'navigate', url };
}

/**
 * Build an upload step for a file-input change event. `fixtureRef` is a path
 * relative to the bundled `public/fixtures/` directory (e.g. `sample.pdf`).
 */
export function buildUploadStep(
  selector: Selector,
  fixtureRef: string,
): Omit<UploadStep, 'id'> {
  return { action: 'upload', selector, fixtureRef };
}

/**
 * Form controls whose value change is captured via the `change` event, not
 * as a separate `click` step — clicking to focus/toggle them would otherwise
 * produce a duplicate, noisier step. Button-like inputs (submit/button/
 * reset/image) never fire `change`, so their clicks must record as clicks.
 *
 * File inputs are NOT value controls: they produce `upload` steps instead
 * (T2.4), so they must not be captured as `fill`.
 */
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

export function isValueControl(el: Element): boolean {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = el.getAttribute('type')?.toLowerCase() ?? 'text';
  return !BUTTON_INPUT_TYPES.has(type) && type !== 'file';
}

export function isFileInput(el: Element): boolean {
  return (
    el.tagName === 'INPUT' &&
    (el.getAttribute('type')?.toLowerCase() ?? 'text') === 'file'
  );
}

export function valueOfControl(el: Element): string | boolean {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked;
  }
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value;
  }
  return '';
}

export interface CaptureNavigationResult {
  session: RecorderSessionState;
  step: Omit<NavigateStep, 'id'> | null;
}

/**
 * T2.13: Pure function combining `reduceSession` + `buildNavigateStep` —
 * replaces the inline session-reduce + step-push logic that currently lives
 * in `entrypoints/background.ts`.
 *
 * Returns the new session state and (if a navigate step should be recorded)
 * a step object. The caller appends the step with a generated id:
 *
 *   const { session, step } = captureNavigation(recording.session, details.url);
 *   recording.session = session;
 *   if (step) recording.steps.push({ id: nextStepId(recording), ...step });
 */
export function captureNavigation(
  state: RecorderSessionState,
  url: string,
): CaptureNavigationResult {
  const next: RecorderSessionState = reduceSession(state, { type: 'NAVIGATE', url });

  if (state.status === 'recording' && next.status === 'recording' && url !== state.originUrl) {
    return { session: next, step: buildNavigateStep(url) };
  }

  return { session: next, step: null };
}
