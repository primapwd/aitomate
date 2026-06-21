import { browser } from 'wxt/browser';

/**
 * Side-panel adapter (spec FR-8): Chrome/Edge expose `sidePanel`, Firefox
 * exposes `sidebarAction`, and neither is in the polyfill types yet.
 *
 * Note: `action.default_popup` takes precedence over
 * `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in Chrome,
 * so the panel is opened explicitly from a popup button instead — both APIs
 * accept the call from a user-gesture context like a popup click.
 */

interface ChromeSidePanelApi {
  open(options: { windowId: number }): Promise<void>;
}

interface FirefoxSidebarApi {
  open(): Promise<void>;
}

function getChromeSidePanel(): ChromeSidePanelApi | undefined {
  return (browser as { sidePanel?: ChromeSidePanelApi }).sidePanel;
}

function getFirefoxSidebar(): FirefoxSidebarApi | undefined {
  return (browser as { sidebarAction?: FirefoxSidebarApi }).sidebarAction;
}

export function isSidePanelSupported(): boolean {
  return Boolean(getChromeSidePanel()?.open ?? getFirefoxSidebar()?.open);
}

/** Must be called from a user gesture (e.g., a button click in the popup). */
export async function openSidePanel(): Promise<void> {
  const chromePanel = getChromeSidePanel();
  if (chromePanel?.open) {
    const { id: windowId } = await browser.windows.getCurrent();
    if (windowId === undefined) {
      throw new Error('Could not determine the current browser window.');
    }
    await chromePanel.open({ windowId });
    return;
  }
  const firefoxSidebar = getFirefoxSidebar();
  if (firefoxSidebar?.open) {
    await firefoxSidebar.open();
    return;
  }
  throw new Error('This browser does not support a side panel.');
}
