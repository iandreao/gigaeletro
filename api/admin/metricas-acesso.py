"""GET /api/admin/metricas-acesso na Vercel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        servidor.responder_metricas_acesso(self)
