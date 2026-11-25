"""GET /api/catalogo e POST /api/catalogo | /api/sincronizar-catalogo na Vercel.

POST /api/sincronizar-catalogo é reescrito para este handler (Hobby: máx. 12 funções)
via vercel.json (?sync=1), reutilizando servidor.responder_sincronizar_catalogo.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


def _eh_sincronizar(saida) -> bool:
    caminho = (saida.path or "").split("?", 1)[0].rstrip("/")
    if caminho.endswith("sincronizar-catalogo"):
        return True
    if servidor.parametro_consulta(saida.path, "sync") == "1":
        return True
    if servidor.parametro_consulta(saida.path, "acao") == "sincronizar":
        return True
    return False


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        servidor.responder_catalogo(self)

    def do_POST(self):
        if _eh_sincronizar(self):
            servidor.responder_sincronizar_catalogo(self)
            return
        servidor.responder_upload(self)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
