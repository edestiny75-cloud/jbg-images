from __future__ import annotations

import threading
import time
import webbrowser

import uvicorn

from .server import app

HOST = "127.0.0.1"
PORT = 8765


def _open_browser() -> None:
    time.sleep(1.0)
    try:
        webbrowser.open(f"http://{HOST}:{PORT}/")
    except Exception:
        pass


def main() -> None:
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
