import { simpleSelectorString } from './selector';

/**
 * Ordered list of same-origin iframe selectors from the top document down to
 * the frame `win` runs in — `undefined` for the top frame itself, or when a
 * cross-origin boundary makes the chain unresolvable (documented MVP
 * limitation, FR-6: the recorder should warn when this happens).
 */
export function computeFramePath(win: Window): string[] | undefined {
  if (win === win.top) return undefined;

  const path: string[] = [];
  let current: Window = win;

  while (current !== current.top) {
    let frameEl: Element | null;
    let parentDoc: Document;
    try {
      frameEl = current.frameElement;
      parentDoc = current.parent.document;
    } catch {
      return undefined; // cross-origin — can't read frameElement/parent.document
    }
    if (!frameEl) return undefined;

    path.unshift(simpleSelectorString(frameEl, parentDoc));
    current = current.parent;
  }

  return path;
}
