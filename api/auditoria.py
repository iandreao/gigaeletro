"""GET /api/auditoria e rotas /api/equipe/* (via rewrite) na Vercel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        caminho = (self.path or "").split("?", 1)[0]
        if "/equipe" in caminho or "equipe=" in (self.path or ""):
            servidor.responder_equipe_get(self)
            return
        servidor.responder_auditoria(self)

    def do_POST(self):
        servidor.responder_equipe_post(self)
