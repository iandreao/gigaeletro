"""GET/POST /api/catalogo (+ status-sync, upload-manual, sincronizar, alerta-sync,
verificar-atualizacao-diaria, limpar-tabela) na Vercel.

Consolida tudo em uma única Serverless Function (Hobby: máx. 12).
POST JSON em /api/catalogo com acao=limpar_tabela|verificar_atualizacao_diaria
não depende de rewrite de URL.
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


def _eh_verificar_atualizacao_diaria(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("verificar-atualizacao-diaria"):
        return True
    acao = _acao(saida).replace("-", "_")
    return acao == "verificar_atualizacao_diaria"


def _eh_limpar_tabela(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("limpar-tabela"):
        return True
    acao = _acao(saida).replace("-", "_")
    return acao == "limpar_tabela"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Cron Vercel: GET /api/catalogo?acao=verificar-atualizacao-diaria
        # Sem login de sessão — o Cron chama GET direto (x-vercel-cron / user-agent).
        if _eh_verificar_atualizacao_diaria(self):
            servidor.responder_verificar_atualizacao_diaria(self)
            return
        if _eh_limpar_tabela(self):
            servidor.responder_limpar_tabela(self)
            return
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
        # Query/path legado (rewrite) + JSON acao no body da mesma /api/catalogo.
        if _eh_verificar_atualizacao_diaria(self):
            servidor.responder_verificar_atualizacao_diaria(self)
            return
        if _eh_limpar_tabela(self):
            servidor.responder_limpar_tabela(self, confirmado=True)
            return
        # Upload multipart OU JSON { "acao": "limpar_tabela"|"verificar_atualizacao_diaria" }.
        servidor.responder_catalogo_post(self)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
