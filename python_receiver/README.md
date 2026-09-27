# Local QSD Stream Receiver

This is the PoC receiver for TradingView Analyzer v0.2.0.

## Setup

```powershell
cd python_receiver
python -m pip install -r requirements.txt
python local_stream_server.py
```

The server listens only on:

```text
ws://127.0.0.1:8765
```

The Edge extension automatically reconnects to this address and streams every accepted `qsd` packet.

## Event format

Each quote event is a JSON object like:

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
    "values": {
      "lp": 23140.5,
      "ch": 77.4,
      "chp": 0.34
    },
    "rawMessage": {
      "m": "qsd",
      "p": ["...", {"n": "NSE:NIFTY", "s": "ok", "v": {"lp": 23140.5}}]
    }
  }
}
```

`rawMessage` is included so the Python/Rust analyzer can retain fields that the popup does not currently display.

The receiver also appends every qsd event to `qsd_stream.jsonl` for later replay/analysis.
