import type { Scenario, Step } from '@aitomate/schema';
import type {
  RecorderCommand,
  RecorderEvent,
  RecorderPopupMessage,
  RecorderStateMessage,
  RecorderStepsResponse,
} from '@/lib/recorder/messages';
import { reduceSession, type RecorderSessionState } from '@/lib/recorder/session';
import {
  clearRecording,
  getRecording,
  saveRecording,
  type TabRecording,
} from '@/lib/recorder/store';
import type { RunnerCommand, RunnerStateMessage, RunnerSuiteStateMessage, StepResult } from '@/lib/runner/messages';
import { findScenarioByName, listScenarios } from '@/lib/import-export';
import { runSuite, type SuiteReport, type SuiteScenarioRef } from '@/lib/runner/suite';
import { runSetup } from '@/lib/runner/chaining';
import {
  initialRunnerState,
  reduceRunnerState,
  type RunnerSessionState,
} from '@/lib/runner/runner-session';
import { executeStepWithRetry } from '@/lib/runner/step-executor';
import { clearRun, getRun, saveRun } from '@/lib/runner/store';
import { buildLlmGenerate } from '@/lib/runner/llm/resolve-provider';
import { unlockOrInitialize, vault } from '@/lib/vault';
import type { VaultCommand, VaultResponse } from '@/lib/vault/messages';
import { debugLog } from '@/lib/debug';

/**
 * Recorder (T1.x) and runner (T2.2) live side by side in the same service
 * worker. They share no internal state; each owns its own session machine and
 * store. The message listener dispatches by type prefix.
 */

// ─────────────────────────────────────────────
// Recorder helpers (unchanged from T1.x)
// ─────────────────────────────────────────────

function nextStepId(recording: TabRecording): string {
  return `step-${recording.steps.length + 1}`;
}

async function broadcastRecorderState(
  tabId: number,
  state: RecorderSessionState,
): Promise<void> {
  const contentMsg: RecorderStateMessage = { type: 'aitomate:recorder:state', state };
  try {
    await browser.tabs.sendMessage(tabId, contentMsg);
  } catch {
    // No content script listening in this tab (e.g. a chrome:// page) — fine.
  }
  await notifyPopup(tabId, state);
}

/** Notify an open popup/side panel (T2.6); it refreshes its step list too. */
async function notifyPopup(tabId: number, state: RecorderSessionState): Promise<void> {
  const popupMsg: RecorderPopupMessage = {
    type: 'aitomate:recorder:state-change',
    tabId,
    state,
  };
  try {
    await browser.runtime.sendMessage(popupMsg);
  } catch {
    // No popup listening — fine.
  }
}

// ─────────────────────────────────────────────
// Runner control signals (in-memory, per-tab)
// ─────────────────────────────────────────────

interface RunControl {
  stopped: boolean;
  pausePromise: Promise<void> | null;
  resume: (() => void) | null;
}

const runControl = new Map<number, RunControl>();

function getControl(tabId: number): RunControl {
  let ctrl = runControl.get(tabId);
  if (!ctrl) {
    ctrl = { stopped: false, pausePromise: null, resume: null };
    runControl.set(tabId, ctrl);
  }
  return ctrl;
}

function deleteControl(tabId: number): void {
  runControl.delete(tabId);
}

// Suite-level stop signal (T2.10) — separate from `runControl`, which is
// scoped to whichever single scenario is currently mid-flight. Stopping a
// suite needs both: abort the in-flight scenario (via `runControl`) *and*
// stop the suite loop from starting the next one (via this map).
interface SuiteControl {
  stopped: boolean;
}

const suiteControl = new Map<number, SuiteControl>();

async function broadcastRunnerState(
  tabId: number,
  state: RunnerSessionState,
): Promise<void> {
  const message: RunnerStateMessage = { type: 'aitomate:runner:state', tabId, state };
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // No content script in this tab — fine.
  }
  // The popup/side panel listens on the runtime channel, not the tab channel;
  // without this the Run view never learns a run finished.
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // No panel listening — fine.
  }
}

interface RunOutcome {
  passed: boolean;
  error?: string;
  results: StepResult[];
}

/**
 * Main runner orchestration loop. Runs asynchronously in the background,
 * driven by step-executor.ts for each individual step. Checks pause/stop
 * signals between steps.
 *
 * Returns the outcome so a suite run (T2.10) can reuse this loop for each
 * scenario instead of re-implementing it — the single-scenario `play`
 * handler below just fires it and ignores the return value.
 */
