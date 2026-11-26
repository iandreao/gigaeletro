"""GET/POST /api/catalogo (+ status-sync, upload-manual, sincronizar, alerta-sync) na Vercel.

Consolida tudo em uma única Serverless Function (Hobby: máx. 12).
Rewrites em vercel.json apontam para este handler com ?acao= / ?sync=1.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


def _caminho(saida) -> str:
    return (saida.path or "").split("?", 1)[0].rstrip("/") or "/"


def _acao(saida) -> str:
    return (servidor.parametro_consulta(saida.path, "acao") or "").strip().lower()


def _eh_sincronizar(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("sincronizar-catalogo"):
        return True
    if servidor.parametro_consulta(saida.path, "sync") == "1":
        return True
    if _acao(saida) == "sincronizar":
        return True
    return False


def _eh_status_sync(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("status-sync"):
        return True
    return _acao(saida) == "status-sync"


def _eh_alerta_sync(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("alerta-sync"):
        return True
    return _acao(saida) == "alerta-sync"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if _eh_status_sync(self):
            servidor.responder_status_sync(self)
            return
        servidor.responder_catalogo(self)

    def do_POST(self):
        if _eh_alerta_sync(self):
            servidor.responder_alerta_sync(self)
            return
        if _eh_sincronizar(self):
            servidor.responder_sincronizar_catalogo(self)
            return
        # Upload manual Uniplus (área restrita) — padrão de POST /api/catalogo.
        servidor.responder_upload(self)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
