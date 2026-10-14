#!/usr/bin/env python3
"""Local dev server for public/, with HTTP caching disabled.

`python -m http.server` sends Last-Modified but no Cache-Control, so browsers
apply heuristic freshness and will happily keep serving a stale app.js while
reporting responseStatus 200 from the cache. That silently invalidates local
testing: you end up measuring the previous build and cannot tell.

This serves the same files with no-store, so a reload always executes what is
actually on disk.

    python dev/serve.py [port]        # default 8123

Not deployed -- only public/ is published.
"""

import functools
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):          # quieter output
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory="public")
    with Server(("127.0.0.1", PORT), handler) as httpd:
        print("serving public/ with caching disabled on http://localhost:%d" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
