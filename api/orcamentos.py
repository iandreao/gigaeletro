"""GET, POST e DELETE /api/orcamentos na Vercel.

Toda a lógica vive em servidor.responder_orcamentos (mesmo código do servidor local):

- POST { acao: "rascunho", documento, itens, tipoOrcamento, id? }
  upsert com status "A Enviar"; itens=[] remove o rascunho.
  Não rebaixa Enviado sem id explícito de edição.
- DELETE ?rascunho=1&documento=...&id=...
  remove rascunho "A Enviar" vazio / correspondente (nunca Enviado).
- GET autenticado (admin): filtra somente enviados (oculta "A Enviar").
- GET ?lixeira=1 | ?excluidos=1 | ?incluir_excluidos=1: lista todos os excluídos
  (Recebido/Enviado/Pendente/Analisado/Respondido) para Restaurar.
- GET/POST KBA do cliente: lista inclui "A Enviar" e "Enviado".
- POST { restaurar: true, id }: remove flags de exclusão (excluido=false).
- POST envio final (WhatsApp/E-mail): promove o rascunho (mesmo id) para status "Enviado"
  com meio_envio preenchido; remove A Enviar órfãos do mesmo CPF/CNPJ.
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
