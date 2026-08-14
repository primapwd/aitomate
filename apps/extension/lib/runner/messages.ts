import type { Scenario, Selector, Step } from '@aitomate/schema';
import type { CaptureEntry } from './capture';
import type { RunnerSessionState } from './runner-session';
import type { RunReport } from './report';
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
  | { type: 'aitomate:runner:play'; tabId: number; scenario: Scenario; baseUrl?: string }
  | { type: 'aitomate:runner:play-suite'; tabId: number; scenarioRefs: SuiteScenarioRef[]; baseUrl?: string }
  | { type: 'aitomate:runner:pause'; tabId: number }
  | { type: 'aitomate:runner:resume'; tabId: number }
  | { type: 'aitomate:runner:stop'; tabId: number }
  | { type: 'aitomate:runner:stop-suite'; tabId: number };

/** Background → content script. Runs in the target tab. */
export type RunnerContentCommand =
  | { type: 'aitomate:runner:execute-step'; step: Step }
  | { type: 'aitomate:runner:wait-for-dom'; timeoutMs?: number }
  | { type: 'aitomate:runner:locate-element'; selector: Selector }
  | { type: 'aitomate:runner:pick-element' }
  | { type: 'aitomate:runner:cancel-pick' };

/** Content script → background. `sender.tab.id` identifies the tab. */
export type RunnerContentEvent =
  | { type: 'aitomate:runner:step-executed'; stepId: string; passed: boolean; error?: string }
  | { type: 'aitomate:runner:dom-stable' }
  | { type: 'aitomate:runner:element-located'; found: boolean; error?: string }
  | { type: 'aitomate:runner:element-picked'; selector: Selector }
  | { type: 'aitomate:runner:pick-cancelled' }
  /**
   * Page error captured during a run (FR-5), forwarded by the content
   * script's relay. Content scripts cannot write to `storage.session`
   * ("Access to storage is not allowed from this context"), so the
   * background — a trusted context — persists it keyed by
   * `sender.tab.id`.
   */
  | { type: 'aitomate:runner:capture-entry'; entry: CaptureEntry };

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

/** Background → UI, broadcast after a single scenario run completes. */
export type RunnerRunReportMessage = {
  type: 'aitomate:runner:run-report';
  tabId: number;
  report: RunReport;
};

/** Background → UI, broadcast after each individual step executes. */
export type RunnerStepResultMessage = {
  type: 'aitomate:runner:step-result';
  tabId: number;
  result: StepResult;
};

export interface StepResult {
  stepId: string;
  passed: boolean;
  error?: string;
  attempts: number;
  durationMs: number;
}
