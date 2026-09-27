# TradingView Analyzer Edge Extension

## Overview

TradingView Analyzer is a Microsoft Edge extension that captures TradingView quote data directly from the platform's WebSocket connection and makes it available for both in-browser viewing and real-time external analysis.

The extension intercepts TradingView `qsd` (Quote Symbol Data) messages, maintains a live symbol snapshot for display in the extension popup, and streams every accepted event to a local WebSocket server for downstream processing by Python, Rust, or other applications.


## Features

### Real-Time Data Capture

- Intercepts TradingView WebSocket traffic.
- Extracts and parses `qsd` (Quote Symbol Data) messages.
- Filters invalid or non-symbol records.
- Captures symbol updates in real time.

### Snapshot Storage

- Maintains the latest known state for each symbol.
- Merges partial TradingView updates into existing symbol records.
- Stores symbol data per browser tab.
- Displays the current snapshot through the extension popup.

### Local Event Streaming

- Streams every accepted `qsd` event to:

  ```text
  ws://127.0.0.1:8765
  ```

- Automatic reconnection when the local receiver is unavailable.
- Buffers up to 1,000 events while disconnected.
- Assigns a monotonically increasing sequence number to each event.
- Includes the original parsed TradingView message in every streamed record.
- Shows local stream connection status in the popup.


## Architecture

```text
TradingView WebSocket
        |
        v
 interceptor.js (MAIN world)
        |
        | Valid qsd messages
        v
     bridge.js
        |
        v
   background.js
     /       \
    /         \
   v           v
Snapshot   Local WebSocket Stream
Storage    ws://127.0.0.1:8765
   |              |
 Popup      Python / Rust / Other Tools
```

The extension maintains two independent data flows:

### Snapshot Data

Used by the popup to display the latest known values for each symbol.

### Event Stream

Used for real-time processing by external applications. Each accepted TradingView update is delivered independently, allowing consumers to reconstruct the exact update sequence.


## TradingView WebSocket Monitoring

The extension monitors TradingView's WebSocket endpoint:

```text
wss://data.tradingview.com/socket.io/websocket*
```

Matching is based on host and path only. Query parameters are ignored.

Message flow:

```text
TradingView Page
      |
      | WebSocket
      v
data.tradingview.com/socket.io/websocket
      |
      v
interceptor.js
      |
      | Parse ~m~<length>~m~ frames
      | Keep only messages where m == "qsd"
      v
bridge.js
      |
      v
background.js
      |
      +--> Snapshot Storage
      |
      +--> Localhost Streaming
```

## Installation

### Install the Extension

1. Open:

   ```text
   edge://extensions/
   ```

2. Enable **Developer mode**.

3. Select **Load unpacked**.

4. Choose the extension folder.

5. Open or reload:

   ```text
   https://www.tradingview.com/
   ```

6. Open a chart or watchlist.

7. Click the extension icon.

### Important

If TradingView was already open before the extension was installed or reloaded, reload the TradingView tab. The WebSocket interceptor must be injected before TradingView establishes its WebSocket connections.

## Data Model

A typical TradingView `qsd` message:

```json
{
  "m": "qsd",
  "p": [
    "quote_session_id",
    {
      "n": "NSE:NIFTY",
      "s": "ok",
      "v": {
        "lp": 23140.5,
        "ch": 77.4,
        "chp": 0.34
      }
    }
  ]
}
```

### Fields

| Field | Description |
|---------|-------------|
| m | Message type (`qsd`) |
| n | Symbol identifier (`EXCHANGE:SYMBOL`) |
| s | Symbol status |
| v | Quote values and attributes |

TradingView frequently sends partial updates. The extension merges incoming `v` objects into the existing symbol record to maintain a current snapshot.

## Local Stream Contract

Each streamed event has the following structure:

```json
{
  "type": "qsd",
  "version": 1,
  "sequence": 123,
  "tabId": 456,
  "sentAt": 1790000000000,
  "record": {
    "receivedAt": 1790000000000,
    "socketUrl": "wss://data.tradingview.com/socket.io/websocket?...",
    "session": "qs_multiplexer_full_...",
    "symbol": "NSE:NIFTY",
    "status": "ok",
    "values": {},
    "rawMessage": {}
  }
}
```

### Notes

- `sequence` increases for every streamed event.
- `rawMessage` contains the original parsed TradingView payload.
- Events are streamed exactly as received.
- Partial updates are not merged before streaming.
- Consumers can reconstruct the complete update sequence externally.

## Running the Local Receiver

From the `python_receiver` folder:

```bash
python -m pip install -r requirements.txt
python local_stream_server.py
```

The receiver:

- Listens on localhost (`127.0.0.1:8765`).
- Accepts streamed `qsd` events.
- Writes received events to:

```text
qsd_stream.jsonl
```

## Future Enhancements

Potential additions include:

- Raw message inspector
- Exchange and symbol filtering
- Option expiry filtering
- Bid/ask support
- Subscription and session tracking
- Option chain grouping
- OHLC capture
- Time-series storage
- Sparkline charts
- JSON/CSV export
- Direct chart rendering