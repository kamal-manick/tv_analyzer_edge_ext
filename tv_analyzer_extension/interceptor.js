(() => {
  // Runs in TradingView's MAIN world so it can patch the page's WebSocket constructor.
  // It captures only incoming messages from data.tradingview.com/socket.io/websocket.
  const TARGET = /^wss:\/\/data\.tradingview\.com\/socket\.io\/websocket(?:\?|$)/i;
  const originalWebSocket = window.WebSocket;

  if (!originalWebSocket || originalWebSocket.__tvAnalyzerPatched) return;

  function emit(record) {
    try {
      window.postMessage({
        source: "tv-analyzer",
        type: "TV_WS_QSD",
        record
      }, "*");
    } catch (_) {}
  }

  function parseFrames(text) {
    const frames = [];
    let offset = 0;

    while (offset < text.length) {
      // TradingView heartbeat/control messages can also use the same framing.
      if (text.startsWith("~m~", offset)) {
        const sep = text.indexOf("~m~", offset + 3);
        if (sep < 0) break; // incomplete application frame

        const lengthText = text.slice(offset + 3, sep);
        const length = Number(lengthText);
        if (!Number.isInteger(length) || length < 0) break;

        const payloadStart = sep + 3;
        const payloadEnd = payloadStart + length;

        if (payloadEnd > text.length) break;

        frames.push(text.slice(payloadStart, payloadEnd));
        offset = payloadEnd;
        continue;
      }

      // Some server messages can arrive without the TradingView envelope.
      // Treat the remaining text as one candidate JSON payload.
      frames.push(text.slice(offset));
      break;
    }

    return frames;
  }

  function handleText(text, url) {
    for (const payload of parseFrames(text)) {
      if (!payload || payload === "~protocol_error~") continue;

      let msg;
      try {
        msg = JSON.parse(payload);
      } catch (_) {
        continue;
      }

      // TradingView's source calls this raw method "qsd"; its unpack()
      // converts it to "quote_symbol_data".
      if (msg && msg.m === "qsd" && Array.isArray(msg.p) && msg.p.length >= 2) {
        const quote = msg.p[1];

        // qsd is also used by TradingView for quote-related records that do
        // not represent a normal symbol quote. A real watchlist symbol is
        // represented by a string like "NSE:NIFTY" or "MCX:...".
        // Reject serialized metadata / non-symbol values such as:
        // ={"adjustment":"splits",...}
        if (!quote || typeof quote !== "object") continue;
        if (typeof quote.n !== "string") continue;
        if (!/^[A-Za-z0-9_-]+:[^\s]+$/.test(quote.n)) continue;

        emit({
          receivedAt: Date.now(),
          socketUrl: url,
          session: msg.p[0] ?? null,
          symbol: quote.n,
          status: quote.s ?? null,
          values: quote.v && typeof quote.v === "object" ? quote.v : {},
          rawMessage: msg
        });
      }
    }
  }

  function handleData(data, url) {
    if (typeof data === "string") {
      handleText(data, url);
      return;
    }

    if (data instanceof ArrayBuffer) {
      try {
        handleText(new TextDecoder().decode(new Uint8Array(data)), url);
      } catch (_) {}
      return;
    }

    if (data instanceof Blob) {
      data.text().then(text => handleText(text, url)).catch(() => {});
    }
  }

  function TVAnalyzerWebSocket(url, protocols) {
    const ws = protocols === undefined
      ? new originalWebSocket(url)
      : new originalWebSocket(url, protocols);

    try {
      if (typeof url === "string" && TARGET.test(url)) {
        ws.addEventListener("message", event => handleData(event.data, url));
      }
    } catch (_) {}

    return ws;
  }

  // Preserve static constants and prototype behavior.
  TVAnalyzerWebSocket.prototype = originalWebSocket.prototype;
  Object.setPrototypeOf(TVAnalyzerWebSocket, originalWebSocket);

  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    try {
      Object.defineProperty(TVAnalyzerWebSocket, key, {
        value: originalWebSocket[key],
        enumerable: true
      });
    } catch (_) {}
  }

  TVAnalyzerWebSocket.__tvAnalyzerPatched = true;
  window.WebSocket = TVAnalyzerWebSocket;
})();
