let tabId = null;
let refreshTimer = null;

const rows = document.getElementById("rows");
const count = document.getElementById("count");
const updated = document.getElementById("updated");
const status = document.getElementById("status");
const clearButton = document.getElementById("clear");
const stream = document.getElementById("stream");

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits
    });
  }
  return String(value);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render(state) {
  const symbols = Object.values(state.symbols || {})
    .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));

  count.textContent = `${symbols.length} symbol${symbols.length === 1 ? "" : "s"}`;

  if (state.updatedAt) {
    updated.textContent = `Last packet: ${new Date(state.updatedAt).toLocaleTimeString()}`;
  } else {
    updated.textContent = "Waiting for qsd…";
  }

  if (state.stream?.connected) {
    stream.textContent = `Local stream: connected · ${state.stream.url}`;
  } else if (state.stream?.connecting) {
    stream.textContent = `Local stream: connecting · ${state.stream.url}`;
  } else {
    stream.textContent = `Local stream: offline · ${state.stream?.url || "ws://127.0.0.1:8765"}`;
  }

  if (!symbols.length) {
    rows.innerHTML = `<tr><td class="empty" colspan="7">
      No qsd quote data captured yet.<br>
      Open/reload a TradingView chart or watchlist.
    </td></tr>`;
    return;
  }

  rows.innerHTML = symbols.map(s => `
    <tr>
      <td class="symbol">${esc(s.symbol)}</td>
      <td>${esc(fmt(s.last_price ?? s.lp))}</td>
      <td>${esc(fmt(s.change ?? s.ch))}</td>
      <td>${esc(fmt(s.change_percent ?? s.chp))}</td>
      <td>${esc(fmt(s.volume, 0))}</td>
      <td>${esc(s.session || "—")}</td>
      <td>${s.receivedAt ? esc(new Date(s.receivedAt).toLocaleTimeString()) : "—"}</td>
    </tr>
  `).join("");
}

async function getState() {
  if (tabId === null) return;

  const state = await chrome.runtime.sendMessage({
    type: "GET_STATE",
    tabId
  });

  render(state || { symbols: {} });
}

async function init() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];
  if (!tab || !tab.id) {
    status.textContent = "No active tab";
    return;
  }

  tabId = tab.id;

  if (!/^https:\/\/www\.tradingview\.com\//i.test(tab.url || "")) {
    status.textContent = "Open TradingView in the active tab";
  } else {
    status.textContent = "Capturing qsd messages";
  }

  await getState();

  // Polling is deliberate here: the popup is short-lived and this keeps
  // the implementation simple. A later version can use a long-lived port.
  refreshTimer = setInterval(getState, 500);
}

clearButton.addEventListener("click", async () => {
  if (tabId === null) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_STATE", tabId });
  await getState();
});

window.addEventListener("unload", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

init().catch(error => {
  status.textContent = `Error: ${error.message}`;
});
