#!/usr/bin/env python3
"""Static server for Turbo Kart. No MaleCNS / connectome stack."""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = os.getenv("DRAWFLY_HOST", "127.0.0.1")
PORT = int(os.getenv("DRAWFLY_PORT", "8765"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/kart/")
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, fmt: str, *args):
        print(f"[kart] {self.address_string()} - {fmt % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Turbo Kart → http://{HOST}:{PORT}/kart/")
    server.serve_forever()


if __name__ == "__main__":
    main()