async function runSequence(tabId: number, scenario: Scenario): Promise<RunOutcome> {
  // Fresh control per run — a stale one (e.g. stopped=true left by a STOP on
  // an errored run) must not kill this run on its first iteration.
  const ctrl: RunControl = { stopped: false, pausePromise: null, resume: null };
  runControl.set(tabId, ctrl);
  const llmGenerate = buildLlmGenerate();

  debugLog('run-seq', `starting scenario="${scenario.meta.name}" tabId=${tabId} steps=${scenario.steps.length}`);

  // Initialise runner session
  const run = await getRun(tabId);
  run.session = reduceRunnerState(initialRunnerState, {
    type: 'PLAY',
    totalSteps: scenario.steps.length,
  });
  run.scenario = scenario;
  run.results = [];
  await saveRun(tabId, run);
  await broadcastRunnerState(tabId, run.session);

  // ── Setup scenario (FR-10, T2.8) ──
  if (scenario.setup) {
    const setupOutcome = await runSetup(
      tabId,
      scenario.setup,
      findScenarioByName,
      { stopped: () => ctrl.stopped },
      llmGenerate,
    );
    if (!setupOutcome.ok) {
      // Setup failed — report and stop the main run
      run.session = reduceRunnerState(run.session, {
        type: 'STEP_FAIL',
        error: setupOutcome.error,
      });
      await saveRun(tabId, run);
      await broadcastRunnerState(tabId, run.session);
      deleteControl(tabId);
      return { passed: false, error: setupOutcome.error, results: [] };
    }
  }

  for (let i = 0; i < scenario.steps.length; i++) {
    // Check stop signal
    if (ctrl.stopped) break;

    // Check pause signal — wait until resume or stop
    if (ctrl.pausePromise) {
      await ctrl.pausePromise;
      if (ctrl.stopped) break;
    }

    const step: Step = scenario.steps[i];

    // Point the UI at the step about to execute; STEP_COMPLETE advances the
    // machine only after the step actually passed.
    run.session = { ...run.session, currentStepIndex: i };
    await saveRun(tabId, run);
    await broadcastRunnerState(tabId, run.session);

    debugLog('run-seq', `step ${i} action=${step.action} id=${step.id}`);

    const result: StepResult = await executeStepWithRetry(
      tabId,
      step,
      { stopped: () => ctrl.stopped },
      llmGenerate,
    );

    run.results.push(result);

    if (!result.passed) {
      debugLog('run-seq', `step ${i} FAILED: ${result.error}`);
      run.session = reduceRunnerState(run.session, {
        type: 'STEP_FAIL',
        error: result.error ?? 'Step failed',
      });
      await saveRun(tabId, run);
      await broadcastRunnerState(tabId, run.session);
      break;
    }

    // Step passed — advance state machine
    run.session = reduceRunnerState(run.session, { type: 'STEP_COMPLETE' });
    await saveRun(tabId, run);
    await broadcastRunnerState(tabId, run.session);
  }

  debugLog('run-seq', `done status=${run.session.status} steps_completed=${run.results.length}`);

  // If loop completed without error and not stopped, the last STEP_COMPLETE
  // already set status to 'done'. If stopped, ensure idle state.
  if (ctrl.stopped) {
    run.session = { ...initialRunnerState };
    await saveRun(tabId, run);
    await broadcastRunnerState(tabId, run.session);
  }

  deleteControl(tabId);

  return {
    passed: run.session.status === 'done',
    error: run.session.status === 'error' ? run.session.error : undefined,
    results: run.results,
  };
}

// ─────────────────────────────────────────────
// Background service worker entry
// ─────────────────────────────────────────────

