/**
 * Pure text extractors for run-report capture (FR-5). Kept free of any
 * `browser.*` import so the MAIN-world capture script
 * (entrypoints/capture.content.ts) can use them — a page-context script
 * must not pull the extension API polyfill into the page.
 */

/**
 * Human-readable text from a window `error` event. Two shapes:
 * - uncaught exceptions are `ErrorEvent`s targeting `window`;
 * - resource load failures (img/script/fetch) are plain `Event`s targeting
 *   the failed element — only visible to a capture-phase listener.
 */
export function errorEventText(event: Event): string {
  const isResource =
    event.target !== window && !(event instanceof ErrorEvent);
  if (isResource) {
    const el = event.target as HTMLElement;
    const src =
      (el as HTMLImageElement).src ||
      (el as HTMLScriptElement).src ||
      el.tagName.toLowerCase();
    return `Failed to load resource: ${src}`;
  }
  const err = (event as ErrorEvent).error;
  const message = (event as ErrorEvent).message ?? '';
  if (err instanceof Error && err.message) return `${err.name}: ${err.message}`;
  if (message) return message;
  return 'Uncaught error';
}

/** Human-readable text from a promise rejection reason. */
export function rejectionText(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    const json = JSON.stringify(reason);
    if (json !== undefined) return json;
  } catch {
    // non-serializable reason — fall through
  }
  return String(reason);
}
