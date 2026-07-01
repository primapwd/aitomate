import type { Selector } from '@aitomate/schema';

/**
 * Pure DOM lookup helpers for playback (T2.2). Kept out of the content
 * script entrypoint so they are unit-testable under happy-dom; the
 * entrypoint only wires them to messages and events.
 */

/** Escape a value for use inside a quoted CSS attribute selector. */
export function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Descend through `shadowPath` hosts; null when a host or its root is gone. */
function resolveRoot(sel: Selector, doc: Document): Document | ShadowRoot | null {
  let root: Document | ShadowRoot = doc;
  if (sel.shadowPath?.length) {
    for (const hostSelector of sel.shadowPath) {
      const host: Element | null = root.querySelector(hostSelector);
      if (!host?.shadowRoot) return null;
      root = host.shadowRoot;
    }
  }
  return root;
}

function cssFor(sel: Selector): string | null {
  switch (sel.strategy) {
    case 'testid':
      return `[data-testid="${escapeAttrValue(sel.value)}"]`;
    case 'aria':
      return `[aria-label="${escapeAttrValue(sel.value)}"]`;
    case 'css':
      return sel.value;
    default:
      return null; // id/text need non-CSS lookup
  }
}

/** Resolve a schema `Selector` to the first matching element, or null. */
export function queryElement(sel: Selector, doc: Document = document): Element | null {
  const root = resolveRoot(sel, doc);
  if (!root) return null;

  switch (sel.strategy) {
    case 'id':
      return root.getElementById(sel.value);
    case 'text': {
      for (const el of root.querySelectorAll('*')) {
        if (el.textContent?.trim() === sel.value) return el;
      }
      return null;
    }
    default: {
      const css = cssFor(sel);
      return css ? root.querySelector(css) : null;
    }
  }
}

/** All elements matching the selector — honors strategy and shadowPath. */
export function queryElements(sel: Selector, doc: Document = document): Element[] {
  const root = resolveRoot(sel, doc);
  if (!root) return [];

  switch (sel.strategy) {
    case 'id': {
      const el = root.getElementById(sel.value);
      return el ? [el] : [];
    }
    case 'text':
      return Array.from(root.querySelectorAll('*')).filter(
        (el) => el.textContent?.trim() === sel.value,
      );
    default: {
      const css = cssFor(sel);
      return css ? Array.from(root.querySelectorAll(css)) : [];
    }
  }
}

/** Plain-language-ish selector description for error messages. */
export function selectorDescription(sel: Selector): string {
  return `${sel.strategy}="${sel.value}"`;
}

export function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if ((el as HTMLElement).offsetParent === null) return false;
  return true;
}

/**
 * Poll for an element matching the selector. Resolves with the element or
 * null on timeout.
 */
export function waitForElement(
  sel: Selector,
  timeoutMs: number,
  doc: Document = document,
): Promise<Element | null> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const el = queryElement(sel, doc);
      if (el) return resolve(el);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Glob matching for URL patterns (FR-7 urlMatches):
 * - `**` matches anything, including `/`
 * - `*` matches anything except `/`
 * - `?` matches a single character except `/`
 */
export function matchGlob(url: string, pattern: string): boolean {
  let regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Substitute ** first via a NUL placeholder (cannot occur in a pattern)
  // so the single-star pass below doesn't re-transform the `.*` it becomes.
  regex = regex.replace(/\*\*/g, '\u0000');
  regex = regex.replace(/\*/g, '[^/]*');
  regex = regex.replace(/\?/g, '[^/]');
  regex = regex.replace(/\u0000/g, '.*');
  return new RegExp(`^${regex}$`).test(url);
}

/**
 * True when a step's `framePath` addresses the frame that computed
 * `ownFramePath` (both undefined/empty = top frame). With `allFrames: true`
 * every frame receives runner commands; only the addressed frame may respond,
 * otherwise a wrong-frame "not found" can win the sendMessage race.
 */
export function sameFramePath(
  target: string[] | undefined,
  own: string[] | undefined,
): boolean {
  const a = target ?? [];
  const b = own ?? [];
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}
