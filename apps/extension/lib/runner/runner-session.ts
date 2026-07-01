/**
 * Runner state machine (T2.2): orchestrates scenario playback lifecycle.
 * Pure/deterministic reducer — easy to unit test. Tracks only session
 * metadata (status, current step index); actual step results live in the
 * runner store (store.ts).
 *
 * States:
 * - idle:     no run active
 * - playing:  actively executing steps
 * - paused:   user-initiated pause between steps
 * - error:    unrecoverable step failure (retries exhausted)
 * - done:     all steps completed successfully
 */

export type RunnerStatus = 'idle' | 'playing' | 'paused' | 'error' | 'done';

export interface RunnerSessionState {
  status: RunnerStatus;
  currentStepIndex: number;
  totalSteps: number;
  error?: string;
}

export type RunnerEvent =
  | { type: 'PLAY'; totalSteps: number }
  | { type: 'STEP_COMPLETE' }
  | { type: 'STEP_FAIL'; error: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'RESET' };

export const initialRunnerState: RunnerSessionState = {
  status: 'idle',
  currentStepIndex: 0,
  totalSteps: 0,
};

export function reduceRunnerState(
  state: RunnerSessionState,
  event: RunnerEvent,
): RunnerSessionState {
  switch (event.type) {
    case 'PLAY':
      return {
        // An empty scenario has nothing to run — never emit STEP_COMPLETE,
        // so it must land on 'done' immediately or it would stay 'playing'.
        status: event.totalSteps === 0 ? 'done' : 'playing',
        currentStepIndex: 0,
        totalSteps: event.totalSteps,
      };

    case 'STEP_COMPLETE': {
      if (state.status !== 'playing') return state;
      const nextIndex = state.currentStepIndex + 1;
      if (nextIndex >= state.totalSteps) {
        return { ...state, status: 'done', currentStepIndex: nextIndex };
      }
      return { ...state, currentStepIndex: nextIndex };
    }

    case 'STEP_FAIL': {
      if (state.status !== 'playing') return state;
      return { ...state, status: 'error', error: event.error };
    }

    case 'PAUSE': {
      if (state.status !== 'playing') return state;
      return { ...state, status: 'paused' };
    }

    case 'RESUME': {
      if (state.status !== 'paused') return state;
      return { ...state, status: 'playing' };
    }

    case 'STOP':
      if (state.status !== 'playing' && state.status !== 'paused' && state.status !== 'error') {
        return state;
      }
      return { ...initialRunnerState };

    case 'RESET':
      if (state.status !== 'error' && state.status !== 'done') return state;
      return { ...initialRunnerState };

    default:
      return state;
  }
}
