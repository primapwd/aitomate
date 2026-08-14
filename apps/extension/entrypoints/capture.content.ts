import { errorEventText, rejectionText } from '@/lib/runner/capture-text';

/**
 * Run-report capture, page context (FR-5): forwards page-world uncaught
 * exceptions, unhandled rejections, and resource load failures to the
 * isolated-world content script over `postMessage`.
 *
 * Why MAIN world: an isolated-world `window` `error` listener does NOT
 * receive page-world uncaught exceptions (verified empirically on MV3) —
 * the DOM event is dispatched in the world where the exception occurred.
 * Running in the page context also makes the capture immune to page CSP
 * (manifest content scripts are extension scripts, not subject to the
 * page's script-src).
 *
 * Top frame only: with `allFrames: true` every frame would forward into the
 * same tab-scoped buffer; iframe page errors are a documented v1
 * limitation.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  world: 'MAIN',
  main() {
    if (window.top !== window) return;

    const forward = (text: string) => {
      window.postMessage(
        { source: 'aitomate-capture', text, timestamp: Date.now() },
        '*',
      );
    };

    // Capture phase also sees resource load failures (img/script/fetch),
    // which don't bubble to window in the bubble phase.
    window.addEventListener(
      'error',
      (event) => {
        forward(errorEventText(event));
      },
      true,
    );

    window.addEventListener('unhandledrejection', (event) => {
      forward(`Unhandled rejection: ${rejectionText(event.reason)}`);
    });
  },
});
