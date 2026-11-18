"""GET /api/dashboard-estatisticas na Vercel.

Delega a servidor.responder_dashboard / metricas_validas: mesmas regras de
Orçamentos Recebidos (sem lixeira, sem órfãos, sem status "A Enviar").
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http.server import BaseHTTPRequestHandler

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        servidor.responder_dashboard(self)
