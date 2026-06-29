import type { Selector } from '@aitomate/schema';

/**
 * Multi-strategy selector generation (FR-1 fallback order): testid > id >
 * aria-label > CSS structural path > text content. The CSS path is built
 * from `nth-of-type` at every level up to `root`, so it is always unique —
 * `text` is reachable only when even that fails (a detached element).
 */

function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function isUnique(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function buildCssPath(el: Element, root: ParentNode): string | undefined {
  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) {
      // Reached the top of this root (e.g. direct child of a shadow root).
      const tag = node.tagName.toLowerCase();
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    const tag = node.tagName.toLowerCase();
    parts.unshift(
      siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag,
    );
    node = parent;
  }

  return parts.length ? parts.join(' > ') : undefined;
}

function textContentOf(el: Element, maxLength = 60): string | undefined {
  const text = el.textContent?.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** A plain CSS selector string for `el`, used for shadow/frame host paths. */
export function simpleSelectorString(el: Element, root: ParentNode = document): string {
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${escapeAttrValue(testid)}"]`;

  if (el.id && isUnique(root, `#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  return buildCssPath(el, root) ?? el.tagName.toLowerCase();
}

/**
 * Generates a `Selector` for `el`, resolved within its own root (the
 * document, or the nearest shadow root if `el` lives inside one).
 * `shadowPath` is filled in automatically by walking shadow-host boundaries;
 * `framePath` is per-frame context the caller adds separately (see
 * `computeFramePath`), since it doesn't change per element.
 */
export function generateSelector(el: Element): Selector {
  const root = el.getRootNode() as ParentNode;

  const testid = el.getAttribute('data-testid');
  let base: Omit<Selector, 'shadowPath' | 'framePath'> | undefined;

  if (testid) {
    base = { strategy: 'testid', value: testid };
  } else if (el.id && isUnique(root, `#${CSS.escape(el.id)}`)) {
    base = { strategy: 'id', value: el.id };
  } else {
    const aria = el.getAttribute('aria-label');
    const ariaSelector = aria ? `[aria-label="${escapeAttrValue(aria)}"]` : undefined;
    if (aria && ariaSelector && isUnique(root, ariaSelector)) {
      base = { strategy: 'aria', value: aria };
    } else {
      const css = buildCssPath(el, root);
      if (css) {
        base = { strategy: 'css', value: css };
      } else {
        const text = textContentOf(el);
        base = text
          ? { strategy: 'text', value: text }
          : { strategy: 'css', value: el.tagName.toLowerCase() };
      }
    }
  }

  const shadowPath = computeShadowPath(el);
  return shadowPath.length ? { ...base, shadowPath } : base;
}

/** Ordered list of shadow-host selectors from outermost to innermost. */
export function computeShadowPath(el: Element): string[] {
  const hosts: string[] = [];
  let root: ParentNode = el.getRootNode() as ParentNode;

  while (root instanceof ShadowRoot) {
    const host = root.host;
    const hostRoot = host.getRootNode() as ParentNode;
    hosts.unshift(simpleSelectorString(host, hostRoot));
    root = hostRoot;
  }

  return hosts;
}
