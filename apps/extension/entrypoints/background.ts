export default defineBackground(() => {
  // Scenario runner state machine lives here (T2.2).
  console.log('[aitomate] background service worker started', {
    id: browser.runtime.id,
  });
});
