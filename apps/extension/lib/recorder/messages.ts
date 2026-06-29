import type { Step } from '@aitomate/schema';
import type { RecorderSessionState } from './session';

/** Popup/side-panel (Build view, T2.6) -> background. Targets a tab explicitly. */
export type RecorderCommand =
  | { type: 'aitomate:recorder:start'; tabId: number }
  | { type: 'aitomate:recorder:stop'; tabId: number }
  | { type: 'aitomate:recorder:resume'; tabId: number }
  | { type: 'aitomate:recorder:get-steps'; tabId: number };

/** Content script -> background. `sender.tab.id` identifies the tab. */
export type RecorderEvent =
  | { type: 'aitomate:recorder:step-captured'; step: Step }
  | { type: 'aitomate:recorder:get-state' };

/** Background -> content script(s) in a tab, broadcast on every state change. */
export type RecorderStateMessage = {
  type: 'aitomate:recorder:state';
  state: RecorderSessionState;
};

export interface RecorderStepsResponse {
  steps: Step[];
}
