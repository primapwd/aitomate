import type { Step } from '@aitomate/schema';
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

/**
 * Recorder DOM layer (FR-1). Playback (T2.4) lands in this same content
 * script later. All listeners are registered once and gated on `status`, so
 * toggling recording on/off doesn't need to attach/detach handlers.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    let state: RecorderSessionState = initialSessionState;
    // Computed once per frame instance — same for every element in this frame.
    const framePath = computeFramePath(window);

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

    document.addEventListener(
      'click',
      (event) => {
        if (state.status !== 'recording') return;
        const target = event.composedPath()[0];
        if (!(target instanceof Element)) return;
        // Value controls (incl. checkbox/radio) are captured via `change`
        // instead, to avoid a duplicate/noisier step for one interaction.
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
        if (state.status !== 'recording') return;
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
        if (state.status !== 'recording') return;
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

    browser.runtime.onMessage.addListener((message: RecorderStateMessage) => {
      if (message.type !== 'aitomate:recorder:state') return;
      state = message.state;
    });

    // Pick up the current session in case recording started before this
    // frame (re-)loaded, e.g. after a same-origin navigation.
    const getStateMessage: RecorderEvent = { type: 'aitomate:recorder:get-state' };
    browser.runtime
      .sendMessage(getStateMessage)
      .then((response: RecorderSessionState | undefined) => {
        if (response) state = response;
      })
      .catch(() => {
        // Background may not be ready yet on very first install; harmless.
      });
  },
});

function isTypingContext(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}
