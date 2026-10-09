"""POST /api/logout na Vercel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        servidor.responder_logout(self)
