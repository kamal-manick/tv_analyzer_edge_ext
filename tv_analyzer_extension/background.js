const STORAGE_PREFIX = "tvAnalyzer.tab.";
const MAX_SYMBOLS = 1000;
const LOCAL_WS_URL = "ws://127.0.0.1:8765";
const MAX_STREAM_QUEUE = 1000;
const STREAM_RECONNECT_MS = 2000;

const updateQueues = new Map();
let localSocket = null;
let localSocketTimer = null;
let localSocketConnected = false;
let localSocketConnecting = false;
let streamQueue = [];
let streamSequence = 0;

function storageKey(tabId) {
  return `${STORAGE_PREFIX}${tabId}`;
}

function queueUpdate(tabId, updateFn) {
  const previous = updateQueues.get(tabId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(updateFn)
    .catch(() => {});

  updateQueues.set(tabId, next);
  next.finally(() => {
    if (updateQueues.get(tabId) === next) {
      updateQueues.delete(tabId);
    }
  });

  return next;
}

function streamStatus() {
  return {
    url: LOCAL_WS_URL,
    connected: localSocketConnected,
    connecting: localSocketConnecting,
    queued: streamQueue.length
  };
}

function scheduleReconnect() {
  if (localSocketTimer) return;
  localSocketTimer = setTimeout(() => {
    localSocketTimer = null;
    connectLocalSocket();
  }, STREAM_RECONNECT_MS);
}

function sendQueued() {
  if (!localSocket || localSocket.readyState !== WebSocket.OPEN) return;

  while (streamQueue.length && localSocket.readyState === WebSocket.OPEN) {
    const item = streamQueue.shift();
    try {
      localSocket.send(JSON.stringify(item));
    } catch (_) {
      streamQueue.unshift(item);
      try { localSocket.close(); } catch (_) {}
      break;
    }
  }
}

function queueStreamEvent(event) {
  streamQueue.push(event);
  if (streamQueue.length > MAX_STREAM_QUEUE) {
    streamQueue.splice(0, streamQueue.length - MAX_STREAM_QUEUE);
  }
  sendQueued();
}

function connectLocalSocket() {
  if (localSocketConnecting || (localSocket && localSocket.readyState === WebSocket.OPEN)) {
    return;
  }

  localSocketConnecting = true;
  localSocketConnected = false;

  try {
    const socket = new WebSocket(LOCAL_WS_URL);
    localSocket = socket;

    socket.addEventListener("open", () => {
      localSocketConnecting = false;
      localSocketConnected = true;
      sendQueued();
    });

    socket.addEventListener("message", event => {
      // Optional server acknowledgement/control channel.
      // The extension currently only requires outbound streaming.
      if (typeof event.data === "string" && event.data === "pong") return;
    });

    socket.addEventListener("close", () => {
      if (localSocket === socket) {
        localSocket = null;
        localSocketConnected = false;
        localSocketConnecting = false;
        scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
      // close() will normally follow and trigger reconnect.
      try { socket.close(); } catch (_) {}
    });
  } catch (_) {
    localSocket = null;
    localSocketConnecting = false;
    localSocketConnected = false;
    scheduleReconnect();
  }
}

// Keep the local stream connection alive and make the status visible even
// when TradingView is temporarily quiet.
setInterval(() => {
  connectLocalSocket();
  if (localSocket && localSocket.readyState === WebSocket.OPEN) {
    try { localSocket.send(JSON.stringify({ type: "heartbeat", source: "tradingview-analyzer", ts: Date.now() })); } catch (_) {}
  }
}, 20000);

connectLocalSocket();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "TV_WS_QSD") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return;

    const record = message.record;
    if (!record || typeof record.symbol !== "string" || !record.symbol) return;

    // Every accepted qsd packet gets its own stream event. This is separate
    // from the storage snapshot, which merges partial updates by symbol.
    queueStreamEvent({
      type: "qsd",
      version: 1,
      sequence: ++streamSequence,
      tabId,
      sentAt: Date.now(),
      record
    });

    queueUpdate(tabId, async () => {
      const key = storageKey(tabId);
      const result = await chrome.storage.session.get(key);
      const state = result[key] || {
        updatedAt: 0,
        symbols: {}
      };

      const previous = state.symbols[record.symbol] || {};
      const values = record.values && typeof record.values === "object"
        ? record.values
        : {};

      state.symbols[record.symbol] = {
        ...previous,
        symbol: record.symbol,
        status: record.status ?? previous.status ?? null,
        session: record.session ?? previous.session ?? null,
        ...values,
        receivedAt: record.receivedAt || Date.now()
      };

      state.updatedAt = Date.now();

      const symbols = Object.keys(state.symbols);
      if (symbols.length > MAX_SYMBOLS) {
        symbols
          .sort((a, b) => (state.symbols[a].receivedAt || 0) - (state.symbols[b].receivedAt || 0))
          .slice(0, symbols.length - MAX_SYMBOLS)
          .forEach(symbol => delete state.symbols[symbol]);
      }

      await chrome.storage.session.set({ [key]: state });
    });

    return;
  }

  if (message.type === "GET_STATE") {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ updatedAt: 0, symbols: {}, stream: streamStatus() });
      return;
    }

    const pending = updateQueues.get(tabId) || Promise.resolve();
    pending
      .catch(() => {})
      .then(() => chrome.storage.session.get(storageKey(tabId)))
      .then(result => sendResponse({
        ...(result[storageKey(tabId)] || { updatedAt: 0, symbols: {} }),
        stream: streamStatus()
      }))
      .catch(() => sendResponse({ updatedAt: 0, symbols: {}, stream: streamStatus() }));

    return true;
  }

  if (message.type === "GET_STREAM_STATUS") {
    sendResponse(streamStatus());
    return;
  }

  if (message.type === "CLEAR_STATE") {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false });
      return;
    }

    queueUpdate(tabId, () => chrome.storage.session.remove(storageKey(tabId)))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  updateQueues.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
});
