(() => {
  // ISOLATED world: receives records from interceptor.js and forwards them
  // to the extension service worker.
  const SOURCE = "tv-analyzer";

  window.addEventListener("message", event => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "TV_WS_QSD") return;

    chrome.runtime.sendMessage({
      type: "TV_WS_QSD",
      record: data.record
    }).catch(() => {});
  });
})();
