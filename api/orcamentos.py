"""GET, POST e DELETE /api/orcamentos na Vercel.

Toda a lógica vive em servidor.responder_orcamentos (mesmo código do servidor local):

- POST { acao: "rascunho", documento, itens, tipoOrcamento, id? }
  upsert com status "A Enviar"; itens=[] remove o rascunho.
- DELETE ?rascunho=1&documento=...&id=...
  remove rascunho "A Enviar" vazio / correspondente.
- GET autenticado (admin): filtra somente enviados (oculta "A Enviar").
- GET/POST KBA do cliente: lista inclui "A Enviar" e "Enviado".
- POST envio final (WhatsApp) e fluxo de e-mail: status "Enviado".
"""
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

    def do_DELETE(self):
        servidor.responder_orcamentos(self)
