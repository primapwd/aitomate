/**
 * Recording session state machine (FR-1): pauses on cross-origin navigation
 * or a new tab/window opening, and waits for the developer to confirm
 * continuation (or stop). Pure/deterministic so it's cheap to unit test;
 * `entrypoints/background.ts` is the only caller, driven by
 * `webNavigation.onCommitted` and `tabs.onCreated`.
 */

export type RecorderStatus = 'idle' | 'recording' | 'paused';
export type PauseReason = 'origin-change' | 'new-tab';

export interface RecorderSessionState {
  status: RecorderStatus;
  originUrl?: string;
  pauseReason?: PauseReason;
  /**
   * Bumped only on START. Lets background accept a step-captured message
   * that was in flight when STOP was processed (content's status flips to
   * idle asynchronously, on its own broadcast delivery) while still
   * rejecting a stale step from a since-replaced recording session.
   */
  generation: number;
}

export type SessionEvent =
  | { type: 'START'; originUrl: string }
  | { type: 'STOP' }
  | { type: 'NAVIGATE'; url: string }
  | { type: 'NEW_TAB_OPENED' }
  | { type: 'RESUME'; originUrl?: string };

export const initialSessionState: RecorderSessionState = { status: 'idle', generation: 0 };

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    // Unparseable URL (e.g. about:blank) — treat as a boundary, not a match.
    return false;
  }
}

export function reduceSession(
  state: RecorderSessionState,
  event: SessionEvent,
): RecorderSessionState {
  switch (event.type) {
    case 'START':
      return { status: 'recording', originUrl: event.originUrl, generation: state.generation + 1 };

    case 'STOP':
      return { ...state, status: 'idle' };

    case 'NAVIGATE': {
      if (state.status !== 'recording') return state;
      if (state.originUrl && sameOrigin(state.originUrl, event.url)) {
        // Rebase to the current URL so the caller can diff consecutive
        // navigations (e.g. A -> B -> A must still record the return trip).
        return state.originUrl === event.url ? state : { ...state, originUrl: event.url };
      }
      return { ...state, status: 'paused', pauseReason: 'origin-change' };
    }

    case 'NEW_TAB_OPENED': {
      if (state.status !== 'recording') return state;
      return { ...state, status: 'paused', pauseReason: 'new-tab' };
    }

    case 'RESUME': {
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: 'recording',
        originUrl: event.originUrl ?? state.originUrl,
        pauseReason: undefined,
      };
    }

    default:
      return state;
  }
}