export default defineBackground(() => {
  console.log('[aitomate] background service worker started', {
    id: browser.runtime.id,
  });

  browser.runtime.onMessage.addListener(
    (
      message:
        | RecorderCommand
        | RecorderEvent
        | RunnerCommand
        | VaultCommand,
      sender,
    ):
      | Promise<RecorderStepsResponse | RecorderSessionState | RunnerSessionState | RunnerSuiteStateMessage | RecorderPopupMessage | VaultResponse | void>
      | void => {
      // ── Recorder handlers (T1.x) ──
      switch (message.type) {
        case 'aitomate:recorder:step-captured': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return;
          return getRecording(tabId).then(async (recording) => {
            if (recording.session.status !== 'recording') return;
            recording.steps.push({ ...message.step, id: nextStepId(recording) } as Step);
            await saveRecording(tabId, recording);
            // Let an open side panel show the new step live.
            await notifyPopup(tabId, recording.session);
          });
        }

        case 'aitomate:recorder:get-state': {
          // Different callers: content script (sender.tab.id) or popup (message.tabId)
          const tabId = sender.tab?.id ?? (message as RecorderCommand).tabId;
          if (tabId === undefined) return;
          return getRecording(tabId).then((recording) => recording.session);
        }

        case 'aitomate:recorder:start':
          return (async () => {
            const tab = await browser.tabs.get(message.tabId);
            const recording = await getRecording(message.tabId);
            recording.steps = [];
            recording.session = reduceSession(recording.session, {
              type: 'START',
              originUrl: tab.url ?? '',
            });
            await saveRecording(message.tabId, recording);
            await broadcastRecorderState(message.tabId, recording.session);
          })();

        case 'aitomate:recorder:stop':
          return (async () => {
            const recording = await getRecording(message.tabId);
            recording.session = reduceSession(recording.session, { type: 'STOP' });
            await saveRecording(message.tabId, recording);
            await broadcastRecorderState(message.tabId, recording.session);
          })();

        case 'aitomate:recorder:resume':
          return (async () => {
            const tab = await browser.tabs.get(message.tabId);
            const recording = await getRecording(message.tabId);
            recording.session = reduceSession(recording.session, {
              type: 'RESUME',
              originUrl: tab.url,
            });
            await saveRecording(message.tabId, recording);
            await broadcastRecorderState(message.tabId, recording.session);
          })();

        case 'aitomate:recorder:get-steps':
          return getRecording(message.tabId).then((recording) => ({
            steps: recording.steps,
          }));

        case 'aitomate:recorder:set-steps':
          return (async () => {
            const recording = await getRecording(message.tabId);
            recording.steps = message.steps;
            await saveRecording(message.tabId, recording);
          })();

        case 'aitomate:recorder:update-step':
          return (async () => {
            const recording = await getRecording(message.tabId);
            const idx = recording.steps.findIndex((s) => s.id === message.stepId);
            if (idx === -1) return;
            recording.steps[idx] = { ...recording.steps[idx], ...message.patch } as Step;
            await saveRecording(message.tabId, recording);
          })();

        // ── Runner handlers (T2.2) ──

        case 'aitomate:runner:play':
          return (async () => {
            const run = await getRun(message.tabId);
            // "playing" only blocks a new run while its loop is actually
            // alive (control present). A persisted "playing" with no control
            // means an MV3 worker teardown killed the loop — allow a restart.
            if (run.session.status === 'playing' && runControl.has(message.tabId)) {
              return;
            }
            // Fire-and-forget: the runner loop runs asynchronously.
            void runSequence(message.tabId, message.scenario);
          })();

        case 'aitomate:runner:pause':
          return (async () => {
            const run = await getRun(message.tabId);
            if (run.session.status !== 'playing') return;
            const ctrl = getControl(message.tabId);
            ctrl.pausePromise = new Promise((resolve) => {
              ctrl.resume = resolve;
            });
            run.session = reduceRunnerState(run.session, { type: 'PAUSE' });
            await saveRun(message.tabId, run);
            await broadcastRunnerState(message.tabId, run.session);
          })();

        case 'aitomate:runner:resume':
          return (async () => {
            const run = await getRun(message.tabId);
            if (run.session.status !== 'paused') return;
            const ctrl = getControl(message.tabId);
            ctrl.resume?.();
            ctrl.pausePromise = null;
            ctrl.resume = null;
            run.session = reduceRunnerState(run.session, { type: 'RESUME' });
            await saveRun(message.tabId, run);
            await broadcastRunnerState(message.tabId, run.session);
          })();

        case 'aitomate:runner:stop':
          return (async () => {
            const run = await getRun(message.tabId);
            if (
              run.session.status !== 'playing' &&
              run.session.status !== 'paused' &&
              run.session.status !== 'error'
            ) {
              return;
            }
            const ctrl = getControl(message.tabId);
            ctrl.stopped = true;
            ctrl.resume?.(); // unblock if paused
            run.session = reduceRunnerState(run.session, { type: 'STOP' });
            await saveRun(message.tabId, run);
            await broadcastRunnerState(message.tabId, run.session);
          })();

        // ── Suite runner (T2.10) ──

        case 'aitomate:runner:play-suite':
          return (async () => {
            const tabId = message.tabId;
            const stored = await listScenarios();
            const refs = message.scenarioRefs;

            // Resolve refs to scenarios; skip any that are missing.
            const resolved: { ref: SuiteScenarioRef; scenario: Scenario }[] = [];
            for (const ref of refs) {
              const found = stored.find((s) => s.id === ref.id);
              if (found) {
                resolved.push({ ref, scenario: found.scenario });
              } else {
                debugLog('suite', `scenario not found: ${ref.name}`);
              }
            }

            if (resolved.length === 0) {
              const report: SuiteReport = {
                passed: false,
                scenarios: refs.map((r) => ({
                  name: r.name,
                  status: 'skipped',
                  results: [],
                })),
              };
              const suiteMsg: RunnerSuiteStateMessage = {
                type: 'aitomate:runner:suite-state',
                tabId,
                suiteReport: report,
              };
              try { await browser.runtime.sendMessage(suiteMsg); } catch { /* no listener */ }
              return;
            }

            const sctrl: SuiteControl = { stopped: false };
            suiteControl.set(tabId, sctrl);

            // Fire-and-forget: the suite loop runs asynchronously. Reuses
            // runSequence per scenario instead of re-implementing the step
            // loop — one orchestration path, not two that can drift.
            void runSuite(
              resolved.map((r) => r.ref),
              async (ref) => {
                const entry = resolved.find((r) => r.ref.id === ref.id);
                if (!entry) {
                  return { passed: false, error: `Scenario "${ref.name}" not found`, results: [] };
                }
                return runSequence(tabId, entry.scenario);
              },
              { stopped: () => sctrl.stopped },
              {},
            ).then(async (report) => {
              suiteControl.delete(tabId);
              const suiteMsg: RunnerSuiteStateMessage = {
                type: 'aitomate:runner:suite-state',
                tabId,
                suiteReport: report,
              };
              try { await browser.runtime.sendMessage(suiteMsg); } catch { /* no listener */ }
            });
          })();

        case 'aitomate:runner:stop-suite':
          return (async () => {
            const sctrl = suiteControl.get(message.tabId);
            if (sctrl) sctrl.stopped = true;
            // Also abort whichever scenario is currently mid-flight — without
            // this, "stop" would only take effect after the in-flight
            // scenario finishes on its own.
            const ctrl = runControl.get(message.tabId);
            if (ctrl) {
              ctrl.stopped = true;
              ctrl.resume?.();
            }
          })();

        // ── Vault commands (T3.3) ──

        case 'aitomate:vault:status':
          debugLog('vault', 'status check');
          return vault.getStatus().then((status) => {
            debugLog('vault', `status=${status}`);
            return { ok: true, status } as VaultResponse;
          });

        case 'aitomate:vault:initialize':
          debugLog('vault', 'initialize');
          return (async () => {
            try {
              await unlockOrInitialize(vault, message.passphrase);
              debugLog('vault', 'initialized + unlocked');
              return { ok: true, status: 'unlocked' } as VaultResponse;
            } catch (err) {
              debugLog('vault', `initialize failed: ${(err as Error).message}`);
              return { ok: false, error: (err as Error).message } as VaultResponse;
            }
          })();

        case 'aitomate:vault:unlock':
          debugLog('vault', 'unlock');
          return (async () => {
            try {
              await vault.unlock(message.passphrase);
              debugLog('vault', 'unlocked');
              return { ok: true, status: 'unlocked' } as VaultResponse;
            } catch (err) {
              debugLog('vault', `unlock failed: ${(err as Error).message}`);
              return { ok: false, error: (err as Error).message } as VaultResponse;
            }
          })();

        case 'aitomate:vault:lock':
          vault.lock();
          debugLog('vault', 'locked');
          return Promise.resolve({ ok: true, status: 'locked' } as VaultResponse);

        case 'aitomate:vault:reset':
          debugLog('vault', 'reset');
          return (async () => {
            try {
              await vault.reset();
              debugLog('vault', 'reset done');
              return { ok: true, status: 'uninitialized' } as VaultResponse;
            } catch (err) {
              debugLog('vault', `reset failed: ${(err as Error).message}`);
              return { ok: false, error: (err as Error).message } as VaultResponse;
            }
          })();

        default:
          return;
      }
    },
  );

  // ── Top-frame navigation while recording (unchanged from T1.x) ──

  browser.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const recording = await getRecording(details.tabId);
    if (recording.session.status !== 'recording') return;

    const previousUrl = recording.session.originUrl;
    recording.session = reduceSession(recording.session, {
      type: 'NAVIGATE',
      url: details.url,
    });

    if (recording.session.status === 'recording' && previousUrl !== details.url) {
      recording.steps.push({
        id: nextStepId(recording),
        action: 'navigate',
        url: details.url,
      });
    }
    await saveRecording(details.tabId, recording);
    if (recording.session.status === 'paused') {
      await broadcastRecorderState(details.tabId, recording.session);
    }
  });

  // ── New tab/window opened from a recording tab (unchanged from T1.x) ──

  browser.tabs.onCreated.addListener(async (tab) => {
    const openerTabId = tab.openerTabId;
    if (openerTabId === undefined) return;
    const recording = await getRecording(openerTabId);
    if (recording.session.status !== 'recording') return;
    recording.session = reduceSession(recording.session, { type: 'NEW_TAB_OPENED' });
    await saveRecording(openerTabId, recording);
    await broadcastRecorderState(openerTabId, recording.session);
  });

  // ── Tab close cleanup (both recorder and runner) ──

  browser.tabs.onRemoved.addListener((tabId) => {
    void clearRecording(tabId);
    void clearRun(tabId);
  });
});
