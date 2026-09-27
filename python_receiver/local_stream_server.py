"""Receive TradingView Analyzer qsd events over localhost WebSocket."""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import websockets

HOST = "127.0.0.1"
PORT = 8765
LOG_FILE = Path("qsd_stream.jsonl")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


async def handler(websocket):
    peer = websocket.remote_address
    print(f"[connected] {peer}")
    count = 0

    try:
        async for message in websocket:
            if not isinstance(message, str):
                continue

            try:
                event = json.loads(message)
            except json.JSONDecodeError:
                print("[invalid-json]")
                continue

            if event.get("type") == "heartbeat":
                await websocket.send("pong")
                continue

            if event.get("type") != "qsd":
                continue

            count += 1
            record = event.get("record") or {}
            symbol = record.get("symbol", "?")
            values = record.get("values") or {}
            last_price = values.get("lp", values.get("last_price", "—"))
            change = values.get("ch", values.get("change", "—"))
            change_pct = values.get("chp", values.get("change_percent", "—"))

            print(
                f"[{count:>7}] {symbol:<38} "
                f"LTP={last_price!s:<12} Chg={change!s:<12} Chg%={change_pct}"
            )

            # Append the complete event so another process can replay/analyze it.
            with LOG_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")

    except websockets.ConnectionClosed:
        pass
    finally:
        print(f"[disconnected] {peer}; received {count} qsd events")


async def main():
    print(f"TradingView Analyzer local stream: ws://{HOST}:{PORT}")
    print(f"JSONL log: {LOG_FILE.resolve()}")

    async with websockets.serve(
        handler,
        HOST,
        PORT,
        ping_interval=20,
        ping_timeout=20,
        max_size=4 * 1024 * 1024,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
