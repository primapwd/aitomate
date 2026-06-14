export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    // Recorder + playback DOM interaction lives here (T2.1, T2.4).
  },
});
