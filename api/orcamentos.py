"""GET e POST /api/orcamentos na Vercel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        servidor.responder_orcamentos(self)

    def do_POST(self):
        servidor.responder_orcamentos(self)
