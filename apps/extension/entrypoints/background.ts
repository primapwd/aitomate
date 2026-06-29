import type { Step } from '@aitomate/schema';
import type {
  RecorderCommand,
  RecorderEvent,
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

// Scenario runner state machine (T2.2) will live alongside this. For now,
// background only tracks recorder sessions (FR-1) — one per tab, persisted
// in storage.session (see lib/recorder/store.ts) so an MV3 service-worker
// teardown mid-recording doesn't lose the session, cleared when the tab
// closes.

function nextStepId(recording: TabRecording): string {
  return `step-${recording.steps.length + 1}`;
}

async function broadcastState(tabId: number, state: RecorderSessionState): Promise<void> {
  const message: RecorderStateMessage = { type: 'aitomate:recorder:state', state };
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // No content script listening in this tab (e.g. a chrome:// page) — fine.
  }
}

export default defineBackground(() => {
  console.log('[aitomate] background service worker started', {
    id: browser.runtime.id,
  });

  browser.runtime.onMessage.addListener(
    (
      message: RecorderCommand | RecorderEvent,
      sender,
    ): Promise<RecorderStepsResponse | RecorderSessionState | void> | void => {
      switch (message.type) {
        case 'aitomate:recorder:step-captured': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return;
          return getRecording(tabId).then(async (recording) => {
            if (recording.session.status !== 'recording') return;
            recording.steps.push({ ...message.step, id: nextStepId(recording) } as Step);
            await saveRecording(tabId, recording);
          });
        }

        case 'aitomate:recorder:get-state': {
          const tabId = sender.tab?.id;
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
            await broadcastState(message.tabId, recording.session);
          })();

        case 'aitomate:recorder:stop':
          return (async () => {
            const recording = await getRecording(message.tabId);
            recording.session = reduceSession(recording.session, { type: 'STOP' });
            await saveRecording(message.tabId, recording);
            await broadcastState(message.tabId, recording.session);
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
            await broadcastState(message.tabId, recording.session);
          })();

        case 'aitomate:recorder:get-steps':
          return getRecording(message.tabId).then((recording) => ({
            steps: recording.steps,
          }));

        default:
          return;
      }
    },
  );

  // Top-frame navigation while recording: same-origin becomes a `navigate`
  // step, cross-origin pauses the session (FR-1) for the developer to confirm.
  browser.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const recording = await getRecording(details.tabId);
    if (recording.session.status !== 'recording') return;

    // The reducer rebases originUrl on each same-origin navigation, so this
    // is the previous URL — a reload (same URL) records no navigate step.
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
      await broadcastState(details.tabId, recording.session);
    }
  });

  // New tab/window opened from a recording tab: pause and warn (FR-1) — the
  // Build UI (T2.6) surfaces this via the broadcast state's `pauseReason`.
  browser.tabs.onCreated.addListener(async (tab) => {
    const openerTabId = tab.openerTabId;
    if (openerTabId === undefined) return;
    const recording = await getRecording(openerTabId);
    if (recording.session.status !== 'recording') return;
    recording.session = reduceSession(recording.session, { type: 'NEW_TAB_OPENED' });
    await saveRecording(openerTabId, recording);
    await broadcastState(openerTabId, recording.session);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void clearRecording(tabId);
  });
});
