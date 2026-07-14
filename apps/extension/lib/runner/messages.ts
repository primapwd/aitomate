import type { Scenario, Step } from '@aitomate/schema';
import type { RunnerSessionState } from './runner-session';
import type { SuiteReport, SuiteScenarioRef } from './suite';

/**
 * Runner message protocol (T2.2). Follows the same pattern as the recorder
 * messages in lib/recorder/messages.ts.
 *
 * Three message directions:
 *   1. Popup/sidepanel → background   (RunnerCommand)
 *   2. Background → content script    (RunnerContentCommand)
 *   3. Content script → background    (RunnerContentEvent)
 *   4. Background → popup/sidepanel   (RunnerStateMessage)
 */

/** Popup/side-panel (Run view) → background. Targets a tab explicitly. */
export type RunnerCommand =
  | { type: 'aitomate:runner:play'; tabId: number; scenario: Scenario }
  | { type: 'aitomate:runner:play-suite'; tabId: number; scenarioRefs: SuiteScenarioRef[] }
  | { type: 'aitomate:runner:pause'; tabId: number }
  | { type: 'aitomate:runner:resume'; tabId: number }
  | { type: 'aitomate:runner:stop'; tabId: number }
  | { type: 'aitomate:runner:stop-suite'; tabId: number };

/** Background → content script. Runs in the target tab. */
export type RunnerContentCommand =
  | { type: 'aitomate:runner:execute-step'; step: Step }
  | { type: 'aitomate:runner:wait-for-dom'; timeoutMs?: number };

/** Content script → background. `sender.tab.id` identifies the tab. */
export type RunnerContentEvent =
  | { type: 'aitomate:runner:step-executed'; stepId: string; passed: boolean; error?: string }
  | { type: 'aitomate:runner:dom-stable' };

/**
 * Background → UI (popup/sidepanel), broadcast on every state change.
 * Carries the tab id so an open panel can ignore other tabs' runs.
 */
export type RunnerStateMessage = {
  type: 'aitomate:runner:state';
  tabId: number;
  state: RunnerSessionState;
};

/** Background → UI, broadcast during suite execution. */
export type RunnerSuiteStateMessage = {
  type: 'aitomate:runner:suite-state';
  tabId: number;
  suiteReport: SuiteReport;
};

export interface StepResult {
  stepId: string;
  passed: boolean;
  error?: string;
  attempts: number;
  durationMs: number;
}
