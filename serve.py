import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='Run Nutrition Atlas locally.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = functools.partial(NoCacheHandler, directory=str(root))
    url = f'http://127.0.0.1:{args.port}/'
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        if error.errno in (48, 98, 10048) or getattr(error, 'winerror', None) == 10048:
            print(f'Nutrition Atlas is already running: {url}')
            if not args.no_open:
                webbrowser.open(url)
            return
        raise
    print(f'Nutrition Atlas: {url}')
    print('Press Ctrl+C to stop.')
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()