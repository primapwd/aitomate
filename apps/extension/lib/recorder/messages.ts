import type { Step } from '@aitomate/schema';
import type { RecorderSessionState } from './session';

/** Popup/side-panel (Build view, T2.6) -> background. Targets a tab explicitly. */
export type RecorderCommand =
  | { type: 'aitomate:recorder:start'; tabId: number }
  | { type: 'aitomate:recorder:stop'; tabId: number }
  | { type: 'aitomate:recorder:resume'; tabId: number }
  | { type: 'aitomate:recorder:get-state'; tabId: number }
  | { type: 'aitomate:recorder:get-steps'; tabId: number }
  | { type: 'aitomate:recorder:set-steps'; tabId: number; steps: Step[] }
  | { type: 'aitomate:recorder:update-step'; tabId: number; stepId: string; patch: Partial<Step> };

/** Content script -> background. `sender.tab.id` identifies the tab. */
export type RecorderEvent =
  | { type: 'aitomate:recorder:step-captured'; step: Step; generation: number }
  | { type: 'aitomate:recorder:get-state' };

/** Background -> content script(s) in a tab, broadcast on every state change. */
export type RecorderStateMessage = {
  type: 'aitomate:recorder:state';
  state: RecorderSessionState;
};

/**
 * Background -> popup/sidepanel, broadcast on every recorder state change and
 * every captured step. Carries the tab id so an open popup/side panel can
 * ignore broadcasts about other tabs.
 */
export type RecorderPopupMessage = {
  type: 'aitomate:recorder:state-change';
  tabId: number;
  state: RecorderSessionState;
};

export interface RecorderStepsResponse {
  steps: Step[];
}
