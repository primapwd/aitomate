import { browser } from 'wxt/browser';

/** Opens a background run tab at the current page, preserving the user's tab. */
export async function createBackgroundRunTab(): Promise<number> {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) throw new Error('No active tab found. Open a page first.');

  // Duplicating the URL keeps the run in the same authenticated browser
  // session and gives scenarios without an initial navigate step a page.
  const url = activeTab.url && /^https?:\/\//i.test(activeTab.url) ? activeTab.url : undefined;
  const runTab = await browser.tabs.create({ active: false, ...(url ? { url } : {}) });
  if (runTab.id === undefined) throw new Error('Could not open a background tab for the run.');
  return runTab.id;
}
