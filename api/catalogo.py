"""GET/POST /api/catalogo (+ status-sync, upload-manual, sincronizar, alerta-sync,
verificar-atualizacao-diaria, limpar-tabela) na Vercel.

Consolida tudo em uma única Serverless Function (Hobby: máx. 12).
POST JSON em /api/catalogo com acao=limpar_tabela|verificar_atualizacao_diaria
não depende de rewrite de URL.

GET e POST de verificar-atualizacao-diaria usam a MESMA função interna
(servidor.responder_verificar_atualizacao_diaria) — o mesmo pipeline Resend
do botão "Testar Alerta E-mail".
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


def _acao_normalizada(saida) -> str:
    return _acao(saida).replace("-", "_")


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
    return _acao_normalizada(saida) == "status_sync"


def _eh_alerta_sync(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("alerta-sync"):
        return True
    return _acao_normalizada(saida) == "alerta_sync"


def _eh_verificar_atualizacao_diaria(saida) -> bool:
    """Query acao, path legado, ou chamada nativa do Vercel Cron (header)."""
    caminho = _caminho(saida)
    if caminho.endswith("verificar-atualizacao-diaria"):
        return True
    if _acao_normalizada(saida) == "verificar_atualizacao_diaria":
        return True
    # Se o Cron omitir a query string, o header ainda identifica a invocação.
    return servidor.requisicao_vercel_cron(saida)


def _eh_limpar_tabela(saida) -> bool:
    caminho = _caminho(saida)
    if caminho.endswith("limpar-tabela"):
        return True
    return _acao_normalizada(saida) == "limpar_tabela"


def _executar_verificar_atualizacao_diaria(saida, forcar=None, simular=None):
    """Única entrada GET/POST — mesma lógica do botão Testar Alerta E-mail (Resend).

    Sem auth de sessão. Aceita forcar/simular via args (POST JSON) ou query
    (?forcar=1 / ?simularAtraso=1) quando args forem None.
    """
    servidor.responder_verificar_atualizacao_diaria(
        saida,
        forcar=forcar,
        simular=simular,
    )


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Cron: GET /api/catalogo?acao=verificar-atualizacao-diaria (?forcar=1 opcional)
        # Sem cookie/sessão. Mesma função do POST do botão de teste.
        if _eh_verificar_atualizacao_diaria(self):
            _executar_verificar_atualizacao_diaria(self)
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
        if _eh_verificar_atualizacao_diaria(self) and "application/json" not in (
            (self.headers.get("Content-Type") or "").lower()
        ):
            _executar_verificar_atualizacao_diaria(self)
            return
        if _eh_limpar_tabela(self) and "application/json" not in (
            (self.headers.get("Content-Type") or "").lower()
        ):
            servidor.responder_limpar_tabela(self, confirmado=True)
            return
        # Upload multipart OU JSON { "acao": "limpar_tabela"|"verificar_atualizacao_diaria" }.
        # JSON verificar_* também cai em _executar_verificar via responder_catalogo_post.
        servidor.responder_catalogo_post(self)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
