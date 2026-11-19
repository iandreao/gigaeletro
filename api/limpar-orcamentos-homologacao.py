"""POST /api/limpar-orcamentos-homologacao (homologação).

Zera painel + métricas de orçamentos no Blob/arquivo.
Requer sessão admin e corpo {"confirmacao":"LIMPAR ORCAMENTOS"}.
Remover este arquivo após o disparo único em produção.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        servidor.responder_limpar_orcamentos_homologacao(self)
