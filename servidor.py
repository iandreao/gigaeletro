"""Servidor local da Gigaeletro e núcleo das funções Python na Vercel.

O catálogo fica na tabela produtos. Processar a planilha substitui a tabela
inteira numa transação: DELETE FROM produtos, leitura do arquivo e inserção
em lote. Se a leitura falhar, o ROLLBACK devolve o catálogo anterior.

No computador o banco é data/gigaeletro.db. Na Vercel o disco do projeto é
somente leitura e o /tmp não é compartilhado entre instâncias: o SQLite só
valida a planilha, e o catálogo processado é publicado no Blob
(catalogo/catalogo.json). Enquanto nenhuma planilha foi publicada, vale o
data/catalogo.json do deploy.
"""
import base64
import csv
import hashlib
import hmac
import html
import io
import ipaddress
import json
import os
import random
import re
import secrets
import socket
import sqlite3
import ssl
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
FONTE_CATALOGO = ROOT / "data" / "catalogo.json"
FONTE_ULTIMA_SYNC = ROOT / "data" / "ultima_sync.json"
CENTAVO = Decimal("0.01")
CATALOGO_ULTIMA_SYNC_BLOB = "catalogo/ultima_sync.json"
CATALOGO_ALERTA_DIARIO_BLOB = "catalogo/alerta_nao_atualizado.json"
ALERTA_DIARIO_REDIS = "alerta:{giga}:nao_atualizado:"
TIPO_REVEND_CATALOGO = re.compile(r"^00(\s*-|\b)", re.I)
RE_GERADO_UNIPLUS = re.compile(
    r"Gerado\s+em\s+(\d{2}/\d{2}/(?:\d{2}|\d{4}))(?:\s+(\d{2}:\d{2}:\d{2}))?",
    re.I,
)
ALERTA_SYNC_DESTINO = "iandreao1308@gmail.com"
TITULOS_UNIPLUS_ESPERADOS = {
    0: ("Código", ("codigo",)),
    1: ("Nome", ("nome",)),
    3: ("Preço Unit", ("preco unit",)),
    4: ("Estoque", ("estoque",)),
    5: ("Tipo de produto", ("tipo de produto",)),
}
# Valores de teste usados só fora da Vercel; em produção valem ADMIN_PASSWORD e SEGREDO_SESSAO.
SENHA_TESTE_LOCAL = "GigaAdmin2026"
SEGREDO_TESTE_LOCAL = "gigaeletro-sessao-local"
COOKIE_ADMIN = "gigaeletro_admin"
SESSAO_SEGUNDOS = 12 * 60 * 60
LIMITE_ENVIO = 30 * 1024 * 1024
LIMITE_PDF = 2 * 1024 * 1024
VALIDADE_PDF = 7 * 24 * 60 * 60
PDFS = {}
PDF_LOCK = threading.Lock()
PAINEL_LOCK = threading.Lock()
PAINEL_BLOB = "orcamentos/painel.json"
PAINEL_LIMITE = 2000
# Na Vercel o /tmp é de uma instância só: o catálogo publicado pela área restrita fica no Blob.
CATALOGO_BLOB = "catalogo/catalogo.json"
CATALOGO_SYNC_BLOB = CATALOGO_ULTIMA_SYNC_BLOB
# Cada instância reaproveita o catálogo baixado por esse prazo, para a home não baixar ~550 KB a cada visita.
CATALOGO_CACHE_SEGUNDOS = 60
CATALOGO_CACHE = {"conteudo": b"", "ate": 0.0}
CATALOGO_CACHE_LOCK = threading.Lock()
MEIOS_ENVIO = ("WhatsApp", "E-mail", "Comando de Voz")
MEIO_ENVIO_PADRAO = "WhatsApp"
STATUS_ENVIO_RASCUNHO = "A Enviar"
STATUS_ENVIO_FINAL = "Enviado"
STATUS_ATENDIMENTO_RECEBIDO = "Recebido"
TIPOS_ORCAMENTO = ("Tradicional", "Comando de Voz")
# Mesmo CPF/CNPJ, itens e meio de envio nesse prazo é o mesmo envio repetido (duplo clique, reenvio da rede).
PAINEL_REPETIDO = 10
# A lista de voz confirmada entra no painel na hora; se o cliente a enviar depois, o envio assume esse registro.
PAINEL_VOZ_JANELA = 30 * 60
METRICAS_LOCK = threading.Lock()
METRICAS_BLOB = "orcamentos/metricas.json"
METRICAS_LIMITE = 5000
# A hash tag {giga} mantém todas as chaves no mesmo slot: SUNIONSTORE não aceita chaves em slots diferentes.
ACESSOS_CHAVE = "acessos:{giga}:"
ACESSOS_POR_DIA = 5000
ACESSOS_LISTA = 500
ACESSOS_DIAS = 30
ACESSOS_EXPIRA = 400 * 24 * 60 * 60
ACESSOS_CORPO_MAX = 4096
EQUIPE_CHAVE = "equipe:{giga}:"
EQUIPE_FUNCIONARIOS = EQUIPE_CHAVE + "funcionarios"
EQUIPE_LOGS = EQUIPE_CHAVE + "logs"
EQUIPE_LOGS_LIMITE = 2000
EQUIPE_ADMIN = "Administrador"
RE_MOBILE = re.compile(r"Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi", re.IGNORECASE)
RE_ROBO = re.compile(r"bot|crawl|spider|slurp", re.IGNORECASE)
RE_SESSAO = re.compile(r"[A-Za-z0-9-]{8,64}")
CAMPOS_AUDITORIA = (
    "data_hora", "nome", "telefone", "email", "cep", "dispositivo",
    "contactado", "contactado_em", "id_sessao", "id_visitante",
)
NOMES_DISPOSITIVO = ("Aceliani", "Julio", "Ivalino", "Caixa", "Balcão 01", "Balcão 02", "Balcão 03")
CLIENTE_EXTERNO = "Cliente Externo"
RESEND_URL = "https://api.resend.com/emails"
# O domínio precisa estar verificado no Resend; EMAIL_REMETENTE troca o endereço sem mexer no código.
EMAIL_REMETENTE_PADRAO = "Gigaeletro <orcamentos@gigaeletro.com.br>"
EMAIL_ARQUIVO = "Pedido-de-Orcamento-Gigaeletro.pdf"
EMAIL_CORPO_MAX = LIMITE_PDF * 4 // 3 + 256 * 1024
EMAIL_JANELA = 10 * 60
EMAIL_POR_JANELA = 5
EMAIL_ENVIOS = {}
EMAIL_LOCK = threading.Lock()
# Confirmação de identidade em "Meus Orçamentos": opções mascaradas por campo e trava por CPF/CNPJ.
# A trava fica no Redis (compartilhada entre as instâncias da Vercel); sem ele, na memória da instância.
KBA_OPCOES = 4
KBA_TENTATIVAS = 3
KBA_BLOQUEIO = 5 * 60
KBA_ERROS = {}
KBA_LOCK = threading.Lock()
KBA_PREFIXOS_EMAIL = (
    "an", "ma", "jo", "ca", "lu", "ra", "fe", "pa", "ju", "ga", "be", "ro", "da", "le",
    "mi", "al", "ed", "vi", "th", "br", "sa", "re", "gu", "fa", "ri", "ad", "ce", "di",
)
RE_EMAIL = re.compile(r"[^\s@<>,;:\"'()\[\]\\]+@[^\s@<>,;:\"'()\[\]\\]+\.[^\s@<>,;:\"'()\[\]\\]+")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
IMPORTACAO = threading.Lock()


class PlanilhaInvalida(Exception):
    pass


class ValidacaoUniplusErro(Exception):
    """Trava operacional de data/estrutura da planilha Uniplus (não altera o catálogo)."""

    def __init__(self, tipo, mensagem, detalhe=""):
        super().__init__(mensagem)
        self.tipo = str(tipo or "").strip() or "estrutura_invalida"
        self.detalhe = str(detalhe or "").strip()
        self.mensagem = str(mensagem or "").strip()


def em_vercel():
    return os.environ.get("VERCEL") == "1"


def diretorio_gravavel():
    if em_vercel():
        return Path("/tmp/gigaeletro")
    return ROOT / "data"


def caminho_banco():
    return diretorio_gravavel() / "gigaeletro.db"


def caminho_catalogo():
    if em_vercel():
        return diretorio_gravavel() / "catalogo.json"
    return FONTE_CATALOGO


def caminho_auditoria():
    return diretorio_gravavel() / "auditoria.json"


def caminho_painel():
    return diretorio_gravavel() / "orcamentos-painel.json"


def caminho_metricas():
    return diretorio_gravavel() / "orcamentos-metricas.json"


def diretorio_pdf():
    if em_vercel():
        return diretorio_gravavel() / "uploads"
    return ROOT / "uploads"


def conectar(banco=None):
    if banco is None:
        banco = caminho_banco()
    Path(banco).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(banco, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def preparar_banco(banco=None, catalogo=None):
    if banco is None:
        banco = caminho_banco()
    if catalogo is None:
        catalogo = FONTE_CATALOGO
    Path(banco).parent.mkdir(parents=True, exist_ok=True)
    conn = conectar(banco)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY,
            codigo TEXT NOT NULL,
            nome TEXT NOT NULL,
            estoque TEXT NOT NULL DEFAULT '',
            preco REAL NOT NULL
        )
        """
    )
    total = conn.execute("SELECT COUNT(*) FROM produtos").fetchone()[0]
    if total == 0 and catalogo.exists():
        try:
            bruto = json.loads(catalogo.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            bruto = []
        linhas = []
        if isinstance(bruto, list):
            for item in bruto:
                if not item or not item.get("produto"):
                    continue
                try:
                    preco = float(item.get("preco"))
                except (TypeError, ValueError):
                    continue
                linhas.append((
                    str(item.get("codigo") or item["produto"]),
                    str(item["produto"]),
                    "" if item.get("estoque") is None else str(item.get("estoque")),
                    preco,
                ))
        if linhas:
            conn.executemany(
                "INSERT INTO produtos (codigo, nome, estoque, preco) VALUES (?, ?, ?, ?)",
                linhas,
            )
    conn.commit()
    conn.close()


def listar_produtos(banco=None):
    if banco is None:
        banco = caminho_banco()
        preparar_banco(banco)
    conn = conectar(banco)
    linhas = conn.execute(
        "SELECT codigo, nome, estoque, preco FROM produtos ORDER BY id"
    ).fetchall()
    conn.close()
    return [
        {
            "codigo": linha["codigo"],
            "produto": linha["nome"],
            "estoque": linha["estoque"],
            "preco": linha["preco"],
        }
        for linha in linhas
    ]


def gravar_auditoria(resumo, destino=None):
    if destino is None:
        destino = caminho_auditoria()
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(resumo, ensure_ascii=False), encoding="utf-8")
    os.replace(temporario, destino)


def senha_admin():
    """ADMIN_PASSWORD do ambiente; na Vercel sem a variável fica vazia e o login permanece fechado."""
    valor = (os.environ.get("ADMIN_PASSWORD") or "").strip()
    if valor:
        return valor
    return "" if em_vercel() else SENHA_TESTE_LOCAL


def segredo_sessao():
    """SEGREDO_SESSAO do ambiente; na Vercel sem a variável nenhuma sessão é emitida nem aceita."""
    valor = (os.environ.get("SEGREDO_SESSAO") or "").strip()
    if valor:
        return valor.encode("utf-8")
    return b"" if em_vercel() else SEGREDO_TESTE_LOCAL.encode("utf-8")


def acesso_configurado():
    return bool(senha_admin() and segredo_sessao())


def senha_confere(senha):
    """Senha administrativa padrão, comparada em tempo constante."""
    esperada = senha_admin()
    if not esperada:
        return False
    tentativa = str(senha or "").strip().encode("utf-8")
    return hmac.compare_digest(tentativa, esperada.encode("utf-8"))


def emitir_token():
    expira = int(time.time()) + SESSAO_SEGUNDOS
    carga = f"{expira}.{secrets.token_hex(8)}"
    assinatura = hmac.new(segredo_sessao(), carga.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{carga}.{assinatura}"


def token_valido(valor):
    segredo = segredo_sessao()
    partes = str(valor or "").split(".")
    if not segredo or len(partes) != 3:
        return False
    carga = partes[0] + "." + partes[1]
    esperado = hmac.new(segredo, carga.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(partes[2], esperado):
        return False
    try:
        return int(partes[0]) > time.time()
    except ValueError:
        return False


def cookie_de(cabecalho):
    for parte in str(cabecalho or "").split(";"):
        nome, separador, valor = parte.strip().partition("=")
        if separador and nome == COOKIE_ADMIN:
            return valor
    return ""


def sufixo_cookie():
    return "; Secure" if em_vercel() else ""


def cabecalho_cookie(token):
    return (
        f"{COOKIE_ADMIN}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSAO_SEGUNDOS}{sufixo_cookie()}"
    )


def cabecalho_logout():
    return f"{COOKIE_ADMIN}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{sufixo_cookie()}"


def contar_produtos(banco=None):
    if banco is None:
        banco = caminho_banco()
        preparar_banco(banco)
    conn = conectar(banco)
    total = conn.execute("SELECT COUNT(*) FROM produtos").fetchone()[0]
    conn.close()
    return total


def ler_auditoria(destino=None):
    if destino is None:
        destino = caminho_auditoria()
    if not destino.exists():
        return {"ok": False}
    try:
        dados = json.loads(destino.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ok": False}
    return dados if isinstance(dados, dict) else {"ok": False}


def publicar_json(produtos, catalogo=None):
    if catalogo is None:
        catalogo = caminho_catalogo()
    catalogo.parent.mkdir(parents=True, exist_ok=True)
    temporario = catalogo.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(produtos, ensure_ascii=False), encoding="utf-8")
    os.replace(temporario, catalogo)


def substituir_catalogo(nome, conteudo, banco=None, catalogo=None):
    """Apaga a tabela e grava a planilha nova. Falha de leitura faz rollback."""
    vivo = banco is None and catalogo is None
    if banco is None:
        banco = caminho_banco()
    if catalogo is None:
        catalogo = caminho_catalogo()
    with IMPORTACAO:
        preparar_banco(banco)
        conn = conectar(banco)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM produtos")
            itens, linhas_lidas, pulados = ler_planilha(nome, conteudo)
            conn.executemany(
                "INSERT INTO produtos (codigo, nome, estoque, preco) VALUES (?, ?, ?, ?)",
                itens,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        produtos = listar_produtos(banco)
        publicar_json(produtos, catalogo)
        if vivo:
            publicar_catalogo_blob(produtos)
        resumo = {
            "ok": True,
            "quantidade": len(produtos),
            "linhas_lidas": linhas_lidas,
            "inseridos": len(produtos),
            "pulados": pulados,
            "atualizado_em": datetime.now().strftime("%d/%m/%y às %H:%M"),
            "substituicao": "total",
        }
        if vivo:
            gravar_auditoria(resumo)
        return produtos, resumo


def ler_planilha(nome, conteudo):
    nome = str(nome or "")
    if nome.lower().endswith((".csv", ".txt")):
        matriz = csv_para_matriz(decodificar(conteudo))
    elif nome.lower().endswith((".xlsx", ".xls")):
        matriz = xlsx_para_matriz(conteudo)
    else:
        raise PlanilhaInvalida(
            "Para atualizar o estoque, use a Tabela de Produtos em CSV ou Excel, com as colunas Código, Nome, Estoque e PrVenda."
        )
    return objetos_da_matriz(matriz)


def publicar_catalogo_blob(produtos):
    if not token_blob():
        return
    conteudo = json.dumps(produtos, ensure_ascii=False).encode("utf-8")
    if not enviar_json_blob(CATALOGO_BLOB, conteudo):
        raise OSError("blob")
    with CATALOGO_CACHE_LOCK:
        CATALOGO_CACHE.update(conteudo=conteudo, ate=time.time() + CATALOGO_CACHE_SEGUNDOS)


def catalogo_publicado():
    """Prioriza Vercel Blob (catalogo/catalogo.json); fallback para data/catalogo.json local."""
    agora = time.time()
    with CATALOGO_CACHE_LOCK:
        if CATALOGO_CACHE["conteudo"] and CATALOGO_CACHE["ate"] > agora:
            return CATALOGO_CACHE["conteudo"]
    if token_blob():
        conteudo = baixar_blob(CATALOGO_BLOB, consistente=True)
        if conteudo is None:
            if CATALOGO_CACHE["conteudo"]:
                return CATALOGO_CACHE["conteudo"]
            try:
                return FONTE_CATALOGO.read_bytes() if FONTE_CATALOGO.is_file() else b"[]"
            except OSError:
                return b"[]"
        if not conteudo:
            try:
                conteudo = FONTE_CATALOGO.read_bytes() if FONTE_CATALOGO.is_file() else b"[]"
            except OSError:
                conteudo = b"[]"
        with CATALOGO_CACHE_LOCK:
            CATALOGO_CACHE.update(conteudo=conteudo, ate=agora + CATALOGO_CACHE_SEGUNDOS)
        return conteudo
    try:
        return FONTE_CATALOGO.read_bytes() if FONTE_CATALOGO.is_file() else b"[]"
    except OSError:
        return b"[]"


def decimal_centavos(valor):
    """Converte número/texto BR/US em Decimal quantizado em 2 casas (ROUND_HALF_UP)."""
    if valor is None:
        raise InvalidOperation("vazio")
    if isinstance(valor, Decimal):
        return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    if isinstance(valor, int) and not isinstance(valor, bool):
        return Decimal(valor).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    if isinstance(valor, float):
        return Decimal(str(valor)).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    texto = str(valor).strip().replace("R$", "").replace(" ", "")
    if not texto:
        raise InvalidOperation("vazio")
    if "," in texto and "." in texto:
        if texto.rfind(",") > texto.rfind("."):
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", "")
    elif "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    return Decimal(texto).quantize(CENTAVO, rounding=ROUND_HALF_UP)


def formatar_decimal(valor):
    return format(decimal_centavos(valor), "f")


def token_sync_catalogo():
    return (os.environ.get("CATALOGO_SYNC_TOKEN") or "").strip()


def autorizacao_sync_catalogo(entrada):
    esperado = token_sync_catalogo()
    if not esperado:
        return False
    bruto = (entrada.headers.get("Authorization") or "").strip()
    if not bruto.lower().startswith("bearer "):
        return False
    informado = bruto[7:].strip()
    if not informado or len(informado) != len(esperado):
        return False
    return hmac.compare_digest(informado, esperado)


def auditoria_itens_catalogo(itens):
    """Recalcula qtd / soma_preco / soma_estoque com Decimal a partir da lista do site."""
    qtd = 0
    soma_preco = Decimal("0.00")
    soma_estoque = Decimal("0.00")
    for item in itens or []:
        if not isinstance(item, dict):
            continue
        nome = str(item.get("produto") or item.get("nome") or "").strip()
        if not nome:
            continue
        try:
            preco = decimal_centavos(item.get("preco"))
            estoque = decimal_centavos(item.get("estoque"))
        except (InvalidOperation, ValueError, TypeError):
            continue
        qtd += 1
        soma_preco += preco
        soma_estoque += estoque
    soma_preco = soma_preco.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    soma_estoque = soma_estoque.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    return {
        "qtd_itens": qtd,
        "soma_preco": formatar_decimal(soma_preco),
        "soma_estoque": formatar_decimal(soma_estoque),
        "_soma_preco": soma_preco,
        "_soma_estoque": soma_estoque,
    }


def normalizar_itens_sync(itens_brutos):
    limpos = []
    for item in itens_brutos or []:
        if not isinstance(item, dict):
            continue
        codigo = re.sub(r"[^\d]", "", str(item.get("codigo") or ""))
        nome = str(item.get("nome") or item.get("produto") or "").strip()
        if not codigo or not nome:
            continue
        try:
            preco = decimal_centavos(item.get("preco"))
            estoque = decimal_centavos(item.get("estoque"))
        except (InvalidOperation, ValueError, TypeError):
            continue
        if estoque <= 0:
            continue
        limpos.append({
            "codigo": codigo,
            "produto": nome,
            "estoque": formatar_decimal(estoque),
            "preco": float(formatar_decimal(preco)),
        })
    return limpos


def gravar_catalogo_sync(produtos):
    """Grava no Blob (produção) e/ou data/catalogo.json + SQLite (dev)."""
    conteudo = json.dumps(produtos, ensure_ascii=False).encode("utf-8")
    if token_blob():
        if not enviar_json_blob(CATALOGO_BLOB, conteudo):
            raise OSError("blob")
        with CATALOGO_CACHE_LOCK:
            CATALOGO_CACHE.update(conteudo=conteudo, ate=time.time() + CATALOGO_CACHE_SEGUNDOS)
    if not em_vercel():
        FONTE_CATALOGO.parent.mkdir(parents=True, exist_ok=True)
        temporario = FONTE_CATALOGO.with_suffix(".json.tmp")
        temporario.write_bytes(conteudo)
        os.replace(temporario, FONTE_CATALOGO)
        try:
            banco = caminho_banco()
            preparar_banco(banco)
            conn = conectar(banco)
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM produtos")
                linhas = []
                for item in produtos:
                    try:
                        preco = float(formatar_decimal(item.get("preco")))
                    except (TypeError, ValueError, InvalidOperation):
                        continue
                    linhas.append((
                        str(item.get("codigo") or ""),
                        str(item.get("produto") or ""),
                        "" if item.get("estoque") is None else str(item.get("estoque")),
                        preco,
                    ))
                if linhas:
                    conn.executemany(
                        "INSERT INTO produtos (codigo, nome, estoque, preco) VALUES (?, ?, ?, ?)",
                        linhas,
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        except Exception:
            # Catálogo JSON já está no disco; SQLite é auxiliar no local.
            pass
    return conteudo


def ler_catalogo_apos_gravacao():
    if token_blob():
        bruto = baixar_blob(CATALOGO_BLOB, consistente=True)
        if bruto is None:
            raise OSError("blob-leitura")
        if not bruto:
            return []
        dados = json.loads(bruto.decode("utf-8"))
        return dados if isinstance(dados, list) else []
    if FONTE_CATALOGO.is_file():
        dados = json.loads(FONTE_CATALOGO.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    return []


def agora_sp():
    return agora_painel()


def limpar_codigo_uniplus(valor):
    if valor is None:
        return ""
    if isinstance(valor, float):
        if valor.is_integer():
            return str(int(valor))
        texto = format(valor, "f").rstrip("0").rstrip(".")
    else:
        texto = str(valor).strip()
    return re.sub(r"[^\d]", "", texto)


def totais_publicos(auditoria):
    return {
        "qtd_itens": auditoria["qtd_itens"],
        "soma_preco": auditoria["soma_preco"],
        "soma_estoque": auditoria["soma_estoque"],
    }


def diferencas_auditoria(a, b):
    return {
        "qtd_itens": int(a["qtd_itens"]) - int(b["qtd_itens"]),
        "soma_preco": formatar_decimal(a["_soma_preco"] - b["_soma_preco"]),
        "soma_estoque": formatar_decimal(a["_soma_estoque"] - b["_soma_estoque"]),
    }


def batimento_zero(a, b):
    return (
        a["qtd_itens"] == b["qtd_itens"]
        and a["_soma_preco"] == b["_soma_preco"]
        and a["_soma_estoque"] == b["_soma_estoque"]
    )


def montar_ultima_sync(origem, arquivo, usuario, ponta, descartados, auditoria_ok=True):
    agora = agora_sp()
    itens_desc = int(descartados or 0)
    return {
        "dataHora": agora.strftime("%d/%m/%Y %H:%M:%S"),
        "dataHoraIso": agora.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "origem": origem,
        "arquivo": str(arquivo or ""),
        "usuario": str(usuario or ""),
        "itensAtivos": int(ponta["qtd_itens"]),
        "itensDescartados": itens_desc,
        "somaPreco": ponta["soma_preco"],
        "somaEstoque": ponta["soma_estoque"],
        "auditoriaOk": bool(auditoria_ok),
    }


def persistir_ultima_sync(status):
    corpo = json.dumps(status, ensure_ascii=False, indent=2).encode("utf-8")
    if token_blob():
        try:
            enviar_json_blob(CATALOGO_ULTIMA_SYNC_BLOB, corpo)
        except Exception:
            pass
    if not em_vercel():
        try:
            FONTE_ULTIMA_SYNC.parent.mkdir(parents=True, exist_ok=True)
            FONTE_ULTIMA_SYNC.write_bytes(corpo)
        except OSError:
            pass
    return status


def normalizar_status_sync_lido(dados):
    if not isinstance(dados, dict):
        return None
    if "itensAtivos" in dados and "origem" in dados:
        return {
            "dataHora": str(dados.get("dataHora") or ""),
            "dataHoraIso": str(dados.get("dataHoraIso") or ""),
            "origem": str(dados.get("origem") or ""),
            "arquivo": str(dados.get("arquivo") or dados.get("arquivo_origem") or ""),
            "usuario": str(dados.get("usuario") or ""),
            "itensAtivos": int(dados.get("itensAtivos") or 0),
            "itensDescartados": int(dados.get("itensDescartados") or 0),
            "somaPreco": str(dados.get("somaPreco") or "0.00"),
            "somaEstoque": str(dados.get("somaEstoque") or "0.00"),
            "auditoriaOk": bool(dados.get("auditoriaOk", True)),
        }
    # Formato legado do robô.
    ponta = dados.get("vercel_auditoria") or dados.get("origem") or {}
    descartados = int(dados.get("descartados_tipo") or 0) + int(dados.get("descartados_estoque_zero") or 0)
    try:
        qtd = int(ponta.get("qtd_itens") or 0)
        soma_preco = formatar_decimal(ponta.get("soma_preco") or "0")
        soma_estoque = formatar_decimal(ponta.get("soma_estoque") or "0")
    except (TypeError, ValueError, InvalidOperation):
        qtd, soma_preco, soma_estoque = 0, "0.00", "0.00"
    return {
        "dataHora": str(dados.get("dataHora") or dados.get("data_sync") or ""),
        "dataHoraIso": str(dados.get("dataHoraIso") or dados.get("data_sync") or ""),
        "origem": str(dados.get("origem_label") or "Robô Automático"),
        "arquivo": str(dados.get("arquivo") or dados.get("arquivo_origem") or ""),
        "usuario": str(dados.get("usuario") or "Robô Uniplus"),
        "itensAtivos": qtd,
        "itensDescartados": descartados,
        "somaPreco": soma_preco,
        "somaEstoque": soma_estoque,
        "auditoriaOk": bool(dados.get("ok", True)),
    }


def ler_ultima_sync():
    bruto = None
    if token_blob():
        bruto = baixar_blob(CATALOGO_ULTIMA_SYNC_BLOB, consistente=True)
    if bruto is None and FONTE_ULTIMA_SYNC.is_file():
        try:
            bruto = FONTE_ULTIMA_SYNC.read_bytes()
        except OSError:
            bruto = None
    if not bruto:
        return None
    try:
        dados = json.loads(bruto.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return None
    return normalizar_status_sync_lido(dados)


def data_ultima_sync_sp(status):
    """Converte ultima_sync para date em America/Sao_Paulo."""
    if not isinstance(status, dict):
        return None
    iso = str(status.get("dataHoraIso") or "").strip()
    if iso:
        try:
            bruto = iso.replace("Z", "+00:00")
            dt = datetime.fromisoformat(bruto)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            try:
                from zoneinfo import ZoneInfo
                return dt.astimezone(ZoneInfo("America/Sao_Paulo")).date()
            except Exception:
                return dt.astimezone(timezone(timedelta(hours=-3))).date()
        except (TypeError, ValueError):
            pass
    dh = str(status.get("dataHora") or "").strip()
    match = re.match(r"^(\d{2})/(\d{2})/(\d{4})", dh)
    if match:
        try:
            return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
        except ValueError:
            return None
    return None


def _ler_trava_alerta_diario_blob():
    bruto = None
    if token_blob():
        bruto = baixar_blob(CATALOGO_ALERTA_DIARIO_BLOB, consistente=True)
    local = ROOT / "data" / "alerta_nao_atualizado.json"
    if bruto is None and local.is_file():
        try:
            bruto = local.read_bytes()
        except OSError:
            bruto = None
    if not bruto:
        return {}
    try:
        dados = json.loads(bruto.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return {}
    return dados if isinstance(dados, dict) else {}


def _gravar_trava_alerta_diario_blob(dia_iso):
    payload = {
        "ultimaDataAlerta": dia_iso,
        "atualizadoEm": agora_painel().isoformat(),
    }
    corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if token_blob():
        try:
            enviar_json_blob(CATALOGO_ALERTA_DIARIO_BLOB, corpo)
        except Exception:
            pass
    if not em_vercel():
        try:
            destino = ROOT / "data" / "alerta_nao_atualizado.json"
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(corpo)
        except OSError:
            pass


def alerta_diario_ja_enviado(dia_iso):
    chave = ALERTA_DIARIO_REDIS + str(dia_iso)
    if endereco_redis():
        try:
            valor = redis_pipeline([["GET", chave]])[0]
            if valor:
                return True
        except Exception:
            pass
    dados = _ler_trava_alerta_diario_blob()
    return str(dados.get("ultimaDataAlerta") or "") == str(dia_iso)


def marcar_alerta_diario_enviado(dia_iso):
    chave = ALERTA_DIARIO_REDIS + str(dia_iso)
    if endereco_redis():
        try:
            redis_pipeline([["SET", chave, "1", "EX", str(4 * 24 * 3600)]])
        except Exception:
            pass
    _gravar_trava_alerta_diario_blob(dia_iso)


def enviar_email_alerta_nao_atualizado(hoje_txt, status, simulado=False):
    chave = variavel_sem_aspas("RESEND_API_KEY")
    if not chave:
        return False, "RESEND_API_KEY ausente"
    ultima = "—"
    operador = "—"
    origem = "—"
    if isinstance(status, dict):
        ultima = str(status.get("dataHora") or status.get("dataHoraIso") or "—")
        operador = str(status.get("usuario") or "—")
        origem = str(status.get("origem") or "—")
    if simulado:
        intro = (
            "Este é um <strong>teste simulado</strong> (`simularAtraso=1`). "
            "O sistema verificou a atualização da tabela como se ela ainda não tivesse ocorrido hoje."
        )
        intro_txt = (
            "Este é um teste simulado (simularAtraso=1). "
            "O sistema verificou a atualização da tabela como se ela ainda não tivesse ocorrido hoje."
        )
    else:
        intro = (
            "Até o momento, a <strong>tabela de preços/estoque do site</strong> "
            "<strong>não foi atualizada hoje</strong> (%s)." % html.escape(hoje_txt)
        )
        intro_txt = (
            "Até o momento, a tabela de preços/estoque do site não foi atualizada hoje (%s)."
            % hoje_txt
        )
    link = "https://www.gigaeletro.com.br/admin.html"
    assunto = "Alerta GigaEletro: Tabela de Preços NÃO atualizada hoje (%s)" % hoje_txt
    texto = (
        "%s\n\n"
        "Última atualização registrada: %s\n"
        "Operador/origem: %s (%s)\n\n"
        "Acesse a Área Restrita para atualizar: %s\n"
        % (intro_txt, ultima, operador, origem, link)
    )
    corpo_html = (
        "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.45;color:#111\">"
        "<p>%s</p>"
        "<p><strong>Última atualização registrada:</strong> %s<br>"
        "<strong>Operador:</strong> %s<br>"
        "<strong>Origem:</strong> %s</p>"
        "<p><a href=\"%s\">Abrir Área Restrita (admin.html)</a></p>"
        "</div>"
        % (intro, html.escape(ultima), html.escape(operador), html.escape(origem), link)
    )
    payload = {
        "from": remetente_email(),
        "to": [ALERTA_SYNC_DESTINO],
        "subject": assunto,
        "html": corpo_html,
        "text": texto,
    }
    try:
        disparar_resend(chave, payload)
        return True, ""
    except Exception as erro:
        print("alerta-diario: falha Resend (%s)" % erro, file=sys.stderr, flush=True)
        return False, str(erro)


def responder_verificar_atualizacao_diaria(saida):
    """Cron Vercel (seg–sáb): alerta se a tabela não foi atualizada hoje. Sem auth de sessão."""
    agora = agora_painel()
    hoje = agora.date()
    hoje_txt = hoje.strftime("%d/%m/%Y")
    dia_iso = hoje.strftime("%Y-%m-%d")
    simular = parametro_consulta(saida.path, "simularAtraso") == "1"
    forcar = parametro_consulta(saida.path, "forcar") == "1"

    # Domingo: não alerta (exceto simulação de atraso).
    if agora.weekday() == 6 and not simular:
        escrever_json(saida, {"ok": True, "ignorado": "domingo", "data": hoje_txt})
        return

    status = ler_ultima_sync()
    data_sync = data_ultima_sync_sp(status)
    atualizado_hoje = bool(data_sync and data_sync == hoje)

    if atualizado_hoje and not simular:
        escrever_json(saida, {
            "ok": True,
            "atualizadoHoje": True,
            "ultimaSync": (status or {}).get("dataHora") or (status or {}).get("dataHoraIso") or "",
            "data": hoje_txt,
        })
        return

    ignorar_trava = simular or forcar
    if not ignorar_trava and alerta_diario_ja_enviado(dia_iso):
        escrever_json(saida, {
            "ok": True,
            "atualizadoHoje": False,
            "alertaJaEnviado": True,
            "ultimaSync": (status or {}).get("dataHora") or "",
            "data": hoje_txt,
        })
        return

    ok_envio, erro_envio = enviar_email_alerta_nao_atualizado(hoje_txt, status, simulado=simular)
    if not ok_envio:
        escrever_json(saida, {
            "ok": False,
            "atualizadoHoje": False,
            "erro": "Falha ao enviar alerta por e-mail.",
            "detalhe": erro_envio,
            "ultimaSync": (status or {}).get("dataHora") or "",
            "data": hoje_txt,
            "simulado": simular,
        }, 502)
        return

    # Simulação não grava trava (permite retestar). forcar=1 ainda grava após o envio.
    if not simular:
        marcar_alerta_diario_enviado(dia_iso)

    escrever_json(saida, {
        "ok": True,
        "atualizadoHoje": False,
        "alertaEnviado": True,
        "enviado_para": ALERTA_SYNC_DESTINO,
        "ultimaSync": (status or {}).get("dataHora") or "",
        "data": hoje_txt,
        "simulado": simular,
        "forcado": forcar,
    })


def celula_matriz(linha, indice, padrao=""):
    if indice < 0 or indice >= len(linha or []):
        return padrao
    return linha[indice]


def xls_para_matriz(conteudo):
    try:
        import xlrd
    except ImportError as erro:
        raise PlanilhaInvalida(
            "Para ler .xls do Uniplus no servidor, o pacote xlrd precisa estar instalado. "
            "Salve como .xlsx ou CSV, ou atualize o deploy. O catálogo anterior foi mantido."
        ) from erro
    try:
        livro = xlrd.open_workbook(file_contents=conteudo, formatting_info=False)
        folha = livro.sheet_by_index(0)
    except Exception as erro:
        raise PlanilhaInvalida(
            "Não foi possível abrir o .xls do Uniplus. O catálogo anterior foi mantido."
        ) from erro
    return [
        tuple(folha.cell_value(r, c) for c in range(folha.ncols))
        for r in range(folha.nrows)
    ]


def planilha_para_matriz_uniplus(nome, conteudo):
    lower = str(nome or "").lower()
    if lower.endswith((".csv", ".txt")):
        return csv_para_matriz(decodificar(conteudo))
    if lower.endswith(".xlsx") or (conteudo[:2] == b"PK"):
        return xlsx_para_matriz(conteudo)
    if lower.endswith(".xls") or conteudo[:4] == b"\xd0\xcf\x11\xe0":
        return xls_para_matriz(conteudo)
    raise PlanilhaInvalida(
        "Envie a planilha bruta do Uniplus em .xls, .xlsx ou .csv. O catálogo anterior foi mantido."
    )


def normalizar_titulo_uniplus(valor):
    texto = unicodedata.normalize("NFD", str(valor or ""))
    texto = "".join(caractere for caractere in texto if unicodedata.category(caractere) != "Mn")
    texto = re.sub(r"\s+", " ", texto).strip().lower()
    if texto.endswith("."):
        texto = texto[:-1].rstrip()
    return texto


def parse_data_carimbo_uniplus(texto_data):
    partes = str(texto_data or "").strip().split("/")
    if len(partes) != 3:
        raise ValueError("data")
    dia, mes, ano = int(partes[0]), int(partes[1]), int(partes[2])
    if ano < 100:
        ano += 2000
    return date(ano, mes, dia)


def extrair_carimbo_geracao_uniplus(matriz):
    """Procura de baixo para cima o carimbo 'Gerado em DD/MM/AA HH:MM:SS' na coluna 1."""
    for linha in reversed(list(matriz or [])):
        if not linha:
            continue
        textos = []
        textos.append(str(celula_matriz(linha, 0) or "").strip())
        textos.append(" ".join(str(c or "").strip() for c in linha if str(c or "").strip()))
        for texto in textos:
            if not texto:
                continue
            match = RE_GERADO_UNIPLUS.search(texto)
            if not match:
                continue
            carimbo = match.group(0).strip()
            carimbo = re.sub(r"\s+", " ", carimbo)
            if not carimbo.lower().startswith("gerado"):
                carimbo = "Gerado em " + match.group(1) + (
                    (" " + match.group(2)) if match.group(2) else ""
                )
            return carimbo, match.group(1)
    return None, None


def validar_data_geracao_uniplus(matriz):
    hoje = agora_painel().date()
    hoje_txt = hoje.strftime("%d/%m/%Y")
    carimbo, data_txt = extrair_carimbo_geracao_uniplus(matriz)
    if not carimbo or not data_txt:
        raise ValidacaoUniplusErro(
            "data_invalida",
            "Carimbo de geração não encontrado na última linha (esperado: Gerado em DD/MM/AA HH:MM:SS). "
            "Hoje no painel: %s. O catálogo anterior foi mantido." % hoje_txt,
            detalhe="(carimbo não encontrado)",
        )
    try:
        data_arquivo = parse_data_carimbo_uniplus(data_txt)
    except ValueError as erro:
        raise ValidacaoUniplusErro(
            "data_invalida",
            "Data do carimbo inválida (%s). Hoje: %s. O catálogo anterior foi mantido." % (carimbo, hoje_txt),
            detalhe=carimbo,
        ) from erro
    if data_arquivo != hoje:
        raise ValidacaoUniplusErro(
            "data_invalida",
            "A planilha não é de hoje. Carimbo: %s. Data de hoje (America/Sao_Paulo): %s. "
            "Gere novamente o arquivo no Uniplus com a data de hoje. O catálogo anterior foi mantido."
            % (carimbo, hoje_txt),
            detalhe=carimbo,
        )
    return carimbo


def achar_linha_cabecalho_uniplus(matriz):
    for indice, linha in enumerate(list(matriz or [])[:40]):
        if normalizar_titulo_uniplus(celula_matriz(linha, 0)) == "codigo":
            return indice
    return -1


def validar_titulos_colunas_uniplus(matriz):
    indice = achar_linha_cabecalho_uniplus(matriz)
    if indice < 0:
        raise ValidacaoUniplusErro(
            "estrutura_invalida",
            'Cabeçalho não encontrado. Esperado Coluna 1 "Código". O catálogo anterior foi mantido.',
            detalhe='Coluna 1: esperado "Código"',
        )
    linha = list(matriz[indice] or [])
    divergencias = []
    for posicao, (rotulo, aceitos) in TITULOS_UNIPLUS_ESPERADOS.items():
        encontrado = str(celula_matriz(linha, posicao) or "").strip()
        normalizado = normalizar_titulo_uniplus(encontrado)
        if normalizado not in aceitos:
            divergencias.append(
                'Coluna %s: esperado "%s", encontrado "%s"'
                % (posicao + 1, rotulo, encontrado or "(vazio)")
            )
    if divergencias:
        raise ValidacaoUniplusErro(
            "estrutura_invalida",
            "Estrutura da planilha divergente. " + "; ".join(divergencias) +
            ". O catálogo anterior foi mantido.",
            detalhe="; ".join(divergencias),
        )
    return indice


def validar_prechecks_uniplus(matriz):
    """Validação 1 (data de hoje) + Validação 2 (títulos). Não altera catálogo."""
    if not matriz:
        raise PlanilhaInvalida("Planilha vazia. O catálogo anterior foi mantido.")
    carimbo = validar_data_geracao_uniplus(matriz)
    inicio = validar_titulos_colunas_uniplus(matriz)
    return carimbo, inicio


def montar_email_alerta_sync(tipo, detalhe="", carimbo=""):
    tipo = str(tipo or "").strip().lower()
    detalhe = str(detalhe or "").strip()
    carimbo = str(carimbo or "").strip() or detalhe or "(carimbo não encontrado)"
    if tipo == "data_invalida":
        return (
            "Atualização Tabela de Preço no SiteGigaeletro",
            "Olá, o último arquivo encontrado foi gerado em %s, favor gerar o arquivo com a data de hoje." % carimbo,
        )
    return (
        "Estrutura do arquivo - Suspeita de alteração",
        'Olá, Favor verificar a estrutura do arquivo, devendo conter: Coluna 1 "Código"; '
        'Coluna 2 "Nome"; Coluna 4 "Preço Unit"; Coluna 5 "Estoque" e Coluna 6 "Tipo de produto".',
    )


def enviar_email_alerta_sync(tipo, detalhe="", carimbo=""):
    chave = variavel_sem_aspas("RESEND_API_KEY")
    if not chave:
        return False, "RESEND_API_KEY ausente"
    assunto, texto = montar_email_alerta_sync(tipo, detalhe=detalhe, carimbo=carimbo)
    html = "<p>" + html.escape(texto) + "</p>"
    payload = {
        "from": remetente_email(),
        "to": [ALERTA_SYNC_DESTINO],
        "subject": assunto,
        "html": html,
        "text": texto,
    }
    try:
        disparar_resend(chave, payload)
        return True, ""
    except Exception as erro:
        print("alerta-sync: falha Resend (%s)" % erro, file=sys.stderr, flush=True)
        return False, str(erro)


def responder_alerta_sync(saida):
    if saida.command != "POST":
        escrever_json(saida, {"ok": False, "erro": "Método não permitido."}, 405)
        return
    if not token_sync_catalogo():
        escrever_json(saida, {"ok": False, "erro": "CATALOGO_SYNC_TOKEN não configurado no servidor."}, 503)
        return
    if not autorizacao_sync_catalogo(saida):
        escrever_json(saida, {"ok": False, "erro": "Não autorizado."}, 401)
        return
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "Corpo inválido ou grande demais."}, 413)
        return
    try:
        payload = json.loads(corpo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        escrever_json(saida, {"ok": False, "erro": "JSON inválido."}, 400)
        return
    if not isinstance(payload, dict):
        escrever_json(saida, {"ok": False, "erro": "Payload inválido."}, 400)
        return
    tipo = str(payload.get("tipo") or "").strip().lower()
    detalhe = str(payload.get("detalhe") or "").strip()
    carimbo = str(payload.get("carimbo") or "").strip()
    if tipo not in ("data_invalida", "estrutura_invalida"):
        escrever_json(saida, {"ok": False, "erro": "tipo deve ser data_invalida ou estrutura_invalida."}, 400)
        return
    ok_envio, erro_envio = enviar_email_alerta_sync(tipo, detalhe=detalhe, carimbo=carimbo)
    if not ok_envio:
        escrever_json(saida, {
            "ok": False,
            "erro": "Não foi possível enviar o e-mail de alerta.",
            "detalhe": erro_envio,
            "tipo": tipo,
        }, 502)
        return
    escrever_json(saida, {"ok": True, "tipo": tipo, "enviado_para": ALERTA_SYNC_DESTINO})


def processar_matriz_uniplus(matriz):
    """Aplica filtros Uniplus (tipo 00 + estoque > 0) e devolve produtos + totais Decimal da ponta 1."""
    carimbo, inicio = validar_prechecks_uniplus(matriz)
    idx_codigo, idx_nome, idx_preco, idx_estoque, idx_tipo = 0, 1, 3, 4, 5

    produtos = []
    descartados_tipo = 0
    descartados_estoque = 0
    soma_preco = Decimal("0.00")
    soma_estoque = Decimal("0.00")

    for bruto in matriz[inicio + 1:]:
        linha = list(bruto or [])
        codigo = limpar_codigo_uniplus(celula_matriz(linha, idx_codigo))
        if not codigo:
            continue
        nome = str(celula_matriz(linha, idx_nome) or "").strip()
        if not nome:
            continue
        if nome.lower().startswith(("total", "soma", "subtotal", "gerado em")):
            continue
        tipo = str(celula_matriz(linha, idx_tipo) or "").strip()
        if not TIPO_REVEND_CATALOGO.search(tipo):
            descartados_tipo += 1
            continue
        try:
            preco = decimal_centavos(celula_matriz(linha, idx_preco))
            estoque = decimal_centavos(celula_matriz(linha, idx_estoque))
        except (InvalidOperation, ValueError, TypeError):
            continue
        if estoque <= 0:
            descartados_estoque += 1
            continue
        soma_preco += preco
        soma_estoque += estoque
        produtos.append({
            "codigo": codigo,
            "produto": nome,
            "estoque": formatar_decimal(estoque),
            "preco": float(formatar_decimal(preco)),
        })

    if not produtos:
        raise PlanilhaInvalida(
            "Nenhum item elegível após filtros (tipo 00 e estoque > 0). O catálogo anterior foi mantido."
        )

    soma_preco = soma_preco.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    soma_estoque = soma_estoque.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    ponta1 = {
        "qtd_itens": len(produtos),
        "soma_preco": formatar_decimal(soma_preco),
        "soma_estoque": formatar_decimal(soma_estoque),
        "_soma_preco": soma_preco,
        "_soma_estoque": soma_estoque,
    }
    meta = {
        "descartados_tipo": descartados_tipo,
        "descartados_estoque_zero": descartados_estoque,
        "itens_descartados": descartados_tipo + descartados_estoque,
        "carimbo_geracao": carimbo,
    }
    return produtos, ponta1, meta


def publicar_com_auditoria_3_pontas(produtos, ponta1):
    ponta2 = auditoria_itens_catalogo(produtos)
    if ponta2["qtd_itens"] == 0 or not batimento_zero(ponta1, ponta2):
        return None, ponta2, None, {
            "ok": False,
            "erro": "Batimento falhou entre origem filtrada e catálogo processado (diferença diferente de zero).",
            "origem": totais_publicos(ponta1),
            "processado": totais_publicos(ponta2),
            "diferenca_origem_processado": diferencas_auditoria(ponta1, ponta2),
        }
    try:
        gravar_catalogo_sync(produtos)
        gravados = ler_catalogo_apos_gravacao()
    except Exception as erro:
        return None, ponta2, None, {
            "ok": False,
            "erro": "Falha ao gravar/releitura do catálogo: %s" % type(erro).__name__,
        }
    ponta3 = auditoria_itens_catalogo(gravados)
    if not batimento_zero(ponta1, ponta3) or not batimento_zero(ponta2, ponta3):
        return None, ponta2, ponta3, {
            "ok": False,
            "erro": "Batimento pós-gravação falhou (diferença diferente de zero entre as 3 pontas).",
            "origem": totais_publicos(ponta1),
            "processado": totais_publicos(ponta2),
            "blob": totais_publicos(ponta3),
            "diferenca_origem_blob": diferencas_auditoria(ponta1, ponta3),
            "diferenca_processado_blob": diferencas_auditoria(ponta2, ponta3),
        }
    return gravados, ponta2, ponta3, None


def responder_status_sync(saida):
    if saida.command != "GET":
        escrever_json(saida, {"ok": False, "erro": "Método não permitido."}, 405)
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Sessão do painel expirada. Entre novamente na Área Restrita."}, 401)
        return
    status = ler_ultima_sync()
    if not status:
        escrever_json(saida, {
            "ok": True,
            "encontrado": False,
            "status": None,
            "mensagem": "Nenhuma sincronização registrada ainda.",
        })
        return
    escrever_json(saida, {"ok": True, "encontrado": True, "status": status})


def responder_sincronizar_catalogo(saida):
    if saida.command != "POST":
        escrever_json(saida, {"ok": False, "erro": "Método não permitido."}, 405)
        return
    if not token_sync_catalogo():
        escrever_json(saida, {"ok": False, "erro": "CATALOGO_SYNC_TOKEN não configurado no servidor."}, 503)
        return
    if not autorizacao_sync_catalogo(saida):
        escrever_json(saida, {"ok": False, "erro": "Não autorizado."}, 401)
        return
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "Corpo inválido ou grande demais."}, 413)
        return
    try:
        payload = json.loads(corpo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        escrever_json(saida, {"ok": False, "erro": "JSON inválido."}, 400)
        return
    if not isinstance(payload, dict):
        escrever_json(saida, {"ok": False, "erro": "Payload inválido."}, 400)
        return
    itens_brutos = payload.get("itens")
    auditoria = payload.get("auditoria") or {}
    if not isinstance(itens_brutos, list) or not isinstance(auditoria, dict):
        escrever_json(saida, {"ok": False, "erro": "Campos itens/auditoria obrigatórios."}, 400)
        return

    produtos = normalizar_itens_sync(itens_brutos)
    try:
        qtd_ref = int(auditoria.get("qtd_itens"))
        soma_preco_ref = decimal_centavos(auditoria.get("soma_preco"))
        soma_estoque_ref = decimal_centavos(auditoria.get("soma_estoque"))
    except (TypeError, ValueError, InvalidOperation):
        escrever_json(saida, {"ok": False, "erro": "Auditoria de origem inválida."}, 422)
        return

    ponta1 = {
        "qtd_itens": qtd_ref,
        "soma_preco": formatar_decimal(soma_preco_ref),
        "soma_estoque": formatar_decimal(soma_estoque_ref),
        "_soma_preco": soma_preco_ref,
        "_soma_estoque": soma_estoque_ref,
    }
    _gravados, ponta2, ponta3, falha = publicar_com_auditoria_3_pontas(produtos, ponta1)
    if falha:
        escrever_json(saida, falha, 422 if "Batimento" in falha.get("erro", "") else 502)
        return

    descartados = int(auditoria.get("descartados_tipo") or 0) + int(auditoria.get("descartados_estoque_zero") or 0)
    arquivo = str(auditoria.get("arquivo_origem") or "")
    status = montar_ultima_sync(
        "Robô Automático",
        arquivo,
        "Robô Uniplus",
        ponta3,
        descartados,
        auditoria_ok=True,
    )
    persistir_ultima_sync(status)
    escrever_json(saida, {
        "ok": True,
        "vercel_auditoria": totais_publicos(ponta3),
        "arquivo_origem": arquivo,
        "data_sync": status["dataHoraIso"],
        "ultima_sync": status,
        "origem": totais_publicos(ponta1),
        "processado": totais_publicos(ponta2),
        "blob": totais_publicos(ponta3),
        "diferenca": {
            "qtd_itens": 0,
            "soma_preco": "0.00",
            "soma_estoque": "0.00",
        },
    })


def responder_upload_manual_uniplus(saida):
    if saida.command != "POST":
        escrever_json(saida, {"ok": False, "erro": "Método não permitido."}, 405)
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Sessão do painel expirada. Entre novamente na Área Restrita."}, 401)
        return
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "A planilha passou do tamanho aceito. O catálogo anterior foi mantido."}, 413)
        return
    if em_vercel() and not token_blob():
        escrever_json(
            saida,
            {"ok": False, "erro": "Armazenamento do catálogo (BLOB_READ_WRITE_TOKEN) não configurado no servidor. O catálogo anterior foi mantido."},
            503,
        )
        return
    try:
        campos, nome, arquivo = ler_formulario_campos(saida.headers.get("Content-Type", ""), corpo or b"")
    except PlanilhaInvalida as erro:
        escrever_json(saida, {"ok": False, "erro": str(erro)}, 400)
        return
    if not arquivo:
        escrever_json(saida, {"ok": False, "erro": "Selecione a planilha bruta do Uniplus antes de processar."}, 400)
        return
    usuario = (
        str(campos.get("usuario") or campos.get("funcionario") or campos.get("operador") or "").strip()
        or EQUIPE_ADMIN
    )
    dispositivo = str(campos.get("dispositivo") or "Desktop").strip() or "Desktop"
    try:
        matriz = planilha_para_matriz_uniplus(nome, arquivo)
        produtos, ponta1, meta = processar_matriz_uniplus(matriz)
    except ValidacaoUniplusErro as erro:
        escrever_json(saida, {
            "ok": False,
            "erro": erro.mensagem,
            "tipo_validacao": erro.tipo,
            "detalhe": erro.detalhe,
        }, 400)
        return
    except PlanilhaInvalida as erro:
        escrever_json(saida, {"ok": False, "erro": str(erro)}, 400)
        return
    except Exception as erro:
        print("catalogo: falha leitura uniplus (%s: %s)" % (type(erro).__name__, erro), file=sys.stderr, flush=True)
        escrever_json(saida, {"ok": False, "erro": "Erro ao ler a planilha Uniplus. O catálogo anterior foi mantido."}, 500)
        return

    _gravados, ponta2, ponta3, falha = publicar_com_auditoria_3_pontas(produtos, ponta1)
    if falha:
        escrever_json(saida, falha, 422 if "Batimento" in falha.get("erro", "") else 502)
        return

    status = montar_ultima_sync(
        "Upload Manual",
        nome,
        usuario,
        ponta3,
        meta["itens_descartados"],
        auditoria_ok=True,
    )
    persistir_ultima_sync(status)
    try:
        gravar_log_equipe(
            usuario,
            "Atualizou Tabela (Upload Manual Uniplus: %s itens)" % ponta3["qtd_itens"],
            dispositivo,
        )
    except Exception:
        pass

    escrever_json(saida, {
        "ok": True,
        "inseridos": ponta3["qtd_itens"],
        "itens_ativos": ponta3["qtd_itens"],
        "itens_descartados": meta["itens_descartados"],
        "descartados_tipo": meta["descartados_tipo"],
        "descartados_estoque_zero": meta["descartados_estoque_zero"],
        "arquivo": nome,
        "origem_label": "Upload Manual",
        "usuario": usuario,
        "atualizado_em": status["dataHora"],
        "ultima_sync": status,
        "auditoria_ok": True,
        "origem": totais_publicos(ponta1),
        "processado": totais_publicos(ponta2),
        "blob": totais_publicos(ponta3),
        "diferenca": {
            "qtd_itens": 0,
            "soma_preco": "0.00",
            "soma_estoque": "0.00",
        },
        "mensagem": "0.00 (Auditado com Sucesso)",
    })


def decodificar(conteudo):
    # Excel salva CSV em UTF-8 (com ou sem BOM) ou Windows-1252; "Texto Unicode" sai em UTF-16.
    if conteudo[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return conteudo.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for codec in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return conteudo.decode(codec)
        except UnicodeDecodeError:
            continue
    raise PlanilhaInvalida("Não foi possível ler o texto da planilha. O catálogo anterior foi mantido.")


def csv_para_matriz(texto):
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    if aspas_abertas(texto):
        raise PlanilhaInvalida(
            "A planilha terminou no meio de um campo. O catálogo anterior foi mantido."
        )
    return [list(linha) for linha in csv.reader(io.StringIO(texto), delimiter=delimitador_csv(texto))]


def delimitador_csv(texto):
    """";" do Excel em português, "," em inglês ou tabulação, decidido pela linha do cabeçalho:
    as vírgulas decimais das linhas de preço não pesam na escolha."""
    candidatos = (";", ",", "\t")
    linhas = texto.split("\n")[:30]
    for linha in linhas:
        compacta = compactar(linha)
        if "codigo" in compacta and ("prvenda" in compacta or "preco" in compacta):
            return max(candidatos, key=lambda separador: len(next(csv.reader([linha], delimiter=separador), [])))
    amostra = "\n".join(linhas)
    return max(candidatos, key=amostra.count)


def aspas_abertas(texto):
    abertas = False
    indice = 0
    while indice < len(texto):
        if texto[indice] == '"':
            if abertas and indice + 1 < len(texto) and texto[indice + 1] == '"':
                indice += 2
                continue
            abertas = not abertas
        indice += 1
    return abertas


def xlsx_para_matriz(conteudo):
    if conteudo[:4] == b"\xd0\xcf\x11\xe0":
        return xls_para_matriz(conteudo)
    try:
        pacote = zipfile.ZipFile(io.BytesIO(conteudo))
    except zipfile.BadZipFile as erro:
        raise PlanilhaInvalida(
            "Não foi possível abrir o Excel. Salve como .xlsx ou CSV. O catálogo anterior foi mantido."
        ) from erro
    nomes = pacote.namelist()
    compartilhadas = []
    if "xl/sharedStrings.xml" in nomes:
        raiz = ET.fromstring(pacote.read("xl/sharedStrings.xml"))
        for item in raiz.findall(f"{NS}si"):
            compartilhadas.append("".join((no.text or "") for no in item.iter(f"{NS}t")))
    folhas = sorted(nome for nome in nomes if nome.startswith("xl/worksheets/sheet") and nome.endswith(".xml"))
    if not folhas:
        raise PlanilhaInvalida("A planilha Excel não tem uma aba de produtos. O catálogo anterior foi mantido.")
    raiz = ET.fromstring(pacote.read(folhas[0]))
    matriz = []
    for linha in raiz.iter(f"{NS}row"):
        celulas = {}
        maior = -1
        for celula in linha.findall(f"{NS}c"):
            indice = indice_coluna(celula.get("r") or "")
            if indice < 0:
                continue
            maior = max(maior, indice)
            celulas[indice] = valor_celula(celula, compartilhadas)
        matriz.append([] if maior < 0 else [celulas.get(i, "") for i in range(maior + 1)])
    return matriz


def indice_coluna(referencia):
    letras = "".join(caractere for caractere in referencia if caractere.isalpha())
    if not letras:
        return -1
    numero = 0
    for caractere in letras:
        numero = numero * 26 + (ord(caractere.upper()) - 64)
    return numero - 1


def valor_celula(celula, compartilhadas):
    tipo = celula.get("t")
    if tipo == "inlineStr":
        return "".join((no.text or "") for no in celula.iter(f"{NS}t"))
    valor = celula.find(f"{NS}v")
    if valor is None or valor.text is None:
        return ""
    if tipo == "s":
        try:
            return compartilhadas[int(valor.text)]
        except (ValueError, IndexError):
            return ""
    return valor.text


def objetos_da_matriz(matriz):
    indice = achar_cabecalho(matriz)
    if indice < 0:
        raise PlanilhaInvalida(
            "Não achei o cabeçalho. Use as colunas Código, Nome, Estoque e PrVenda. O catálogo anterior foi mantido."
        )
    cabecalho = [normalizar(celula) for celula in (matriz[indice] or [])]
    itens = []
    pulados = []
    linhas_lidas = 0
    for posicao, campos in enumerate(matriz[indice + 1:], start=indice + 2):
        if not any(str(celula).strip() for celula in (campos or [])):
            continue
        linhas_lidas += 1
        mapa = {}
        for coluna, nome in enumerate(cabecalho):
            if nome and coluna < len(campos or []):
                mapa[nome] = campos[coluna]
        produto = str(valor_coluna(mapa, ["nome", "descricao", "produto"]) or "").strip()
        bruto_preco = valor_coluna(mapa, ["prvenda", "preco de venda", "preco venda", "preco"])
        preco = parse_preco(bruto_preco)
        codigo = str(valor_coluna(mapa, ["codigo"]) or "").strip()
        if produto and str(bruto_preco).strip() and preco != preco:
            raise PlanilhaInvalida(
                "Preço inválido em \"" + produto + "\". O catálogo anterior foi mantido."
            )
        if not produto:
            pulados.append("Linha " + str(posicao) + ": sem nome" + (" (código " + codigo + ")" if codigo else ""))
            continue
        if preco != preco:
            pulados.append("Linha " + str(posicao) + ": sem preço — " + produto)
            continue
        if not codigo:
            codigo = produto
        estoque = valor_coluna(mapa, ["estoque"])
        itens.append((
            codigo,
            produto,
            "" if estoque is None else str(estoque).strip(),
            preco,
        ))
    if not itens:
        raise PlanilhaInvalida(
            "Nenhuma linha válida. Confira Código, Nome, Estoque e PrVenda. O catálogo anterior foi mantido."
        )
    return itens, linhas_lidas, pulados


def achar_cabecalho(matriz):
    for indice, linha in enumerate(matriz[:30]):
        compactas = [compactar(celula) for celula in (linha or [])]
        tem_codigo = any(chave.startswith("codigo") for chave in compactas)
        tem_nome = any(
            chave == "nome" or chave.startswith("nome") or chave.startswith("descricao") or chave == "produto"
            for chave in compactas
        )
        tem_estoque = any(chave.startswith("estoque") for chave in compactas)
        tem_preco = any(
            chave == "prvenda" or chave.startswith("preco") or chave.startswith("prevenda")
            for chave in compactas
        )
        if tem_codigo and tem_nome and tem_estoque and tem_preco:
            return indice
    return -1


def valor_coluna(mapa, nomes):
    compactos = {compactar(chave): valor for chave, valor in mapa.items()}
    for nome in nomes:
        if nome in mapa and str(mapa[nome]).strip() != "":
            return mapa[nome]
    for nome in nomes:
        alvo = compactar(nome)
        if alvo in compactos and str(compactos[alvo]).strip() != "":
            return compactos[alvo]
    for nome in nomes:
        for chave, valor in mapa.items():
            if chave.startswith(nome) and str(valor).strip() != "":
                return valor
    return ""


def parse_preco(valor):
    if isinstance(valor, bool):
        return float("nan")
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = re.sub(r"r\$", "", str(valor or ""), flags=re.I)
    texto = re.sub(r"\s", "", texto)
    if not texto:
        return float("nan")
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif "," in texto:
        texto = texto.replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return float("nan")


def normalizar(valor):
    texto = unicodedata.normalize("NFD", str(valor or ""))
    texto = "".join(caractere for caractere in texto if unicodedata.category(caractere) != "Mn")
    return texto.strip().lower()


def compactar(valor):
    return re.sub(r"[^a-z0-9]", "", normalizar(valor))


def ler_formulario_campos(content_type, corpo):
    match = re.search(r"boundary=([^;]+)", content_type or "", re.I)
    if not match:
        raise PlanilhaInvalida("Envie a planilha pelo botão da área restrita.")
    limite = match.group(1).strip().strip('"').encode("utf-8", "ignore")
    campos = {}
    nome = ""
    arquivo = b""
    for pedaco in corpo.split(b"--" + limite):
        if pedaco.startswith(b"\r\n"):
            pedaco = pedaco[2:]
        if pedaco.endswith(b"\r\n"):
            pedaco = pedaco[:-2]
        if pedaco.endswith(b"--"):
            pedaco = pedaco[:-2]
            if pedaco.endswith(b"\r\n"):
                pedaco = pedaco[:-2]
        if not pedaco:
            continue
        cabecalho, separador, dados = pedaco.partition(b"\r\n\r\n")
        if not separador:
            continue
        texto = cabecalho.decode("utf-8", "replace")
        nome_campo = re.search(r'name="([^"]*)"', texto)
        chave = (nome_campo.group(1) if nome_campo else "").strip()
        if "filename=" in texto:
            encontrado = re.search(r'filename="([^"]*)"', texto)
            nome = encontrado.group(1) if encontrado else "planilha.csv"
            arquivo = dados
            if chave:
                campos[chave] = nome
        elif chave:
            campos[chave] = dados.decode("utf-8", "replace").strip()
    return campos, nome, arquivo


def ler_formulario(content_type, corpo):
    campos, nome, arquivo = ler_formulario_campos(content_type, corpo)
    return campos.get("senha", ""), nome, arquivo


def escrever_json(saida, dados, status=200, extra=None):
    escrever_json_pronto(saida, json.dumps(dados, ensure_ascii=False).encode("utf-8"), status, extra)


def escrever_json_pronto(saida, corpo, status=200, extra=None):
    saida.send_response(status)
    saida.send_header("Content-Type", "application/json; charset=utf-8")
    saida.send_header("Content-Length", str(len(corpo)))
    saida.send_header("Cache-Control", "no-store")
    for chave, valor in extra or []:
        saida.send_header(chave, valor)
    saida.end_headers()
    saida.wfile.write(corpo)


def ler_corpo(entrada):
    try:
        tamanho = int(entrada.headers.get("Content-Length", "0") or "0")
    except ValueError:
        tamanho = 0
    if tamanho < 0 or tamanho > LIMITE_ENVIO:
        return None
    if tamanho == 0:
        return b""
    return entrada.rfile.read(tamanho)


def responder_catalogo(saida):
    try:
        conteudo = catalogo_publicado()
        if conteudo is None:
            escrever_json(saida, listar_produtos())
            return
    except Exception:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível ler o catálogo."}, 500)
        return
    escrever_json_pronto(saida, conteudo)


def nome_funcionario(valor):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(valor or ""))).strip()[:60]


def dispositivo_equipe(informado="", agente=""):
    if informado in ("Mobile", "Desktop"):
        return informado
    return "Mobile" if RE_MOBILE.search(agente or "") else "Desktop"


def conectar_equipe():
    conn = conectar()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS equipe_funcionarios ("
        "id TEXT PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS equipe_logs ("
        "id TEXT PRIMARY KEY, horario TEXT NOT NULL, funcionario TEXT NOT NULL, "
        "acao TEXT NOT NULL, dispositivo TEXT)"
    )
    return conn


def listar_funcionarios_equipe(somente_ativos=False):
    if endereco_redis():
        bruto = redis_pipeline([["HVALS", EQUIPE_FUNCIONARIOS]])[0] or []
        itens = []
        for item in bruto if isinstance(bruto, list) else []:
            try:
                dados = json.loads(item) if isinstance(item, str) else item
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(dados, dict) and dados.get("id") and dados.get("nome"):
                itens.append({
                    "id": str(dados["id"]),
                    "nome": nome_funcionario(dados["nome"]),
                    "ativo": bool(dados.get("ativo", True)),
                })
    elif em_vercel():
        itens = []
    else:
        conn = conectar_equipe()
        try:
            linhas = conn.execute(
                "SELECT id, nome, ativo FROM equipe_funcionarios ORDER BY nome COLLATE NOCASE"
            ).fetchall()
        finally:
            conn.close()
        itens = [{"id": str(l["id"]), "nome": nome_funcionario(l["nome"]), "ativo": bool(l["ativo"])} for l in linhas]
    itens.sort(key=lambda item: item["nome"].casefold())
    if somente_ativos:
        itens = [item for item in itens if item["ativo"]]
    return itens


def funcionario_permitido(nome):
    nome = nome_funcionario(nome)
    if not nome:
        return ""
    if nome.casefold() == EQUIPE_ADMIN.casefold():
        return EQUIPE_ADMIN
    for item in listar_funcionarios_equipe(somente_ativos=True):
        if item["nome"].casefold() == nome.casefold():
            return item["nome"]
    return ""


def cadastrar_funcionario_equipe(nome):
    nome = nome_funcionario(nome)
    if not nome or nome.casefold() == EQUIPE_ADMIN.casefold():
        return None, "Informe um nome válido de funcionário."
    for item in listar_funcionarios_equipe():
        if item["nome"].casefold() == nome.casefold():
            return None, "Este funcionário já está cadastrado."
    registro = {
        "id": secrets.token_hex(8),
        "nome": nome,
        "ativo": True,
        "criado_em": agora_painel().strftime("%Y-%m-%d %H:%M:%S"),
    }
    if endereco_redis():
        redis_pipeline([["HSET", EQUIPE_FUNCIONARIOS, registro["id"], json.dumps(registro, ensure_ascii=False)]])
        return registro, ""
    if em_vercel():
        return None, "Cadastro indisponível: falta REDIS_URL."
    conn = conectar_equipe()
    try:
        conn.execute(
            "INSERT INTO equipe_funcionarios (id, nome, ativo, criado_em) VALUES (?, ?, 1, ?)",
            (registro["id"], registro["nome"], registro["criado_em"]),
        )
        conn.commit()
    finally:
        conn.close()
    return registro, ""


def _ler_funcionario_equipe(identificador):
    identificador = str(identificador or "").strip()
    if not identificador or identificador == "admin":
        return None
    if endereco_redis():
        bruto = redis_pipeline([["HGET", EQUIPE_FUNCIONARIOS, identificador]])[0]
        if not bruto:
            return None
        try:
            dados = json.loads(bruto) if isinstance(bruto, str) else bruto
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(dados, dict) or not dados.get("nome"):
            return None
        return {
            "id": identificador,
            "nome": nome_funcionario(dados.get("nome")),
            "ativo": bool(dados.get("ativo", True)),
            "criado_em": str(dados.get("criado_em") or ""),
            "_bruto": dados,
        }
    if em_vercel():
        return None
    conn = conectar_equipe()
    try:
        linha = conn.execute(
            "SELECT id, nome, ativo, criado_em FROM equipe_funcionarios WHERE id = ?",
            (identificador,),
        ).fetchone()
    finally:
        conn.close()
    if not linha:
        return None
    return {
        "id": str(linha["id"]),
        "nome": nome_funcionario(linha["nome"]),
        "ativo": bool(linha["ativo"]),
        "criado_em": str(linha["criado_em"] or ""),
    }


def renomear_logs_equipe(nome_antigo, nome_novo):
    antigo = nome_funcionario(nome_antigo)
    novo = nome_funcionario(nome_novo)
    if not antigo or not novo or antigo.casefold() == novo.casefold():
        return
    if endereco_redis():
        bruto = redis_pipeline([["LRANGE", EQUIPE_LOGS, 0, EQUIPE_LOGS_LIMITE - 1]])[0] or []
        atualizados = []
        mudou = False
        for item in bruto if isinstance(bruto, list) else []:
            try:
                dados = json.loads(item) if isinstance(item, str) else item
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if not isinstance(dados, dict):
                continue
            if nome_funcionario(dados.get("funcionario")).casefold() == antigo.casefold():
                dados["funcionario"] = novo
                mudou = True
            atualizados.append(json.dumps(dados, ensure_ascii=False))
        if mudou:
            comandos = [["DEL", EQUIPE_LOGS]]
            if atualizados:
                # LPUSH empilha o último primeiro; reverte para preservar a ordem cronológica.
                comandos.append(["LPUSH", EQUIPE_LOGS] + list(reversed(atualizados)))
                comandos.append(["LTRIM", EQUIPE_LOGS, 0, EQUIPE_LOGS_LIMITE - 1])
            redis_pipeline(comandos)
        return
    if em_vercel():
        return
    conn = conectar_equipe()
    try:
        conn.execute(
            "UPDATE equipe_logs SET funcionario = ? WHERE lower(funcionario) = lower(?)",
            (novo, antigo),
        )
        conn.commit()
    finally:
        conn.close()


def alternar_funcionario_equipe(identificador, ativo=None):
    identificador = str(identificador or "").strip()
    if not identificador:
        return None, "Funcionário inválido."
    if em_vercel() and not endereco_redis():
        return None, "Alteração indisponível: falta REDIS_URL."
    atual = _ler_funcionario_equipe(identificador)
    if not atual:
        return None, "Funcionário não encontrado."
    if endereco_redis():
        dados = dict(atual.get("_bruto") or {})
        dados["id"] = identificador
        dados["nome"] = atual["nome"]
        dados["ativo"] = bool(ativo) if ativo is not None else (not bool(atual["ativo"]))
        redis_pipeline([["HSET", EQUIPE_FUNCIONARIOS, identificador, json.dumps(dados, ensure_ascii=False)]])
        return {"id": identificador, "nome": atual["nome"], "ativo": bool(dados["ativo"])}, ""
    conn = conectar_equipe()
    try:
        if ativo is None:
            novo = 0 if atual["ativo"] else 1
        else:
            novo = 1 if bool(ativo) else 0
        conn.execute("UPDATE equipe_funcionarios SET ativo = ? WHERE id = ?", (novo, identificador))
        conn.commit()
        return {"id": identificador, "nome": atual["nome"], "ativo": bool(novo)}, ""
    finally:
        conn.close()


def editar_funcionario_equipe(identificador, nome):
    identificador = str(identificador or "").strip()
    nome = nome_funcionario(nome)
    if not identificador:
        return None, "Funcionário inválido."
    if not nome or nome.casefold() == EQUIPE_ADMIN.casefold():
        return None, "Informe um nome válido de funcionário."
    if em_vercel() and not endereco_redis():
        return None, "Alteração indisponível: falta REDIS_URL."
    atual = _ler_funcionario_equipe(identificador)
    if not atual:
        return None, "Funcionário não encontrado."
    for item in listar_funcionarios_equipe():
        if item["id"] != identificador and item["nome"].casefold() == nome.casefold():
            return None, "Este funcionário já está cadastrado."
    if endereco_redis():
        dados = dict(atual.get("_bruto") or {})
        dados["id"] = identificador
        dados["nome"] = nome
        dados["ativo"] = bool(atual["ativo"])
        redis_pipeline([["HSET", EQUIPE_FUNCIONARIOS, identificador, json.dumps(dados, ensure_ascii=False)]])
        renomear_logs_equipe(atual["nome"], nome)
        return {"id": identificador, "nome": nome, "ativo": bool(atual["ativo"])}, ""
    conn = conectar_equipe()
    try:
        conn.execute("UPDATE equipe_funcionarios SET nome = ? WHERE id = ?", (nome, identificador))
        conn.commit()
    finally:
        conn.close()
    renomear_logs_equipe(atual["nome"], nome)
    return {"id": identificador, "nome": nome, "ativo": bool(atual["ativo"])}, ""


def excluir_funcionario_equipe(identificador):
    identificador = str(identificador or "").strip()
    if not identificador or identificador == "admin":
        return None, "Funcionário inválido."
    if em_vercel() and not endereco_redis():
        return None, "Exclusão indisponível: falta REDIS_URL."
    atual = _ler_funcionario_equipe(identificador)
    if not atual:
        return None, "Funcionário não encontrado."
    if endereco_redis():
        redis_pipeline([["HDEL", EQUIPE_FUNCIONARIOS, identificador]])
        return {"id": identificador, "nome": atual["nome"]}, ""
    conn = conectar_equipe()
    try:
        conn.execute("DELETE FROM equipe_funcionarios WHERE id = ?", (identificador,))
        conn.commit()
    finally:
        conn.close()
    return {"id": identificador, "nome": atual["nome"]}, ""


def gravar_log_equipe(funcionario, acao, dispositivo="Desktop"):
    funcionario = funcionario_permitido(funcionario) or nome_funcionario(funcionario) or EQUIPE_ADMIN
    acao = re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(acao or ""))).strip()[:160]
    if not acao:
        return None
    registro = {
        "id": secrets.token_hex(8),
        "horario": agora_painel().strftime("%d/%m/%Y %H:%M:%S"),
        "funcionario": funcionario,
        "acao": acao,
        "dispositivo": dispositivo_equipe(dispositivo),
    }
    if endereco_redis():
        redis_pipeline([
            ["LPUSH", EQUIPE_LOGS, json.dumps(registro, ensure_ascii=False)],
            ["LTRIM", EQUIPE_LOGS, 0, EQUIPE_LOGS_LIMITE - 1],
        ])
        return registro
    if em_vercel():
        return None
    conn = conectar_equipe()
    try:
        conn.execute(
            "INSERT INTO equipe_logs (id, horario, funcionario, acao, dispositivo) VALUES (?, ?, ?, ?, ?)",
            (registro["id"], registro["horario"], registro["funcionario"], registro["acao"], registro["dispositivo"]),
        )
        conn.commit()
    finally:
        conn.close()
    return registro


def listar_logs_equipe(limite=300, funcionario=""):
    limite = max(1, min(int(limite or 300), EQUIPE_LOGS_LIMITE))
    filtro = nome_funcionario(funcionario)
    if endereco_redis():
        bruto = redis_pipeline([["LRANGE", EQUIPE_LOGS, 0, limite - 1]])[0] or []
        logs = []
        for item in bruto if isinstance(bruto, list) else []:
            try:
                dados = json.loads(item) if isinstance(item, str) else item
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if not isinstance(dados, dict):
                continue
            if filtro and nome_funcionario(dados.get("funcionario")).casefold() != filtro.casefold():
                continue
            logs.append({
                "id": str(dados.get("id") or ""),
                "horario": str(dados.get("horario") or ""),
                "funcionario": nome_funcionario(dados.get("funcionario")),
                "acao": str(dados.get("acao") or ""),
                "dispositivo": dispositivo_equipe(dados.get("dispositivo")),
            })
        return logs[:limite]
    if em_vercel():
        return []
    conn = conectar_equipe()
    try:
        if filtro:
            linhas = conn.execute(
                "SELECT id, horario, funcionario, acao, dispositivo FROM equipe_logs "
                "WHERE lower(funcionario) = lower(?) ORDER BY horario DESC LIMIT ?",
                (filtro, limite),
            ).fetchall()
        else:
            linhas = conn.execute(
                "SELECT id, horario, funcionario, acao, dispositivo FROM equipe_logs "
                "ORDER BY horario DESC LIMIT ?",
                (limite,),
            ).fetchall()
    finally:
        conn.close()
    return [{
        "id": str(l["id"]),
        "horario": str(l["horario"] or ""),
        "funcionario": nome_funcionario(l["funcionario"]),
        "acao": str(l["acao"] or ""),
        "dispositivo": dispositivo_equipe(l["dispositivo"]),
    } for l in linhas]


def limpar_logs_equipe():
    if endereco_redis():
        redis_pipeline([["DEL", EQUIPE_LOGS]])
        return
    if em_vercel():
        return
    conn = conectar_equipe()
    try:
        conn.execute("DELETE FROM equipe_logs")
        conn.commit()
    finally:
        conn.close()


def dia_horario_equipe(horario):
    match = re.match(r"^(\d{2})/(\d{2})/(\d{4})", str(horario or "").strip())
    if not match:
        return ""
    return "%s-%s-%s" % (match.group(3), match.group(2), match.group(1))


def log_bate_exclusao_equipe(dados, funcionario, inicio="", fim=""):
    if not isinstance(dados, dict):
        return False
    if nome_funcionario(dados.get("funcionario")).casefold() != funcionario.casefold():
        return False
    # Modal lista apenas ações; exclusão segue o mesmo critério.
    if str(dados.get("acao") or "") == "Acessou a Área Restrita":
        return False
    dia = dia_horario_equipe(dados.get("horario"))
    if inicio and (not dia or dia < inicio):
        return False
    if fim and (not dia or dia > fim):
        return False
    return True


def excluir_logs_equipe(funcionario, data_inicio="", data_fim=""):
    funcionario = nome_funcionario(funcionario)
    if not funcionario:
        return 0, "Informe o funcionário."
    inicio = normalizar_data_painel(data_inicio) if str(data_inicio or "").strip() else ""
    fim = normalizar_data_painel(data_fim) if str(data_fim or "").strip() else ""
    if str(data_inicio or "").strip() and not inicio:
        return 0, "Data inicial inválida."
    if str(data_fim or "").strip() and not fim:
        return 0, "Data final inválida."
    if inicio and fim and inicio > fim:
        return 0, "O intervalo de datas é inválido."
    if endereco_redis():
        bruto = redis_pipeline([["LRANGE", EQUIPE_LOGS, 0, EQUIPE_LOGS_LIMITE - 1]])[0] or []
        mantidos = []
        excluidos = 0
        for item in bruto if isinstance(bruto, list) else []:
            try:
                dados = json.loads(item) if isinstance(item, str) else item
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if log_bate_exclusao_equipe(dados, funcionario, inicio, fim):
                excluidos += 1
                continue
            if isinstance(dados, dict):
                mantidos.append(json.dumps(dados, ensure_ascii=False))
        if excluidos:
            comandos = [["DEL", EQUIPE_LOGS]]
            if mantidos:
                comandos.append(["LPUSH", EQUIPE_LOGS] + list(reversed(mantidos)))
                comandos.append(["LTRIM", EQUIPE_LOGS, 0, EQUIPE_LOGS_LIMITE - 1])
            redis_pipeline(comandos)
        return excluidos, ""
    if em_vercel():
        return 0, "Exclusão indisponível: falta REDIS_URL."
    conn = conectar_equipe()
    try:
        linhas = conn.execute(
            "SELECT id, horario, funcionario, acao, dispositivo FROM equipe_logs"
        ).fetchall()
        ids = []
        for linha in linhas:
            dados = {
                "horario": linha["horario"],
                "funcionario": linha["funcionario"],
                "acao": linha["acao"],
            }
            if log_bate_exclusao_equipe(dados, funcionario, inicio, fim):
                ids.append(str(linha["id"]))
        for identificador in ids:
            conn.execute("DELETE FROM equipe_logs WHERE id = ?", (identificador,))
        conn.commit()
        return len(ids), ""
    finally:
        conn.close()


def resumo_equipe():
    funcionarios = listar_funcionarios_equipe()
    # Sempre inclui Administrador no resumo, mesmo sem cadastro explícito.
    nomes = {item["nome"].casefold(): item for item in funcionarios}
    if EQUIPE_ADMIN.casefold() not in nomes:
        funcionarios = [{"id": "admin", "nome": EQUIPE_ADMIN, "ativo": True}] + funcionarios
    logs = listar_logs_equipe(EQUIPE_LOGS_LIMITE)
    por_nome = {}
    for log in logs:
        chave = log["funcionario"].casefold()
        item = por_nome.setdefault(chave, {"acessos": 0, "acoes": 0, "ultimo": ""})
        if log["acao"] == "Acessou a Área Restrita":
            item["acessos"] += 1
        else:
            item["acoes"] += 1
        if not item["ultimo"]:
            item["ultimo"] = log["horario"]
    resumo = []
    for item in funcionarios:
        stats = por_nome.get(item["nome"].casefold(), {"acessos": 0, "acoes": 0, "ultimo": ""})
        resumo.append({
            "id": item["id"],
            "nome": item["nome"],
            "ativo": bool(item["ativo"]),
            "status": "Ativo" if item["ativo"] else "Inativo",
            "ultimo_acesso": stats["ultimo"] or "Nunca acessou",
            "total_acessos": stats["acessos"],
            "acoes_executadas": stats["acoes"],
        })
    # Devolve logs suficientes para o detalhamento de "Ações Executadas" no painel.
    return {"funcionarios": funcionarios, "resumo": resumo, "logs": logs[:EQUIPE_LOGS_LIMITE]}


def caminho_api(saida):
    return (saida.path or "").split("?", 1)[0].rstrip("/") or "/"


def responder_sessao(saida):
    escrever_json(saida, {"ok": token_valido(cookie_de(saida.headers.get("Cookie")))})


def responder_auditoria(saida):
    if caminho_api(saida).startswith("/api/equipe") or parametro_consulta(saida.path, "equipe"):
        responder_equipe_get(saida)
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False}, 401)
        return
    dados = ler_auditoria()
    dados["catalogo"] = contar_produtos()
    dados["ok"] = True
    escrever_json(saida, dados)


def responder_equipe_get(saida):
    caminho = caminho_api(saida)
    recurso = parametro_consulta(saida.path, "equipe")
    if caminho.endswith("/funcionarios") or recurso == "funcionarios":
        if not token_valido(cookie_de(saida.headers.get("Cookie"))):
            # Login: só nomes ativos, sem dados sensíveis.
            ativos = listar_funcionarios_equipe(somente_ativos=True)
            nomes = [item["nome"] for item in ativos]
            if EQUIPE_ADMIN not in nomes:
                nomes = [EQUIPE_ADMIN] + nomes
            escrever_json(saida, {"ok": True, "funcionarios": nomes})
            return
        escrever_json(saida, {"ok": True, "funcionarios": listar_funcionarios_equipe()})
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
        return
    dados = resumo_equipe()
    dados["ok"] = True
    escrever_json(saida, dados)


def responder_equipe_post(saida):
    caminho = caminho_api(saida)
    recurso = parametro_consulta(saida.path, "equipe")
    corpo = ler_corpo(saida)
    try:
        dados = json.loads((corpo or b"").decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        dados = {}
    if not isinstance(dados, dict):
        dados = {}
    acao = str(dados.get("acao") or "").strip()
    # Na Vercel o rewrite chega como /api/auditoria?equipe=log|funcionarios|resumo.
    eh_log = caminho.endswith("/log") or recurso == "log" or acao == "registrar_log"
    eh_funcionarios = caminho.endswith("/funcionarios") or recurso == "funcionarios" or acao in (
        "cadastrar_funcionario",
        "alternar_funcionario",
        "editar_funcionario",
        "editar",
        "excluir_funcionario",
        "excluir",
    )
    eh_resumo = (
        caminho.endswith("/resumo")
        or recurso == "resumo"
        or acao in ("limpar_logs", "excluir_logs", "excluir_registros")
    )
    if eh_log:
        if not token_valido(cookie_de(saida.headers.get("Cookie"))):
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        agente = saida.headers.get("User-Agent") or ""
        # No POST /log o campo "acao" é a descrição da opção executada.
        texto = dados.get("acao_texto") or dados.get("descricao") or dados.get("log")
        if not texto and acao != "registrar_log":
            texto = dados.get("acao")
        registro = gravar_log_equipe(
            dados.get("funcionario") or dados.get("operador"),
            texto,
            dispositivo_equipe(dados.get("dispositivo"), agente),
        )
        if not registro:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível registrar a ação."}, 400)
            return
        escrever_json(saida, {"ok": True, "log": registro})
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
        return
    if eh_funcionarios:
        if acao in ("excluir_funcionario", "excluir") or dados.get("excluir"):
            registro, erro = excluir_funcionario_equipe(dados.get("id"))
            if erro:
                escrever_json(saida, {"ok": False, "erro": erro}, 400)
                return
            escrever_json(saida, {"ok": True, "funcionario": registro})
            return
        if acao in ("editar_funcionario", "editar") or (dados.get("id") and dados.get("nome") and "ativo" not in dados):
            registro, erro = editar_funcionario_equipe(dados.get("id"), dados.get("nome"))
            if erro:
                escrever_json(saida, {"ok": False, "erro": erro}, 400)
                return
            escrever_json(saida, {"ok": True, "funcionario": registro})
            return
        if acao == "alternar_funcionario" or (dados.get("id") and "ativo" in dados):
            registro, erro = alternar_funcionario_equipe(dados.get("id"), dados.get("ativo"))
            if erro:
                escrever_json(saida, {"ok": False, "erro": erro}, 400)
                return
            escrever_json(saida, {"ok": True, "funcionario": registro})
            return
        registro, erro = cadastrar_funcionario_equipe(dados.get("nome"))
        if erro:
            escrever_json(saida, {"ok": False, "erro": erro}, 400)
            return
        escrever_json(saida, {"ok": True, "funcionario": registro})
        return
    if eh_resumo:
        if acao in ("excluir_logs", "excluir_registros") or dados.get("excluir_logs"):
            excluidos, erro = excluir_logs_equipe(
                dados.get("funcionario") or dados.get("operador"),
                dados.get("data_inicio") or dados.get("inicio") or "",
                dados.get("data_fim") or dados.get("fim") or "",
            )
            if erro:
                escrever_json(saida, {"ok": False, "erro": erro}, 400)
                return
            dados_resumo = resumo_equipe()
            dados_resumo["ok"] = True
            dados_resumo["excluidos"] = excluidos
            escrever_json(saida, dados_resumo)
            return
        if acao == "limpar_logs" or dados.get("limpar"):
            limpar_logs_equipe()
            escrever_json(saida, {"ok": True})
            return
        dados_resumo = resumo_equipe()
        dados_resumo["ok"] = True
        escrever_json(saida, dados_resumo)
        return
    escrever_json(saida, {"ok": False, "erro": "Ação inválida."}, 400)


def responder_equipe_delete(saida):
    caminho = caminho_api(saida)
    recurso = parametro_consulta(saida.path, "equipe")
    if not (caminho.endswith("/funcionarios") or recurso == "funcionarios" or caminho.startswith("/api/equipe")):
        escrever_json(saida, {"ok": False, "erro": "Ação inválida."}, 400)
        return
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
        return
    identificador = parametro_consulta(saida.path, "id")
    if not identificador:
        corpo = ler_corpo(saida)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            dados = {}
        if isinstance(dados, dict):
            identificador = dados.get("id")
    registro, erro = excluir_funcionario_equipe(identificador)
    if erro:
        escrever_json(saida, {"ok": False, "erro": erro}, 400)
        return
    escrever_json(saida, {"ok": True, "funcionario": registro})


def responder_login(saida):
    corpo = ler_corpo(saida)
    if not acesso_configurado():
        escrever_json(saida, {"ok": False, "erro": "Área Restrita indisponível: ADMIN_PASSWORD e SEGREDO_SESSAO não configurados no servidor."}, 503)
        return
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 400)
        return
    try:
        dados = json.loads(corpo.decode("utf-8")) if corpo else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 400)
        return
    if not isinstance(dados, dict) or not senha_confere(dados.get("senha")):
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 403)
        return
    operador = funcionario_permitido(dados.get("funcionario") or dados.get("operador") or EQUIPE_ADMIN)
    if not operador:
        escrever_json(saida, {"ok": False, "erro": "Selecione quem está acessando."}, 400)
        return
    agente = saida.headers.get("User-Agent") or ""
    try:
        gravar_log_equipe(operador, "Acessou a Área Restrita", dispositivo_equipe(dados.get("dispositivo"), agente))
    except Exception as erro:
        print("equipe: falha ao registrar acesso (%s)" % erro, file=sys.stderr, flush=True)
    escrever_json(
        saida,
        {"ok": True, "funcionario": operador},
        extra=[("Set-Cookie", cabecalho_cookie(emitir_token()))],
    )


def responder_logout(saida):
    ler_corpo(saida)
    escrever_json(saida, {"ok": True}, extra=[("Set-Cookie", cabecalho_logout())])


def slug_cliente(nome):
    texto = unicodedata.normalize("NFKD", str(nome or ""))
    texto = "".join(caractere for caractere in texto if not unicodedata.combining(caractere))
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return (texto or "cliente")[:40]


def id_pdf_valido(ident):
    return bool(re.fullmatch(r"[a-z0-9-]{1,80}", ident or ""))


def parametro_consulta(caminho, chave):
    """Lê ?chave= da URL. Na Vercel o query às vezes vem só em QUERY_STRING.

    Quando o rewrite define ?acao=..., o path perde os params originais
    (ex.: simularAtraso); mesclamos com QUERY_STRING do ambiente.
    """
    valores = {}
    consulta_path = urlparse(caminho or "").query
    if consulta_path:
        valores.update(parse_qs(consulta_path))
    consulta_env = os.environ.get("QUERY_STRING") or ""
    if consulta_env and consulta_env != consulta_path:
        for k, v in parse_qs(consulta_env).items():
            if k not in valores:
                valores[k] = v
    return (valores.get(chave) or [""])[0]


def host_publico(saida):
    bruto = saida.headers.get("X-Forwarded-Host") or saida.headers.get("Host") or "127.0.0.1:8765"
    host = bruto.split(",")[0].strip()
    if not re.fullmatch(r"[A-Za-z0-9.:-]+", host):
        return "127.0.0.1:8765"
    return host


def url_publica(saida, caminho):
    proto = (saida.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    if proto not in ("http", "https"):
        proto = "https" if em_vercel() else "http"
    return proto + "://" + host_publico(saida) + caminho


def ler_campos_formulario(content_type, corpo):
    match = re.search(r"boundary=([^;]+)", content_type or "", re.I)
    if not match:
        return {}, {}
    limite = match.group(1).strip().strip('"').encode("utf-8", "ignore")
    campos = {}
    arquivos = {}
    for pedaco in (corpo or b"").split(b"--" + limite):
        if pedaco.startswith(b"\r\n"):
            pedaco = pedaco[2:]
        if pedaco.endswith(b"\r\n"):
            pedaco = pedaco[:-2]
        if pedaco.endswith(b"--"):
            pedaco = pedaco[:-2]
            if pedaco.endswith(b"\r\n"):
                pedaco = pedaco[:-2]
        if not pedaco:
            continue
        cabecalho, separador, dados = pedaco.partition(b"\r\n\r\n")
        if not separador:
            continue
        texto = cabecalho.decode("utf-8", "replace")
        achado = re.search(r'name="([^"]+)"', texto)
        if not achado:
            continue
        if "filename=" in texto:
            arquivos[achado.group(1)] = dados
        else:
            campos[achado.group(1)] = dados.decode("utf-8", "replace").strip()
    return campos, arquivos


def novo_id_pdf(nome):
    base = slug_cliente(nome) + "-" + str(int(time.time()))
    ident = base
    pasta = diretorio_pdf()
    numero = 0
    while (pasta / (ident + ".pdf")).exists() or ident in PDFS:
        numero += 1
        ident = base + "-" + str(numero)
        if numero > 20:
            ident = base + "-" + secrets.token_hex(2)
            break
    return ident


def limpar_pdfs_antigos(pasta):
    limite = time.time() - VALIDADE_PDF
    try:
        arquivos = list(pasta.glob("*.pdf"))
    except OSError:
        return
    for arquivo in arquivos:
        try:
            if arquivo.stat().st_mtime < limite:
                arquivo.unlink()
        except OSError:
            continue
    with PDF_LOCK:
        for ident, item in list(PDFS.items()):
            if item[1] < limite:
                PDFS.pop(ident, None)


def token_blob():
    return (os.environ.get("BLOB_READ_WRITE_TOKEN") or "").strip()


def loja_blob(token):
    partes = (token or "").split("_")
    if len(partes) < 4 or not partes[3]:
        return ""
    return partes[3]


def enviar_pdf_blob(ident, conteudo):
    token = token_blob()
    loja = loja_blob(token)
    if not token or not loja:
        return False
    caminho = "orcamentos/" + ident + ".pdf"
    pedido = urllib.request.Request(
        "https://vercel.com/api/blob/?pathname=" + urllib.request.quote(caminho),
        data=conteudo,
        method="PUT",
        headers={
            "authorization": "Bearer " + token,
            "x-api-version": "12",
            "x-vercel-blob-store-id": loja,
            "x-content-type": "application/pdf",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
            "x-vercel-blob-access": "private",
        },
    )
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            return 200 <= resposta.status < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def baixar_pdf_blob(ident):
    token = token_blob()
    loja = loja_blob(token)
    if not token or not loja or not id_pdf_valido(ident):
        return None
    endereco = "https://%s.private.blob.vercel-storage.com/orcamentos/%s.pdf" % (loja, ident)
    pedido = urllib.request.Request(endereco, headers={"authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            conteudo = resposta.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if not conteudo or not conteudo.startswith(b"%PDF"):
        return None
    return conteudo


def _pdf_literal(texto):
    dados = str(texto or "").encode("cp1252", "replace")
    saida = bytearray()
    for byte in dados:
        if byte in (40, 41, 92):
            saida.extend(b"\\" + bytes((byte,)))
        elif 32 <= byte <= 126:
            saida.append(byte)
        else:
            saida.extend(("\\%03o" % byte).encode("ascii"))
    return b"(" + bytes(saida) + b")"


_RE_PREFIXO_VOZ = re.compile(r"^voz-[a-z0-9]+-\d+\s*-\s*", re.IGNORECASE)
_RE_PREFIXO_QTD = re.compile(r"^\d+\s*-\s*")


def limpar_nome_intencao(texto):
    """Nome da coluna 3: só a descrição falada, sem id voz- nem quantidade."""
    nome = str(texto or "").strip()
    nome = _RE_PREFIXO_VOZ.sub("", nome)
    nome = _RE_PREFIXO_QTD.sub("", nome)
    return nome.strip()[:160]


def itens_pdf_intencoes(corpo, linhas):
    brutos = corpo.get("itens") if isinstance(corpo, dict) and isinstance(corpo.get("itens"), list) else []
    saida = []
    for item in brutos:
        if not isinstance(item, dict):
            continue
        nome = limpar_nome_intencao(item.get("produto") or item.get("rotulo") or item.get("texto") or "")
        try:
            qtd = int(item.get("qtd") or 1)
        except (TypeError, ValueError):
            qtd = 1
        if qtd < 1:
            qtd = 1
        if qtd > 99999:
            qtd = 99999
        if nome:
            saida.append({"codigo": "", "produto": nome, "qtd": qtd, "preco": 0})
    if saida:
        return saida[:200]
    for linha in linhas or []:
        nome = limpar_nome_intencao(linha)
        if nome:
            saida.append({"codigo": "", "produto": nome, "qtd": 1, "preco": 0})
    return saida[:200]


def _celula_pdf(x, y, texto, tamanho=9):
    return b"BT /F1 %d Tf 1 0 0 1 %.2f %.2f Tm %s Tj ET" % (
        tamanho,
        float(x),
        float(y),
        _pdf_literal(texto),
    )


def pdf_intencoes(nome, telefone, itens):
    """Tabela do PDF de intenções: Código vazio e Nome só com a descrição falada."""
    cabecalho = [
        (40, "Lista de Produtos Solicitados", 12),
        (40, "Cliente: " + (str(nome or "").strip() or "-"), 10),
        (40, "Contato: " + (str(telefone or "").strip() or "-"), 10),
    ]
    colunas = [
        (40, "Itens"),
        (78, "Código"),
        (150, "Nome"),
        (400, "Qte"),
        (445, "Pr.Unitário"),
        (520, "Total"),
    ]
    registros = itens if isinstance(itens, list) else []
    if not registros:
        registros = [{"codigo": "", "produto": "Sem itens.", "qtd": 1, "preco": 0}]
    salto = 16
    capacidade = 28
    fatias = [registros[indice:indice + capacidade] for indice in range(0, len(registros), capacidade)]
    fluxos = []
    for numero, fatia in enumerate(fatias):
        comandos = []
        y = 800
        if numero == 0:
            for x, texto, tamanho in cabecalho:
                comandos.append(_celula_pdf(x, y, texto, tamanho))
                y -= salto
            y -= 6
        for x, titulo in colunas:
            comandos.append(_celula_pdf(x, y, titulo, 9))
        y -= salto
        for ordem, item in enumerate(fatia, start=1 + numero * capacidade):
            nome = limpar_nome_intencao(item.get("produto") if isinstance(item, dict) else item)
            qtd = 1
            if isinstance(item, dict):
                try:
                    qtd = int(item.get("qtd") or 1)
                except (TypeError, ValueError):
                    qtd = 1
            if qtd < 1:
                qtd = 1
            comandos.append(_celula_pdf(40, y, str(ordem), 9))
            comandos.append(_celula_pdf(78, y, "", 9))
            comandos.append(_celula_pdf(150, y, nome or "", 9))
            comandos.append(_celula_pdf(400, y, str(qtd), 9))
            comandos.append(_celula_pdf(445, y, "0,00", 9))
            comandos.append(_celula_pdf(520, y, "0,00", 9))
            y -= salto
        fluxos.append(b"\n".join(comandos))
    total = 3 + len(fluxos) * 2
    objetos = [b""] * total
    kids = []
    for indice, fluxo in enumerate(fluxos):
        numero_pagina = 4 + indice * 2
        numero_fluxo = numero_pagina + 1
        kids.append("%d 0 R" % numero_pagina)
        objetos[numero_pagina - 1] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            % numero_fluxo
        ).encode("ascii")
        objetos[numero_fluxo - 1] = (b"<< /Length %d >>\nstream\n" % len(fluxo)) + fluxo + b"\nendstream"
    objetos[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objetos[1] = ("<< /Type /Pages /Count %d /Kids [%s] >>" % (len(fluxos), " ".join(kids))).encode("ascii")
    objetos[2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    partes = [b"%PDF-1.4\n"]
    offsets = [0]
    for indice, objeto in enumerate(objetos, start=1):
        offsets.append(sum(len(parte) for parte in partes))
        partes.append(("%d 0 obj\n" % indice).encode("ascii") + objeto + b"\nendobj\n")
    xref = sum(len(parte) for parte in partes)
    partes.append(("xref\n0 %d\n" % (total + 1)).encode("ascii"))
    partes.append(b"0000000000 65535 f \n")
    for deslocamento in offsets[1:]:
        partes.append(("%010d 00000 n \n" % deslocamento).encode("ascii"))
    partes.append(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (total + 1, xref)).encode("ascii"))
    return b"".join(partes)


def guardar_pdf(nome, conteudo):
    if not conteudo or not conteudo.startswith(b"%PDF") or len(conteudo) > LIMITE_PDF:
        raise ValueError("pdf")
    pasta = diretorio_pdf()
    pasta.mkdir(parents=True, exist_ok=True)
    ident = novo_id_pdf(nome)
    destino = pasta / (ident + ".pdf")
    temporario = pasta / (ident + ".part")
    temporario.write_bytes(conteudo)
    temporario.replace(destino)
    with PDF_LOCK:
        PDFS[ident] = (conteudo, time.time())
    if token_blob():
        if not enviar_pdf_blob(ident, conteudo):
            raise OSError("blob")
    elif em_vercel():
        raise OSError("blob")
    limpar_pdfs_antigos(pasta)
    return ident


def ler_pdf_guardado(ident):
    if not id_pdf_valido(ident):
        return None
    agora = time.time()
    with PDF_LOCK:
        item = PDFS.get(ident)
    if item and agora - item[1] <= VALIDADE_PDF:
        return item[0]
    arquivo = diretorio_pdf() / (ident + ".pdf")
    if arquivo.is_file():
        try:
            if agora - arquivo.stat().st_mtime > VALIDADE_PDF:
                arquivo.unlink()
            else:
                conteudo = arquivo.read_bytes()
                if conteudo.startswith(b"%PDF"):
                    with PDF_LOCK:
                        PDFS[ident] = (conteudo, agora)
                    return conteudo
        except OSError:
            pass
    return baixar_pdf_blob(ident)


def apenas_digitos(valor):
    return re.sub(r"\D", "", valor or "")


def cpf_valido(cpf):
    if not re.fullmatch(r"\d{11}", cpf) or cpf == cpf[0] * 11:
        return False

    def digito(base):
        tamanho = len(base)
        soma = sum(int(base[i]) * (tamanho + 1 - i) for i in range(tamanho))
        resto = soma % 11
        return 0 if resto < 2 else 11 - resto

    return digito(cpf[:9]) == int(cpf[9]) and digito(cpf[:10]) == int(cpf[10])


def cnpj_valido(cnpj):
    if not re.fullmatch(r"\d{14}", cnpj) or cnpj == cnpj[0] * 14:
        return False

    def digito(base, pesos):
        soma = sum(int(base[i]) * pesos[i] for i in range(len(pesos)))
        resto = soma % 11
        return 0 if resto < 2 else 11 - resto

    primeiro = digito(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    segundo = digito(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return primeiro == int(cnpj[12]) and segundo == int(cnpj[13])


def email_valido(email):
    return re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", (email or "").strip()) is not None


def cliente_orcamento_valido(campos):
    tipo = (campos.get("tipo") or "").strip().lower()
    documento = apenas_digitos(campos.get("documento") or "")
    if tipo == "pj":
        documento_ok = cnpj_valido(documento)
    elif tipo == "pf":
        documento_ok = cpf_valido(documento)
    else:
        documento_ok = False
    cep_ok = len(apenas_digitos(campos.get("cep") or "")) == 8
    return documento_ok and email_valido(campos.get("email") or "") and cep_ok


def agora_painel():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Sao_Paulo"))
    except Exception:
        return datetime.now()


def hoje_painel():
    return agora_painel().strftime("%Y-%m-%d")


def formatar_telefone(digitos):
    if len(digitos) == 10:
        return "(%s) %s-%s" % (digitos[:2], digitos[2:6], digitos[6:])
    if len(digitos) == 11:
        return "(%s) %s-%s" % (digitos[:2], digitos[2:7], digitos[7:])
    return ""


def telefone_painel_valido(digitos):
    if len(digitos) not in (10, 11):
        return False
    ddd = int(digitos[:2])
    return 11 <= ddd <= 99


def normalizar_itens_painel(brutos):
    if not isinstance(brutos, list) or not brutos or len(brutos) > 200:
        return None
    itens = []
    for item in brutos:
        if not isinstance(item, dict):
            return None
        produto = str(item.get("produto") or "").strip()[:160]
        codigo = str(item.get("codigo") or "").strip()[:40]
        try:
            qtd = int(item.get("qtd"))
            preco = round(float(item.get("preco")), 2)
        except (TypeError, ValueError):
            return None
        if not produto or qtd < 1 or qtd > 99999 or preco < 0 or preco > 10000000:
            return None
        itens.append({
            "codigo": codigo,
            "produto": produto,
            "qtd": qtd,
            "preco": preco,
            "valor": round(preco * qtd, 2),
        })
    return itens


def baixar_blob(caminho, consistente=False):
    token = token_blob()
    loja = loja_blob(token)
    if not token or not loja:
        return None
    endereco = "https://%s.private.blob.vercel-storage.com/%s" % (loja, caminho)
    if consistente:
        endereco += "?cache=0"
    pedido = urllib.request.Request(endereco, headers={"authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            return resposta.read()
    except urllib.error.HTTPError as erro:
        if erro.code == 404:
            return b""
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def enviar_json_blob(caminho, conteudo):
    token = token_blob()
    loja = loja_blob(token)
    if not token or not loja:
        return False
    pedido = urllib.request.Request(
        "https://vercel.com/api/blob/?pathname=" + urllib.request.quote(caminho),
        data=conteudo,
        method="PUT",
        headers={
            "authorization": "Bearer " + token,
            "x-api-version": "12",
            "x-vercel-blob-store-id": loja,
            "x-content-type": "application/json",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
            "x-cache-control-max-age": "60",
            "x-vercel-blob-access": "private",
        },
    )
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            return 200 <= resposta.status < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def interpretar_painel(conteudo):
    if not conteudo:
        return []
    try:
        dados = json.loads(conteudo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return []
    if not isinstance(dados, list):
        return []
    return [item for item in dados if isinstance(item, dict) and item.get("id")]


def ler_painel_arquivo():
    arquivo = caminho_painel()
    if not arquivo.is_file():
        return []
    try:
        return interpretar_painel(arquivo.read_bytes())
    except OSError:
        return []


def gravar_painel_arquivo(lista):
    destino = caminho_painel()
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(lista, ensure_ascii=False), encoding="utf-8")
    os.replace(temporario, destino)


def ler_painel():
    if token_blob():
        conteudo = baixar_blob(PAINEL_BLOB, consistente=True)
        if conteudo is None:
            raise OSError("blob")
        return interpretar_painel(conteudo)
    if em_vercel():
        raise OSError("blob")
    return ler_painel_arquivo()


def gravar_painel(lista):
    conteudo = json.dumps(lista, ensure_ascii=False).encode("utf-8")
    if token_blob():
        if not enviar_json_blob(PAINEL_BLOB, conteudo):
            raise OSError("blob")
        return
    if em_vercel():
        raise OSError("blob")
    gravar_painel_arquivo(lista)


def normalizar_data_painel(valor):
    texto = str(valor or "").strip()
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", texto)
    if iso:
        return "%s-%s-%s" % (iso.group(1), iso.group(2), iso.group(3))
    br = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", texto)
    if br:
        return "%s-%s-%s" % (br.group(3), br.group(2), br.group(1))
    return ""


def marcado_excluido(item):
    """True para excluido true/1/"true"/"1" (lixeira); não trata string "false" como excluído."""
    if not isinstance(item, dict):
        return False
    valor = item.get("excluido")
    if valor is True:
        return True
    if valor is False or valor is None:
        return False
    if isinstance(valor, (int, float)):
        return valor != 0
    texto = str(valor).strip().casefold()
    return texto in ("1", "true", "sim", "yes")


def status_atendimento_padrao():
    """Primeiro status ativo do filtro da Área Restrita."""
    return STATUS_ATENDIMENTO_RECEBIDO


def normalizar_status_atendimento(valor):
    """Mapeia status legados/vazios para o canônico da Área Restrita."""
    texto = str(valor or "").strip()
    if texto == STATUS_ENVIO_RASCUNHO:
        return STATUS_ENVIO_RASCUNHO
    if texto in ("Analisado", "Respondido"):
        return texto
    # Vazio, None, Pendente, Enviado, Em aberto, Novo, Recebido → Recebido.
    return STATUS_ATENDIMENTO_RECEBIDO


def status_envio_de(item):
    """Ciclo multi-dispositivo: A Enviar (rascunho puro) vs concluído (Recebido e legados)."""
    if not isinstance(item, dict):
        return STATUS_ENVIO_FINAL
    texto = str(item.get("status") or "").strip()
    if texto == STATUS_ENVIO_RASCUNHO:
        meio = str(item.get("meio_envio") or "").strip()
        pdf_id = str(item.get("pdfId") or "").strip().lower()
        # Já houve PDF oficial ou canal final: não é rascunho (corrige rebaixamento legado).
        if meio in MEIOS_ENVIO or id_pdf_valido(pdf_id):
            return STATUS_ENVIO_FINAL
        return STATUS_ENVIO_RASCUNHO
    return STATUS_ENVIO_FINAL


def orcamento_visivel_admin(item):
    """Rascunhos A Enviar (sem envio/PDF) ficam fora da listagem ativa. Lixeira à parte."""
    return status_envio_de(item) != STATUS_ENVIO_RASCUNHO


def tipo_orcamento_de(corpo, itens=None):
    bruto = ""
    if isinstance(corpo, dict):
        bruto = str(corpo.get("tipoOrcamento") or corpo.get("tipo_orcamento") or "").strip()
    if bruto in TIPOS_ORCAMENTO:
        return bruto
    if pedido_por_voz(corpo if isinstance(corpo, dict) else {}):
        return "Comando de Voz"
    lista = itens if isinstance(itens, list) else (corpo.get("itens") if isinstance(corpo, dict) else None)
    if isinstance(lista, list) and lista:
        voz = sum(1 for item in lista if isinstance(item, dict) and item_de_voz(item))
        if voz * 2 > len(lista):
            return "Comando de Voz"
    return "Tradicional"


def preparar_orcamento_resposta(item, lixeira=False):
    """Normaliza status ativo para o padrão Recebido sem perder Analisado/Respondido."""
    if not isinstance(item, dict):
        return item
    copia = dict(item)
    if lixeira or marcado_excluido(copia):
        return copia
    if status_envio_de(copia) == STATUS_ENVIO_RASCUNHO:
        return copia
    status_campo = str(copia.get("status") or "").strip()
    if status_campo == STATUS_ENVIO_RASCUNHO:
        # Legado rebaixado com PDF/canal: expõe como Recebido na Área Restrita.
        copia["status"] = status_atendimento_padrao()
    else:
        copia["status"] = normalizar_status_atendimento(status_campo)
    return copia


def filtrar_painel(lista, documento, inicio="", fim="", lixeira=False, somente_enviados=False):
    """lixeira=False devolve só os ativos; lixeira=True, só os excluídos (com Restaurar).

    Com documento informado: igualdade estrita dos dígitos do CPF/CNPJ.
    PROIBIDO ampliar a busca por telefone, e-mail ou qualquer OR de contato.
    """
    documento = apenas_digitos(documento)
    bruto_inicio = str(inicio or "").strip()
    bruto_fim = str(fim or "").strip()
    inicio = normalizar_data_painel(bruto_inicio) if bruto_inicio else ""
    fim = normalizar_data_painel(bruto_fim) if bruto_fim else ""
    if (bruto_inicio and not inicio) or (bruto_fim and not fim) or (inicio and fim and inicio > fim):
        return []
    saida = []
    for item in lista:
        if not isinstance(item, dict) or not str(item.get("id") or "").strip():
            continue
        if marcado_excluido(item) != bool(lixeira):
            continue
        if lixeira:
            # Lixeira: todos os excluídos (Recebido/Enviado/Pendente/Analisado/Respondido).
            # Só ignora rascunho A Enviar puro sem itens.
            if str(item.get("status") or "").strip() == STATUS_ENVIO_RASCUNHO and status_envio_de(item) == STATUS_ENVIO_RASCUNHO:
                itens = item.get("itens") if isinstance(item.get("itens"), list) else []
                if not itens:
                    continue
        elif somente_enviados and not orcamento_visivel_admin(item):
            continue
        dia = normalizar_data_painel(item.get("data"))
        if inicio and (not dia or dia < inicio):
            continue
        if fim and (not dia or dia > fim):
            continue
        if documento:
            doc_registro = documento_do_orcamento(item)
            # Igualdade estrita de dígitos; rejeita vazio/nulo/diferente — sem fallback de contato.
            if not doc_registro or len(doc_registro) not in (11, 14) or doc_registro != documento:
                continue
        saida.append(preparar_orcamento_resposta(item, lixeira=lixeira))
    saida.sort(key=lambda atual: (str(atual.get("data") or ""), str(atual.get("id") or "")), reverse=True)
    return saida


def id_painel_valido(valor):
    return bool(re.fullmatch(r"[0-9]{8}-[0-9a-fA-F]{8}", str(valor or "")))


def documento_consulta_valido(documento):
    documento = apenas_digitos(documento)
    if cpf_valido(documento) or cnpj_valido(documento):
        return documento
    return ""


def documento_do_orcamento(item):
    """CPF/CNPJ canônico do registro (só dígitos 11/14). Nunca usa telefone/e-mail/nome.

    Vazio, nulo, tamanho inválido ou divergência topo×cliente → "".
    """
    if not isinstance(item, dict):
        return ""
    topo = apenas_digitos(str(
        item.get("documento")
        or item.get("cpfCnpj")
        or item.get("cpf_cnpj")
        or item.get("cpf")
        or ""
    ))
    cliente = item.get("cliente") if isinstance(item.get("cliente"), dict) else {}
    aninhado = apenas_digitos(str(
        cliente.get("documento")
        or cliente.get("cpfCnpj")
        or cliente.get("cpf_cnpj")
        or cliente.get("cpf")
        or ""
    ))
    if topo and aninhado and topo != aninhado:
        return ""
    doc = topo or aninhado
    if len(doc) not in (11, 14):
        return ""
    if not (cpf_valido(doc) or cnpj_valido(doc)):
        return ""
    return doc


def orcamentos_do_documento(lista, documento):
    """Isolamento estrito: só orçamentos cujo CPF/CNPJ bate exatamente com o pesquisado."""
    documento = documento_consulta_valido(documento)
    if not documento or len(documento) not in (11, 14):
        return []
    return [
        item for item in (lista or [])
        if isinstance(item, dict) and documento_do_orcamento(item) == documento
    ]


def mascarar_telefone(valor):
    digitos = apenas_digitos(str(valor or ""))
    if len(digitos) in (12, 13) and digitos.startswith("55"):
        digitos = digitos[2:]
    if len(digitos) not in (10, 11):
        return ""
    numero = digitos[2:]
    return "(%s) %s%s-%s" % (digitos[:2], numero[0], "*" * (len(numero) - 5), numero[-4:])


def mascarar_email(valor):
    local, arroba, dominio = str(valor or "").strip().lower().rpartition("@")
    if not arroba or not local or "." not in dominio:
        return ""
    return (local[:2] if len(local) > 2 else local[:1]) + "***@" + dominio


def dados_identidade(registros, documento=""):
    """Telefone e e-mail mascarados só de orçamentos do CPF/CNPJ informado (já filtrados)."""
    documento = apenas_digitos(documento)
    telefone = email = ""
    for registro in registros:
        if documento and documento_do_orcamento(registro) != documento:
            continue
        cliente = registro.get("cliente") if isinstance(registro.get("cliente"), dict) else {}
        if not telefone:
            telefone = mascarar_telefone(registro.get("telefone") or cliente.get("celular"))
        if not email:
            email = mascarar_email(cliente.get("email") or registro.get("email"))
        if telefone and email:
            break
    return {"telefone": telefone, "email": email}


def opcao_falsa(real, campo, sorteio):
    if campo == "telefone":
        return real[:-4] + "%04d" % sorteio.randrange(10000)
    visivel, _, dominio = real.partition("***@")
    return sorteio.choice(KBA_PREFIXOS_EMAIL)[:len(visivel)] + "***@" + dominio


def opcoes_identidade(documento, campo, real):
    """As opções falsas saem de um HMAC do CPF/CNPJ: repetir a busca devolve sempre as mesmas, então
    comparar duas consultas não revela qual é a verdadeira."""
    semente = hmac.new(segredo_sessao(), ("kba|%s|%s" % (campo, documento)).encode("utf-8"), hashlib.sha256).digest()
    sorteio = random.Random(semente)
    opcoes = [real]
    for _ in range(200):
        if len(opcoes) >= KBA_OPCOES:
            break
        falsa = opcao_falsa(real, campo, sorteio)
        if falsa not in opcoes:
            opcoes.append(falsa)
    sorteio.shuffle(opcoes)
    return opcoes


def chave_identidade(documento):
    # Só o hash do CPF/CNPJ vai para o Redis.
    return "kba:{giga}:" + hashlib.sha256(("kba:" + documento).encode("utf-8")).hexdigest()[:32]


def contador_identidade(documento, incrementar=False):
    """(tentativas sem acerto, segundos até o contador zerar). Cada INCR renova o prazo de KBA_BLOQUEIO,
    então atingir KBA_TENTATIVAS bloqueia o CPF/CNPJ por esse prazo a partir da última tentativa."""
    if endereco_redis():
        chave = chave_identidade(documento)
        try:
            if incrementar:
                total, _, prazo = redis_pipeline([["INCR", chave], ["EXPIRE", chave, KBA_BLOQUEIO], ["TTL", chave]])
            else:
                total, prazo = redis_pipeline([["GET", chave], ["TTL", chave]])
            return int(total or 0), max(0, int(prazo or 0))
        except Exception as erro:
            print("identidade: Redis indisponível, trava na memória (%s)" % erro, file=sys.stderr, flush=True)
    agora = time.time()
    with KBA_LOCK:
        estado = KBA_ERROS.get(documento)
        if estado and estado["expira"] <= agora:
            KBA_ERROS.pop(documento, None)
            estado = None
        if incrementar:
            estado = {"total": (estado["total"] if estado else 0) + 1, "expira": agora + KBA_BLOQUEIO}
            KBA_ERROS[documento] = estado
        if not estado:
            return 0, 0
        return estado["total"], max(0, int(estado["expira"] - agora))


def zerar_identidade(documento):
    with KBA_LOCK:
        KBA_ERROS.pop(documento, None)
    if endereco_redis():
        try:
            redis_pipeline([["DEL", chave_identidade(documento)]])
        except Exception as erro:
            print("identidade: Redis indisponível ao zerar (%s)" % erro, file=sys.stderr, flush=True)


def bloqueio_identidade(documento):
    """Segundos restantes de bloqueio do CPF/CNPJ depois de KBA_TENTATIVAS erros seguidos."""
    total, prazo = contador_identidade(documento)
    return prazo if total >= KBA_TENTATIVAS else 0


def aviso_bloqueio_identidade(segundos):
    minutos = max(1, (segundos + 59) // 60)
    return "Muitas tentativas incorretas para este CPF/CNPJ. Tente novamente em %d minuto%s." % (minutos, "" if minutos == 1 else "s")


def cliente_do_painel(corpo, nome, documento, telefone):
    bruto = corpo.get("cliente") if isinstance(corpo.get("cliente"), dict) else {}
    tipo = str(bruto.get("tipo") or corpo.get("tipo") or "").strip().lower()
    if tipo not in ("pf", "pj"):
        tipo = "pj" if len(documento) == 14 else "pf"

    def campo(chave, limite):
        return str(bruto.get(chave) or "").strip()[:limite]

    uf = campo("uf", 2).upper()
    if not re.fullmatch(r"[A-Z]{2}", uf):
        uf = ""
    return {
        "tipo": tipo,
        "nome": nome,
        "documento": documento,
        "celular": formatar_telefone(telefone),
        "email": campo("email", 120),
        "endereco": campo("endereco", 160),
        "numero": campo("numero", 20),
        "bairro": campo("bairro", 80),
        "cidade": campo("cidade", 80),
        "uf": uf,
        "cep": campo("cep", 16),
    }


def excluir_orcamento_painel(identificador, documento="", quem="gestor"):
    """Exclusão lógica: o registro vai para a lixeira com cliente e itens intactos e pode ser restaurado."""
    identificador = str(identificador or "")
    documento = apenas_digitos(documento)
    if not id_painel_valido(identificador):
        return False
    with PAINEL_LOCK:
        lista = ler_painel()
        alvo = next((item for item in lista if str(item.get("id") or "") == identificador), None)
        if alvo is None:
            return None
        if documento and documento_do_orcamento(alvo) != documento:
            return None
        if not alvo.get("excluido"):
            alvo["excluido"] = True
            alvo["excluidoEm"] = agora_painel().isoformat(timespec="seconds")
            alvo["excluidoPor"] = quem
            gravar_painel(lista)
    return True


def restaurar_orcamento_painel(identificador):
    identificador = str(identificador or "")
    if not id_painel_valido(identificador):
        return False
    with PAINEL_LOCK:
        lista = ler_painel()
        alvo = next((item for item in lista if str(item.get("id") or "") == identificador), None)
        if alvo is None:
            return None
        if marcado_excluido(alvo):
            for campo in ("excluido", "excluidoEm", "excluidoPor"):
                alvo.pop(campo, None)
            gravar_painel(lista)
    return True


def remover_orcamento_painel(identificador):
    """Remoção definitiva, só para desfazer um registro que nunca chegou ao cliente (e-mail recusado)."""
    identificador = str(identificador or "")
    with PAINEL_LOCK:
        lista = ler_painel()
        restante = [item for item in lista if str(item.get("id") or "") != identificador]
        if len(restante) != len(lista):
            gravar_painel(restante)


def devolver_orcamento_painel(original):
    identificador = str(original.get("id") or "")
    with PAINEL_LOCK:
        lista = ler_painel()
        gravar_painel([original if str(item.get("id") or "") == identificador else item for item in lista])


def status_atendimento(valor):
    """Status interno da Área Restrita. Recebido unifica Enviado/Pendente/vazios."""
    texto = str(valor or "").strip()
    if texto == STATUS_ENVIO_RASCUNHO:
        return ""
    if texto in ("Analisado", "Respondido"):
        return texto
    if texto in (
        STATUS_ATENDIMENTO_RECEBIDO,
        STATUS_ENVIO_FINAL,
        "Pendente",
        "Em aberto",
        "Novo",
        "",
    ):
        return STATUS_ATENDIMENTO_RECEBIDO
    # Qualquer outro status ativo desconhecido cai no padrão Recebido.
    if texto:
        return STATUS_ATENDIMENTO_RECEBIDO
    return ""


def vendedor_atendimento(valor):
    texto = str(valor or "").strip()
    if texto in ("Bruno", "Summer", "Júlio", "Aceliani"):
        return texto
    return ""


def atualizar_atendimento_painel(identificador, status=None, vendedor=None):
    identificador = str(identificador or "")
    if not id_painel_valido(identificador):
        return False
    if status is not None:
        status = status_atendimento(status)
        if not status:
            return False
    if vendedor is not None:
        bruto = str(vendedor or "").strip()
        vendedor = "" if not bruto else vendedor_atendimento(bruto)
        if bruto and not vendedor:
            return False
    if status is None and vendedor is None:
        return False
    with PAINEL_LOCK:
        lista = ler_painel()
        alvo = next((item for item in lista if str(item.get("id") or "") == identificador), None)
        if alvo is None:
            return None
        if status is not None:
            alvo["status"] = status
        if vendedor is not None:
            alvo["vendedor"] = vendedor
        gravar_painel(lista)
    return True


def linhas_intencoes(corpo):
    linhas = []
    textos = corpo.get("textos") if isinstance(corpo, dict) else None
    if isinstance(textos, list):
        for item in textos:
            texto = str(item or "").strip()[:160]
            if texto:
                linhas.append(texto)
    if linhas:
        return linhas[:200]
    itens = corpo.get("itens") if isinstance(corpo, dict) else None
    if isinstance(itens, list):
        for item in itens:
            if isinstance(item, dict):
                texto = str(item.get("produto") or item.get("rotulo") or item.get("texto") or "").strip()[:160]
            else:
                texto = str(item or "").strip()[:160]
            if texto:
                linhas.append(texto)
    return linhas[:200]


def registrar_intencoes(corpo):
    """Confirmação da lista de voz: grava/atualiza rascunho A Enviar (não aparece no admin)."""
    if not isinstance(corpo, dict):
        return None
    linhas = linhas_intencoes(corpo)
    pedido = dict(corpo)
    pedido["tipo"] = "intencoes"
    pedido["tipoOrcamento"] = "Comando de Voz"
    pedido["itens"] = itens_pdf_intencoes(corpo, linhas)
    if not normalizar_itens_painel(pedido["itens"]):
        return None
    documento = apenas_digitos(pedido.get("documento") or "")
    if not (cpf_valido(documento) or cnpj_valido(documento)):
        return None
    nome = str(pedido.get("nome") or "").strip()[:120]
    telefone = apenas_digitos(pedido.get("telefone") or "")
    try:
        if nome and telefone_painel_valido(telefone):
            pedido["pdfId"] = guardar_pdf(nome, pdf_intencoes(nome, formatar_telefone(telefone), pedido["itens"]))
    except (ValueError, OSError):
        pedido["pdfId"] = str(pedido.get("pdfId") or "")
    registro = upsert_rascunho_painel(pedido)
    if not registro:
        return None
    if pedido.get("pdfId") and not registro.get("pdfId"):
        registro["pdfId"] = pedido["pdfId"]
    return registro


def pedido_painel_valido(corpo):
    if not isinstance(corpo, dict) or not str(corpo.get("nome") or "").strip():
        return False
    documento = apenas_digitos(corpo.get("documento") or "")
    return (
        (cpf_valido(documento) or cnpj_valido(documento))
        and telefone_painel_valido(apenas_digitos(corpo.get("telefone") or ""))
        and bool(normalizar_itens_painel(corpo.get("itens")))
    )


def motivo_pedido_invalido(corpo):
    """Só o nome do campo recusado: o log não guarda dados do cliente."""
    if not isinstance(corpo, dict):
        return "formato"
    documento = apenas_digitos(corpo.get("documento") or "")
    if not str(corpo.get("nome") or "").strip():
        return "nome"
    if not (cpf_valido(documento) or cnpj_valido(documento)):
        return "documento"
    if not telefone_painel_valido(apenas_digitos(corpo.get("telefone") or "")):
        return "telefone"
    return "itens"


def meio_envio_da_rota(rota, corpo=None):
    """A rota define o canal; o meio_envio do navegador só é conferido, para o painel nunca ficar em branco."""
    informado = str(corpo.get("meio_envio") or "").strip() if isinstance(corpo, dict) else ""
    if informado and informado != rota:
        print("painel: meio_envio %r difere da rota; gravado %r" % (informado[:20], rota), file=sys.stderr, flush=True)
    return rota


def assinatura_itens(itens):
    """Itens comparáveis entre a lista de voz e o envio: o código voz- e a ordem mudam ao passar pelo quadro."""
    return sorted(
        (" ".join(limpar_nome_intencao(item.get("produto")).casefold().split()), int(item.get("qtd") or 1), round(float(item.get("preco") or 0), 2))
        for item in itens
        if isinstance(item, dict)
    )


def segundos_desde(data, agora):
    try:
        return (agora - datetime.fromisoformat(str(data))).total_seconds()
    except (TypeError, ValueError):
        return None


def achar_orcamento_por_id(lista, documento, identificador):
    """Localiza registro ativo pelo id (rascunho ou já enviado), no mesmo CPF/CNPJ."""
    documento = apenas_digitos(documento)
    identificador = str(identificador or "")
    if not id_painel_valido(identificador):
        return None
    for item in lista:
        if not isinstance(item, dict) or marcado_excluido(item):
            continue
        if str(item.get("id") or "") != identificador:
            continue
        if documento and documento_do_orcamento(item) != documento:
            continue
        return item
    return None


def achar_rascunho_painel(lista, documento, tipo_orcamento, identificador="", somente_a_enviar=True):
    """Localiza rascunho puro (status_envio_de = A Enviar). Ignora legado rebaixado com PDF/canal."""
    documento = apenas_digitos(documento)
    identificador = str(identificador or "")
    if identificador and id_painel_valido(identificador):
        for item in lista:
            if marcado_excluido(item):
                continue
            if str(item.get("id") or "") != identificador:
                continue
            if documento_do_orcamento(item) != documento:
                continue
            if somente_a_enviar and status_envio_de(item) != STATUS_ENVIO_RASCUNHO:
                return None
            return item
    candidato_tipo = None
    candidato_qualquer = None
    for item in lista:
        if marcado_excluido(item):
            continue
        if status_envio_de(item) != STATUS_ENVIO_RASCUNHO:
            continue
        if documento_do_orcamento(item) != documento:
            continue
        if candidato_qualquer is None:
            candidato_qualquer = item
        tipo_item = str(item.get("tipoOrcamento") or "").strip() or tipo_orcamento_de(item)
        if tipo_orcamento and tipo_item == tipo_orcamento:
            candidato_tipo = item
            break
    return candidato_tipo or candidato_qualquer


def upsert_rascunho_painel(corpo):
    """Upsert de rascunho multi-dispositivo. Existência = itens.length > 0; total R$ 0,00 é válido.

    Nunca rebaixa Recebido/Enviado: reedição de orçamento já enviado só atualiza no POST final
    (incluir_orcamento_painel com o mesmo id).
    """
    if not isinstance(corpo, dict):
        return None
    documento = apenas_digitos(corpo.get("documento") or "")
    if not (cpf_valido(documento) or cnpj_valido(documento)):
        return None
    itens = normalizar_itens_painel(corpo.get("itens"))
    if not itens:
        return None
    tipo_orcamento = tipo_orcamento_de(corpo, itens)
    nome = str(corpo.get("nome") or "").strip()[:120]
    if not nome and isinstance(corpo.get("cliente"), dict):
        nome = str(corpo["cliente"].get("nome") or "").strip()[:120]
    if not nome:
        nome = "Cliente"
    telefone = apenas_digitos(corpo.get("telefone") or "")
    if not telefone and isinstance(corpo.get("cliente"), dict):
        telefone = apenas_digitos(corpo["cliente"].get("celular") or corpo["cliente"].get("telefone") or "")
    pdf_id = str(corpo.get("pdfId") or "").strip().lower()
    if not id_pdf_valido(pdf_id):
        pdf_id = ""
    identificador = str(corpo.get("id") or "")
    with PAINEL_LOCK:
        lista = ler_painel()
        # Reedição de já enviado: não cria rascunho paralelo nem rebaixa o Recebido.
        if id_painel_valido(identificador):
            existente = achar_orcamento_por_id(lista, documento, identificador)
            if existente is not None and status_envio_de(existente) != STATUS_ENVIO_RASCUNHO:
                return dict(existente)
        anterior = achar_rascunho_painel(
            lista,
            documento,
            tipo_orcamento,
            identificador,
            somente_a_enviar=True,
        )
        if anterior is not None and status_envio_de(anterior) != STATUS_ENVIO_RASCUNHO:
            anterior = None
        if anterior is not None:
            anterior["data"] = agora_painel().isoformat(timespec="seconds")
            anterior["nome"] = nome
            anterior["documento"] = documento
            if telefone_painel_valido(telefone):
                anterior["telefone"] = formatar_telefone(telefone)
            elif not anterior.get("telefone"):
                anterior["telefone"] = ""
            anterior["itens"] = itens
            anterior["total"] = round(sum(item["valor"] for item in itens), 2)
            if pdf_id:
                anterior["pdfId"] = pdf_id
            elif "pdfId" not in anterior:
                anterior["pdfId"] = ""
            anterior["cliente"] = cliente_do_painel(corpo, nome, documento, telefone)
            anterior["status"] = STATUS_ENVIO_RASCUNHO
            anterior["tipoOrcamento"] = tipo_orcamento
            if str(anterior.get("meio_envio") or "").strip() not in MEIOS_ENVIO:
                anterior["meio_envio"] = ""
            gravar_painel(lista)
            return dict(anterior)
        registro = {
            "id": hoje_painel().replace("-", "") + "-" + secrets.token_hex(4),
            "data": agora_painel().isoformat(timespec="seconds"),
            "nome": nome,
            "documento": documento,
            "telefone": formatar_telefone(telefone) if telefone_painel_valido(telefone) else "",
            "itens": itens,
            "total": round(sum(item["valor"] for item in itens), 2),
            "pdfId": pdf_id,
            "cliente": cliente_do_painel(corpo, nome, documento, telefone),
            "status": STATUS_ENVIO_RASCUNHO,
            "vendedor": "",
            "meio_envio": "",
            "tipoOrcamento": tipo_orcamento,
        }
        lista.insert(0, registro)
        gravar_painel(lista[:PAINEL_LIMITE])
    return dict(registro)


def excluir_rascunho_painel(documento, identificador=""):
    """Remove de vez o rascunho A Enviar quando a lista fica sem itens."""
    documento = apenas_digitos(documento)
    identificador = str(identificador or "")
    if not (cpf_valido(documento) or cnpj_valido(documento)):
        return False
    with PAINEL_LOCK:
        lista = ler_painel()
        restante = []
        removido = False
        for item in lista:
            if item.get("excluido") or status_envio_de(item) != STATUS_ENVIO_RASCUNHO:
                restante.append(item)
                continue
            if documento_do_orcamento(item) != documento:
                restante.append(item)
                continue
            if identificador and str(item.get("id") or "") != identificador:
                restante.append(item)
                continue
            removido = True
        if removido:
            gravar_painel(restante)
    return removido


def orcamento_anterior(lista, registro):
    """(registro já gravado, motivo): "repetido", "voz" ou "rascunho" (A Enviar do mesmo documento/tipo)."""
    agora = agora_painel()
    assinatura = assinatura_itens(registro["itens"])
    tipo_registro = str(registro.get("tipoOrcamento") or "").strip() or tipo_orcamento_de(registro)
    id_informado = str(registro.get("id") or "")
    doc_registro = documento_do_orcamento(registro) or apenas_digitos(str(registro.get("documento") or ""))
    rascunho = achar_rascunho_painel(lista, doc_registro, tipo_registro, id_informado)
    if rascunho is not None:
        return rascunho, "rascunho"
    for item in lista:
        if item.get("excluido") or documento_do_orcamento(item) != doc_registro:
            continue
        if status_envio_de(item) == STATUS_ENVIO_RASCUNHO:
            continue
        idade = segundos_desde(item.get("data"), agora)
        if idade is None or idade > PAINEL_VOZ_JANELA:
            continue
        try:
            if assinatura_itens(item.get("itens") or []) != assinatura:
                continue
        except (TypeError, ValueError):
            continue
        meio = item.get("meio_envio")
        if meio == registro["meio_envio"] and idade <= PAINEL_REPETIDO:
            return item, "repetido"
        if meio == "Comando de Voz" and registro["meio_envio"] != "Comando de Voz":
            return item, "voz"
    return None, ""


def incluir_orcamento_painel(corpo, meio_envio):
    """Converte rascunho A Enviar em Recebido (mesmo id) ou cria o registro final. Sem duplicar A Enviar.

    Se o cliente reenvia um orçamento já Recebido com o mesmo id, atualiza o registro no lugar
    (itens/total/data/meio_envio) em vez de inserir outra linha.
    """
    if not isinstance(corpo, dict):
        return None
    if meio_envio not in MEIOS_ENVIO:
        print("painel: meio_envio %r inválido; gravado %r" % (str(meio_envio)[:20], MEIO_ENVIO_PADRAO), file=sys.stderr, flush=True)
        meio_envio = MEIO_ENVIO_PADRAO
    nome = str(corpo.get("nome") or "").strip()[:120]
    documento = apenas_digitos(corpo.get("documento") or "")
    telefone = apenas_digitos(corpo.get("telefone") or "")
    if not nome or not (cpf_valido(documento) or cnpj_valido(documento)) or not telefone_painel_valido(telefone):
        return None
    itens = normalizar_itens_painel(corpo.get("itens"))
    if not itens:
        return None
    pdf_id = str(corpo.get("pdfId") or "").strip().lower()
    if not id_pdf_valido(pdf_id):
        pdf_id = ""
    tipo_orcamento = tipo_orcamento_de(corpo, itens)
    id_informado = str(corpo.get("id") or "")
    registro = {
        "id": id_informado if id_painel_valido(id_informado) else (hoje_painel().replace("-", "") + "-" + secrets.token_hex(4)),
        "data": agora_painel().isoformat(timespec="seconds"),
        "nome": nome,
        "documento": documento,
        "telefone": formatar_telefone(telefone),
        "itens": itens,
        "total": round(sum(item["valor"] for item in itens), 2),
        "pdfId": pdf_id,
        "cliente": cliente_do_painel(corpo, nome, documento, telefone),
        "status": status_atendimento_padrao(),
        "vendedor": "",
        "meio_envio": meio_envio,
        "tipoOrcamento": tipo_orcamento,
    }
    with PAINEL_LOCK:
        lista = ler_painel()
        # Reedição/reenvio: mesmo id → sobrescreve o registro existente (nunca duplica).
        existente = achar_orcamento_por_id(lista, documento, registro["id"])
        if existente is not None:
            existente["data"] = registro["data"]
            existente["nome"] = registro["nome"]
            existente["documento"] = documento
            existente["telefone"] = registro["telefone"]
            existente["itens"] = registro["itens"]
            existente["total"] = registro["total"]
            existente["pdfId"] = registro["pdfId"] or str(existente.get("pdfId") or "")
            existente["cliente"] = registro["cliente"]
            existente["status"] = status_atendimento_padrao()
            existente["meio_envio"] = meio_envio
            existente["tipoOrcamento"] = registro["tipoOrcamento"] or str(existente.get("tipoOrcamento") or "") or tipo_orcamento
            if not existente.get("vendedor"):
                existente["vendedor"] = ""
            nova = []
            for item in lista:
                if item is existente:
                    continue
                if (
                    not marcado_excluido(item)
                    and status_envio_de(item) == STATUS_ENVIO_RASCUNHO
                    and documento_do_orcamento(item) == documento
                ):
                    continue
                # Remove duplicata fantasma com o mesmo id (legado).
                if str(item.get("id") or "") == str(existente.get("id") or ""):
                    continue
                nova.append(item)
            nova.insert(0, existente)
            gravar_painel(nova[:PAINEL_LIMITE])
            registro = dict(existente)
            motivo = "atualizacao"
            anterior = existente
        else:
            anterior, motivo = orcamento_anterior(lista, registro)
            if motivo == "repetido":
                # Reforço: se o "repetido" ainda estiver A Enviar, promove para Recebido.
                if str(anterior.get("status") or "").strip() == STATUS_ENVIO_RASCUNHO or status_envio_de(anterior) == STATUS_ENVIO_RASCUNHO:
                    anterior["status"] = status_atendimento_padrao()
                    anterior["meio_envio"] = meio_envio
                    anterior["data"] = registro["data"]
                    anterior["itens"] = registro["itens"]
                    anterior["total"] = registro["total"]
                    anterior["pdfId"] = registro["pdfId"] or anterior.get("pdfId") or ""
                    anterior["cliente"] = registro["cliente"]
                    anterior["nome"] = registro["nome"]
                    anterior["telefone"] = registro["telefone"]
                    anterior["tipoOrcamento"] = registro["tipoOrcamento"]
                    gravar_painel(lista)
                    return dict(anterior)
                print("painel: envio repetido ignorado (%s)" % anterior.get("id"), file=sys.stderr, flush=True)
                return dict(anterior, repetido=True)
            if motivo in ("voz", "rascunho"):
                # Atualiza o mesmo registro: status Recebido + meio_envio; remove qualquer outro A Enviar órfão do doc.
                registro["id"] = str(anterior.get("id") or registro["id"])
                registro["vendedor"] = anterior.get("vendedor") or ""
                registro["pdfId"] = registro["pdfId"] or str(anterior.get("pdfId") or "")
                if not registro.get("tipoOrcamento"):
                    registro["tipoOrcamento"] = str(anterior.get("tipoOrcamento") or "") or tipo_orcamento
                nova = []
                for item in lista:
                    if item is anterior:
                        continue
                    if (
                        not marcado_excluido(item)
                        and status_envio_de(item) == STATUS_ENVIO_RASCUNHO
                        and documento_do_orcamento(item) == documento
                    ):
                        continue
                    if str(item.get("id") or "") == str(registro.get("id") or ""):
                        continue
                    nova.append(item)
                nova.insert(0, registro)
                lista = nova
            else:
                lista.insert(0, registro)
            # Garante status final canônico da Área Restrita.
            registro["status"] = status_atendimento_padrao()
            registro["meio_envio"] = meio_envio
            gravar_painel(lista[:PAINEL_LIMITE])
    try:
        email_cliente = ""
        if isinstance(registro.get("cliente"), dict):
            email_cliente = registro["cliente"].get("email") or ""
        if not email_cliente and isinstance(corpo.get("cliente"), dict):
            email_cliente = corpo["cliente"].get("email") or ""
        remover_lead_trafego(telefone, email_cliente or corpo.get("email") or "")
    except Exception as erro:
        print("acessos: falha ao remover lead após envio (%s)" % erro, file=sys.stderr, flush=True)
    if motivo == "voz":
        return dict(registro, voz_anterior=anterior)
    if motivo == "rascunho":
        return dict(registro, rascunho_anterior=anterior)
    return registro


def interpretar_metricas(conteudo):
    if not conteudo:
        return []
    try:
        dados = json.loads(conteudo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return []
    if not isinstance(dados, list):
        return []
    return [item for item in dados if isinstance(item, dict) and item.get("dia")]


def ler_metricas():
    if token_blob():
        conteudo = baixar_blob(METRICAS_BLOB, consistente=True)
        if conteudo is None:
            raise OSError("blob")
        return interpretar_metricas(conteudo)
    if em_vercel():
        raise OSError("blob")
    arquivo = caminho_metricas()
    if not arquivo.is_file():
        return []
    return interpretar_metricas(arquivo.read_bytes())


def gravar_metricas(lista):
    conteudo = json.dumps(lista, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if token_blob():
        if not enviar_json_blob(METRICAS_BLOB, conteudo):
            raise OSError("blob")
        return
    if em_vercel():
        raise OSError("blob")
    destino = caminho_metricas()
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".json.tmp")
    temporario.write_bytes(conteudo)
    os.replace(temporario, destino)


def item_de_voz(item):
    codigo = str(item.get("codigo") or "").strip().lower()
    return codigo.startswith("voz-") or (not codigo and not item.get("preco"))


def valor_do_registro(registro):
    try:
        return round(float(registro.get("total")), 2)
    except (TypeError, ValueError):
        pass
    soma = 0.0
    for item in registro.get("itens") or []:
        try:
            valor = item.get("valor")
            soma += float(valor) if valor is not None else float(item.get("preco") or 0) * int(item.get("qtd") or 1)
        except (AttributeError, TypeError, ValueError):
            continue
    return round(soma, 2)


def metrica_do_orcamento(registro):
    """Só o que é anônimo: quando, como foi montado, PF/PJ, valor total e quais produtos."""
    itens = registro.get("itens") or []
    voz = sum(1 for item in itens if item_de_voz(item))
    produtos = {}
    for item in itens:
        if item_de_voz(item):
            nome = limpar_nome_intencao(item.get("produto"))
            chave = "voz:" + " ".join(nome.lower().split())
            codigo = ""
        else:
            nome = str(item.get("produto") or "").strip()[:160]
            codigo = str(item.get("codigo") or "").strip()[:40]
            chave = "sku:" + codigo if codigo else "nome:" + " ".join(nome.lower().split())
        if not nome:
            continue
        qtd = int(item.get("qtd") or 1)
        atual = produtos.get(chave)
        if atual:
            atual["qtd"] = max(atual["qtd"], qtd)
            continue
        produtos[chave] = {"codigo": codigo, "produto": nome, "qtd": qtd}
    cliente = registro.get("cliente") or {}
    data = str(registro.get("data") or agora_painel().isoformat(timespec="seconds"))
    return {
        "id": str(registro.get("id") or ""),
        "data": data,
        "dia": normalizar_data_painel(data) or hoje_painel(),
        "metodo": "gigavoz" if itens and voz * 2 > len(itens) else "tradicional",
        "pessoa": "pj" if cliente.get("tipo") == "pj" else "pf",
        "total": valor_do_registro(registro),
        "produtos": list(produtos.values()),
    }


def registrar_metrica(registro):
    # A métrica nunca pode derrubar o envio do orçamento ao cliente.
    try:
        metrica = metrica_do_orcamento(registro)
        with METRICAS_LOCK:
            lista = ler_metricas()
            lista.insert(0, metrica)
            gravar_metricas(lista[:METRICAS_LIMITE])
    except Exception as erro:
        print("metricas: falha ao gravar (%s)" % erro, file=sys.stderr, flush=True)


def moeda_brl(valor):
    inteiro, centavos = ("%.2f" % float(valor or 0)).split(".")
    return "R$ %s,%s" % ("{:,}".format(int(inteiro)).replace(",", "."), centavos)


def valor_da_metrica(metrica):
    """None quando a métrica é anterior ao registro de valores e o orçamento já não está no painel."""
    try:
        return float(metrica["total"])
    except (KeyError, TypeError, ValueError):
        return None


def porcentagens(contagem, total, valores):
    return {
        chave: {
            "qtd": quantidade,
            "pct": round(quantidade * 100.0 / total, 1) if total else 0.0,
            "valor": round(valores[chave], 2),
            "valorTexto": moeda_brl(valores[chave]),
        }
        for chave, quantidade in contagem.items()
    }


def serie_do_periodo(metricas, inicio, fim):
    if not inicio or not fim:
        return "dia", []
    primeiro = datetime.strptime(inicio, "%Y-%m-%d").date()
    ultimo = datetime.strptime(fim, "%Y-%m-%d").date()
    mensal = (ultimo - primeiro).days > 62
    chaves = []
    dia = primeiro
    while dia <= ultimo:
        chave = dia.strftime("%Y-%m") if mensal else dia.isoformat()
        if not chaves or chaves[-1] != chave:
            chaves.append(chave)
        dia += timedelta(days=1)
    contagem = {chave: {"periodo": chave, "total": 0, "tradicional": 0, "gigavoz": 0} for chave in chaves}
    for metrica in metricas:
        chave = metrica["dia"][:7] if mensal else metrica["dia"]
        if chave in contagem:
            contagem[chave]["total"] += 1
            contagem[chave]["gigavoz" if metrica.get("metodo") == "gigavoz" else "tradicional"] += 1
    return ("mes" if mensal else "dia"), [contagem[chave] for chave in chaves]


def estatisticas_dashboard(lista, inicio="", fim=""):
    bruto_inicio = str(inicio or "").strip()
    bruto_fim = str(fim or "").strip()
    inicio = normalizar_data_painel(bruto_inicio) if bruto_inicio else ""
    fim = normalizar_data_painel(bruto_fim) if bruto_fim else ""
    if (bruto_inicio and not inicio) or (bruto_fim and not fim) or (inicio and fim and inicio > fim):
        return None
    metricas = [
        item for item in lista
        if (not inicio or item.get("dia", "") >= inicio) and (not fim or item.get("dia", "") <= fim)
    ]
    dias = sorted(item["dia"] for item in metricas)
    serie_inicio = inicio or (dias[0] if dias else "")
    serie_fim = fim or (dias[-1] if dias else "")
    total = len(metricas)
    metodo = {"tradicional": 0, "gigavoz": 0}
    pessoa = {"pf": 0, "pj": 0}
    valor_metodo = {"tradicional": 0.0, "gigavoz": 0.0}
    valor_pessoa = {"pf": 0.0, "pj": 0.0}
    sem_valor = 0
    for item in metricas:
        chave_metodo = "gigavoz" if item.get("metodo") == "gigavoz" else "tradicional"
        chave_pessoa = "pj" if item.get("pessoa") == "pj" else "pf"
        metodo[chave_metodo] += 1
        pessoa[chave_pessoa] += 1
        valor = valor_da_metrica(item)
        if valor is None:
            sem_valor += 1
            continue
        valor_metodo[chave_metodo] += valor
        valor_pessoa[chave_pessoa] += valor
    agrupamento, serie = serie_do_periodo(metricas, serie_inicio, serie_fim)
    return {
        "inicio": serie_inicio,
        "fim": serie_fim,
        "total": total,
        "agrupamento": agrupamento,
        "serie": serie,
        "metodo": porcentagens(metodo, total, valor_metodo),
        "pessoa": porcentagens(pessoa, total, valor_pessoa),
        "semValor": sem_valor,
    }


def instante_painel(valor):
    try:
        return datetime.fromisoformat(str(valor or "")).timestamp()
    except ValueError:
        return None


def registro_conta_painel_comercial(registro):
    """Mesma elegibilidade de Orçamentos Recebidos: ativo, válido e não rascunho A Enviar."""
    if not isinstance(registro, dict):
        return False
    if not str(registro.get("id") or "").strip():
        return False
    if marcado_excluido(registro):
        return False
    if status_envio_de(registro) == STATUS_ENVIO_RASCUNHO:
        return False
    # Órfão/incompleto: sem data utilizável não entra no volume comercial.
    if not normalizar_data_painel(registro.get("data")):
        return False
    return True


def metricas_validas(metricas, painel):
    """O Painel Comercial conta os mesmos orçamentos da listagem Orçamentos Recebidos:
    sem excluido, sem órfãos e sem status A Enviar. metricas.json só completa o que o painel
    já descartou por ter passado de PAINEL_LIMITE."""
    if painel is None:
        return []
    ids_ignorados = {
        str(registro.get("id") or "")
        for registro in painel
        if isinstance(registro, dict) and str(registro.get("id") or "").strip() and (
            marcado_excluido(registro) or status_envio_de(registro) == STATUS_ENVIO_RASCUNHO
        )
    }
    ativos = [
        metrica_do_orcamento(registro)
        for registro in painel
        if registro_conta_painel_comercial(registro)
    ]
    if len(painel) < PAINEL_LIMITE:
        return ativos
    instantes = [
        instante_painel(registro.get("data"))
        for registro in painel
        if registro_conta_painel_comercial(registro)
    ]
    instantes = [valor for valor in instantes if valor is not None]
    if not instantes:
        return ativos
    mais_antigo = min(instantes)
    descartados = []
    for metrica in metricas or []:
        if not isinstance(metrica, dict):
            continue
        ident = str(metrica.get("id") or "").strip()
        if not ident or ident in ids_ignorados:
            continue
        instante = instante_painel(metrica.get("data"))
        if instante is not None and instante < mais_antigo:
            descartados.append(metrica)
    return descartados + ativos


def responder_dashboard(saida):
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
        return
    try:
        lista = ler_metricas()
    except OSError:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível ler as estatísticas."}, 500)
        return
    inicio = parametro_consulta(saida.path, "dataInicio")
    fim = parametro_consulta(saida.path, "dataFim")
    try:
        painel = ler_painel()
    except OSError:
        painel = None
    dados = estatisticas_dashboard(metricas_validas(lista, painel), inicio, fim)
    if dados is None:
        escrever_json(saida, {"ok": False, "erro": "Período inválido."}, 400)
        return
    dados["ok"] = True
    escrever_json(saida, dados)


def endereco_redis():
    return (os.environ.get("REDIS_URL") or "").strip()


class ErroRedis(Exception):
    pass


def comando_resp(partes):
    saida = [b"*%d\r\n" % len(partes)]
    for parte in partes:
        dado = str(parte).encode("utf-8")
        saida.append(b"$%d\r\n%s\r\n" % (len(dado), dado))
    return b"".join(saida)


def ler_resp(arquivo):
    linha = arquivo.readline()
    if not linha.endswith(b"\r\n"):
        raise ConnectionError("Redis encerrou a conexão")
    tipo, valor = linha[:1], linha[1:-2]
    if tipo == b"+":
        return valor.decode("utf-8", "replace")
    if tipo == b"-":
        return ErroRedis(valor.decode("utf-8", "replace"))
    if tipo == b":":
        return int(valor)
    if tipo == b"$":
        tamanho = int(valor)
        if tamanho < 0:
            return None
        return arquivo.read(tamanho + 2)[:-2].decode("utf-8", "replace")
    if tipo == b"*":
        tamanho = int(valor)
        if tamanho < 0:
            return None
        return [ler_resp(arquivo) for _ in range(tamanho)]
    raise ConnectionError("resposta inválida do Redis")


def redis_pipeline(comandos):
    """Envia os comandos numa conexão só (redis:// ou rediss:// do REDIS_URL) e devolve as respostas."""
    endereco = endereco_redis()
    if not endereco:
        return None
    url = urlparse(endereco)
    if url.scheme not in ("redis", "rediss") or not url.hostname:
        raise ErroRedis("REDIS_URL inválida")
    preparo = []
    if url.password:
        senha = urllib.parse.unquote(url.password)
        usuario = urllib.parse.unquote(url.username or "")
        preparo.append(["AUTH", usuario, senha] if usuario else ["AUTH", senha])
    banco = (url.path or "").strip("/")
    if banco.isdigit() and banco != "0":
        preparo.append(["SELECT", banco])
    conexao = socket.create_connection((url.hostname, url.port or 6379), timeout=5)
    try:
        if url.scheme == "rediss":
            conexao = ssl.create_default_context().wrap_socket(conexao, server_hostname=url.hostname)
        conexao.sendall(b"".join(comando_resp(comando) for comando in preparo + comandos))
        arquivo = conexao.makefile("rb")
        respostas = [ler_resp(arquivo) for _ in preparo + comandos]
    finally:
        conexao.close()
    for resposta in respostas:
        if isinstance(resposta, ErroRedis):
            raise resposta
    return respostas[len(preparo):]


def dispositivo_acesso(agente, informado=""):
    # O navegador detecta toque + largura (iPhone/iPad no Safari se anunciam como Macintosh).
    if informado in ("Mobile", "Desktop"):
        return informado
    return "Mobile" if RE_MOBILE.search(agente or "") else "Desktop"


def ip_do_cliente(saida):
    encaminhado = saida.headers.get("X-Forwarded-For") or saida.headers.get("X-Real-IP") or ""
    ip = encaminhado.split(",")[0].strip()
    if not ip:
        endereco = getattr(saida, "client_address", None)
        ip = str(endereco[0]) if endereco else ""
    return ip


def anonimizar_ip(ip):
    """LGPD: guarda só os dois primeiros blocos do IP."""
    try:
        endereco = ipaddress.ip_address(str(ip or "").strip())
    except ValueError:
        return ""
    if endereco.version == 6 and endereco.ipv4_mapped:
        endereco = endereco.ipv4_mapped
    if endereco.version == 4:
        blocos = str(endereco).split(".")
        return "%s.%s.X.X" % (blocos[0], blocos[1])
    blocos = endereco.exploded.split(":")
    return "%s:%s:X:X:X:X:X:X" % (blocos[0], blocos[1])


def nome_lead(valor):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(valor or ""))).strip()[:120]


def cep_lead(valor):
    digitos = apenas_digitos(valor)
    return digitos if len(digitos) == 8 else ""


def email_lead(valor):
    texto = str(valor or "").strip().lower()
    return texto if len(texto) <= 120 and RE_EMAIL.fullmatch(texto) else ""


def chave_lead_contato(telefone="", email=""):
    """Chave diária do lead: telefone (dígitos) tem prioridade; senão e-mail em minúsculas."""
    tel = apenas_digitos(telefone)
    if len(tel) >= 10:
        return "tel:" + tel
    mail = email_lead(email)
    if mail:
        return "mail:" + mail
    return ""


def chave_acesso_dia(registro):
    """Campo único do hash Redis do dia: tel:DDDNUMERO ou mail:email."""
    chave = chave_lead_contato(registro.get("telefone"), registro.get("email"))
    if chave:
        return chave
    visitante = str(registro.get("id_visitante") or registro.get("id_sessao") or "").strip()
    return visitante if visitante.startswith(("tel:", "mail:")) else ""


def chave_hash_acessos(dia):
    """Hash dedicado do dia: HSET é atômico e não disputa com a lista legada log:YYYY-MM-DD."""
    return ACESSOS_CHAVE + "dia:" + dia


def eh_lead_trafego(dados):
    """Só entram na lista leads com telefone ou e-mail; visitas antigas por IP são ignoradas."""
    if not isinstance(dados, dict):
        return False
    return bool(chave_lead_contato(dados.get("telefone"), dados.get("email")))


def lead_contactado(valor):
    return valor in (True, 1, "1", "true", "True", "sim", "Sim")


def fundir_lead(atual, novo):
    """Atualiza horário e preenche campos vazios sem apagar o que o cliente já informou."""
    mesclado = dict(atual or {})
    mesclado.update({chave: valor for chave, valor in (novo or {}).items() if valor not in (None, "")})
    for campo in ("nome", "telefone", "email", "cep", "dispositivo"):
        if not str(novo.get(campo) or "").strip() and str((atual or {}).get(campo) or "").strip():
            mesclado[campo] = atual[campo]
    if novo.get("data_hora"):
        mesclado["data_hora"] = novo["data_hora"]
    # Upsert do formulário não desfaz o "Já contactado" marcado pela equipe.
    if lead_contactado((atual or {}).get("contactado")) or lead_contactado((novo or {}).get("contactado")):
        mesclado["contactado"] = True
        mesclado["contactado_em"] = (
            str((novo or {}).get("contactado_em") or "").strip()
            or str((atual or {}).get("contactado_em") or "").strip()
        )
    else:
        mesclado["contactado"] = False
        mesclado["contactado_em"] = str(mesclado.get("contactado_em") or "").strip()
    return mesclado


def conectar_acessos():
    conn = conectar()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS acessos_log ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "ip_anonimizado TEXT, id_sessao TEXT, id_visitante TEXT, quem_acessou TEXT, dispositivo TEXT, origem TEXT)"
    )
    existentes = {linha[1] for linha in conn.execute("PRAGMA table_info(acessos_log)")}
    for coluna in (
        "id_sessao", "id_visitante", "quem_acessou", "dispositivo", "origem",
        "nome", "telefone", "email", "cep", "contactado", "contactado_em",
    ):
        if coluna not in existentes:
            conn.execute("ALTER TABLE acessos_log ADD COLUMN %s TEXT" % coluna)
    return conn


def gravar_acesso_local(registro):
    """1 lead por contato+dia: atualiza horário e dados se já existir."""
    dia = registro["data_hora"][:10]
    campo = chave_acesso_dia(registro)
    if not campo:
        return
    conn = conectar_acessos()
    try:
        existente = conn.execute(
            "SELECT id, nome, telefone, email, cep, dispositivo, contactado, contactado_em FROM acessos_log "
            "WHERE substr(data_hora, 1, 10) = ? AND id_visitante = ? ORDER BY id DESC LIMIT 1",
            (dia, campo),
        ).fetchone()
        if existente:
            atual = dict(existente)
            mesclado = fundir_lead(atual, registro)
            conn.execute(
                "UPDATE acessos_log SET data_hora = ?, id_sessao = ?, nome = ?, telefone = ?, email = ?, "
                "cep = ?, dispositivo = ?, ip_anonimizado = ?, contactado = ?, contactado_em = ? WHERE id = ?",
                (
                    mesclado["data_hora"], campo, mesclado.get("nome") or "", mesclado.get("telefone") or "",
                    mesclado.get("email") or "", mesclado.get("cep") or "", mesclado.get("dispositivo") or "",
                    mesclado.get("ip_anonimizado") or "",
                    "1" if lead_contactado(mesclado.get("contactado")) else "0",
                    mesclado.get("contactado_em") or "", existente["id"],
                ),
            )
        else:
            conn.execute(
                "INSERT INTO acessos_log (data_hora, ip_anonimizado, id_sessao, id_visitante, nome, telefone, email, cep, dispositivo, contactado, contactado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    registro["data_hora"], registro.get("ip_anonimizado") or "", campo, campo,
                    registro.get("nome") or "", registro.get("telefone") or "", registro.get("email") or "",
                    registro.get("cep") or "", registro.get("dispositivo") or "",
                    "1" if lead_contactado(registro.get("contactado")) else "0",
                    registro.get("contactado_em") or "",
                ),
            )
        conn.commit()
    finally:
        conn.close()


def registro_acesso_de_json(item):
    try:
        dados = json.loads(item) if isinstance(item, str) else item
    except (TypeError, ValueError):
        return None
    return dados if isinstance(dados, dict) else None


def normalizar_registro_acesso(dados):
    if not isinstance(dados, dict):
        return None
    atual = dict(dados)
    if not str(atual.get("id_visitante") or "").strip():
        atual["id_visitante"] = chave_acesso_dia(atual) or str(atual.get("id_sessao") or "").strip()
    return atual if eh_lead_trafego(atual) else None


def ler_acessos_do_dia_redis(dia):
    """Hash dia: é a fonte da verdade; o legado log: só entra se o hash novo ainda não existir."""
    chave_nova = chave_hash_acessos(dia)
    chave_legada = ACESSOS_CHAVE + "log:" + dia
    tipo_nova, tipo_legada = redis_pipeline([["TYPE", chave_nova], ["TYPE", chave_legada]])
    comandos = []
    if tipo_nova == "hash":
        comandos.append(["HVALS", chave_nova])
    elif tipo_legada == "hash":
        comandos.append(["HVALS", chave_legada])
    elif tipo_legada == "list":
        comandos.append(["LRANGE", chave_legada, 0, -1])
    if not comandos:
        return []
    linhas = []
    for bloco in redis_pipeline(comandos) or []:
        itens = bloco if isinstance(bloco, list) else ([bloco] if bloco else [])
        for item in itens:
            dados = normalizar_registro_acesso(registro_acesso_de_json(item))
            if dados:
                linhas.append(dados)
    return linhas


def registrar_acesso(registro):
    campo = chave_acesso_dia(registro)
    if not campo:
        return
    registro = dict(registro)
    registro["id_visitante"] = campo
    registro["id_sessao"] = campo
    if endereco_redis():
        dia = registro["data_hora"][:10]
        chave = chave_hash_acessos(dia)
        atual_bruto = redis_pipeline([["HGET", chave, campo]])[0]
        atual = normalizar_registro_acesso(registro_acesso_de_json(atual_bruto)) if atual_bruto else None
        mesclado = fundir_lead(atual, registro) if atual else registro
        mesclado["id_visitante"] = campo
        mesclado["id_sessao"] = campo
        redis_pipeline([
            ["HSET", chave, campo, json.dumps(mesclado, ensure_ascii=False)],
            ["EXPIRE", chave, ACESSOS_EXPIRA],
        ])
        return
    if em_vercel():
        return
    gravar_acesso_local(registro)


def remover_lead_trafego(telefone="", email=""):
    """Remove o lead do dia quando o orçamento é concluído (WhatsApp, E-mail ou Comando de Voz)."""
    campos = []
    tel = apenas_digitos(telefone)
    mail = email_lead(email)
    if len(tel) >= 10:
        campos.append("tel:" + tel)
    if mail:
        campos.append("mail:" + mail)
    if not campos:
        return
    dia = agora_painel().strftime("%Y-%m-%d")
    if endereco_redis():
        chave = chave_hash_acessos(dia)
        redis_pipeline([["HDEL", chave] + campos])
        return
    if em_vercel():
        return
    conn = conectar_acessos()
    try:
        conn.execute(
            "DELETE FROM acessos_log WHERE substr(data_hora, 1, 10) = ? AND id_visitante IN (%s)"
            % ", ".join("?" for _ in campos),
            [dia] + campos,
        )
        conn.commit()
    finally:
        conn.close()


def responder_registrar_acesso(saida):
    # Lead com contato: telefone válido ou e-mail válido. Sem geo por IP.
    try:
        agente = saida.headers.get("User-Agent") or ""
        tamanho = int(saida.headers.get("Content-Length", "0") or "0")
        if not RE_ROBO.search(agente) and 0 <= tamanho <= ACESSOS_CORPO_MAX:
            corpo = saida.rfile.read(tamanho) if tamanho else b""
            dados = json.loads(corpo.decode("utf-8")) if corpo else {}
            if not isinstance(dados, dict):
                dados = {}
            telefone = apenas_digitos(dados.get("telefone") or dados.get("celular") or "")
            email = email_lead(dados.get("email"))
            if len(telefone) < 10:
                telefone = ""
            if not telefone and not email:
                escrever_json(saida, {"status": "sucesso"})
                return
            registro = {
                "data_hora": agora_painel().strftime("%Y-%m-%d %H:%M:%S"),
                "ip_anonimizado": anonimizar_ip(ip_do_cliente(saida)),
                "nome": nome_lead(dados.get("nome")),
                "telefone": telefone,
                "email": email,
                "cep": cep_lead(dados.get("cep")),
                "dispositivo": dispositivo_acesso(agente, dados.get("dispositivo")),
                "contactado": False,
                "contactado_em": "",
            }
            registro["id_visitante"] = chave_acesso_dia(registro)
            registro["id_sessao"] = registro["id_visitante"]
            registrar_acesso(registro)
    except Exception as erro:
        print("acessos: falha ao registrar (%s)" % erro, file=sys.stderr, flush=True)
    escrever_json(saida, {"status": "sucesso"})


def email_destino(valor):
    texto = str(valor or "").strip()
    return texto if len(texto) <= 120 and RE_EMAIL.fullmatch(texto) else ""


def variavel_sem_aspas(nome):
    # No painel da Vercel é comum colar o valor entre aspas, ou "limpar" o campo deixando só "".
    return (os.environ.get(nome) or "").strip().strip("\"'").strip()


def emails_copia_admin():
    partes = variavel_sem_aspas("EMAIL_ADMIN_COPIA").replace(";", ",").split(",")
    return [email for email in (email_destino(parte.strip().strip("\"'")) for parte in partes) if email]


def remetente_email():
    """EMAIL_REMETENTE no formato email@dominio ou Nome <email@dominio>; fora disso vale o padrão."""
    valor = variavel_sem_aspas("EMAIL_REMETENTE")
    if not valor:
        return EMAIL_REMETENTE_PADRAO
    nome, _, resto = valor.rpartition("<")
    endereco = resto[:-1].strip() if resto.endswith(">") and nome.strip() else valor
    if "<" in nome or ">" in nome or not email_destino(endereco):
        print("email: EMAIL_REMETENTE fora do formato aceito; usando o remetente padrão", file=sys.stderr, flush=True)
        return EMAIL_REMETENTE_PADRAO
    return valor


def envio_email_bloqueado(ip):
    """Limita os envios por IP para a rota pública não virar disparador de spam."""
    chave = hashlib.sha256(("email:" + str(ip or "")).encode("utf-8")).hexdigest()[:32]
    if endereco_redis():
        contador = "email:{giga}:" + chave
        try:
            _, total = redis_pipeline([["SET", contador, 0, "EX", EMAIL_JANELA, "NX"], ["INCR", contador]])
            return int(total) > EMAIL_POR_JANELA
        except Exception as erro:
            print("email: limite indisponível (%s)" % erro, file=sys.stderr, flush=True)
            return False
    agora = time.time()
    with EMAIL_LOCK:
        recentes = [momento for momento in EMAIL_ENVIOS.get(chave, []) if agora - momento < EMAIL_JANELA]
        recentes.append(agora)
        EMAIL_ENVIOS[chave] = recentes
        return len(recentes) > EMAIL_POR_JANELA


def pdf_do_payload(valor):
    texto = str(valor or "")
    if texto.startswith("data:"):
        texto = texto.split(",", 1)[-1]
    try:
        conteudo = base64.b64decode(texto, validate=True)
    except (ValueError, TypeError):
        return b""
    if not conteudo.startswith(b"%PDF") or len(conteudo) > LIMITE_PDF:
        return b""
    return conteudo


def data_validade_orcamento(base=None):
    """Emissão + 15 dias, no fuso do painel (America/Sao_Paulo)."""
    momento = base or agora_painel()
    if not hasattr(momento, "date"):
        momento = agora_painel()
    validade = momento.date() + timedelta(days=15)
    return validade.strftime("%d/%m/%Y")


def pedido_por_voz(pedido):
    """Comando de Voz: tipoOrcamento/metodo/meio_envio ou maioria dos itens sem código e sem preço."""
    if not isinstance(pedido, dict):
        return False
    if str(pedido.get("tipoOrcamento") or pedido.get("tipo_orcamento") or "").strip() == "Comando de Voz":
        return True
    metodo = str(pedido.get("metodo") or "").strip().lower()
    if metodo in ("gigavoz", "voz", "comando de voz", "intencoes"):
        return True
    if str(pedido.get("meio_envio") or "").strip() == "Comando de Voz":
        return True
    if str(pedido.get("tipo") or "").strip().lower() == "intencoes":
        return True
    itens = pedido.get("itens") if isinstance(pedido.get("itens"), list) else []
    if not itens:
        return False
    voz = sum(1 for item in itens if isinstance(item, dict) and item_de_voz(item))
    return voz * 2 > len(itens)


def mensagem_envio_orcamento(por_voz=False, base=None):
    """Texto padrão do WhatsApp e do e-mail (corpo), por modalidade."""
    if por_voz:
        return (
            "Segue em anexo o seu pedido de orçamento gerado por comando de voz. "
            "Os preços dos itens listados, o estoque e o frete serão informados por WhatsApp ou e-mail."
        )
    return (
        "Segue em anexo o seu pedido de orçamento. Os preços dos itens listados valem até %s. "
        "O estoque e o frete serão informados por WhatsApp ou e-mail."
        % data_validade_orcamento(base)
    )


def nota_orcamento(por_voz=False, base=None):
    """Nota do rodapé do PDF e do quadro na tela."""
    if por_voz:
        return (
            "Nota: Este orçamento foi gerado por comando de voz. "
            "Os preços dos itens listados, o estoque e o frete serão informados por WhatsApp ou e-mail."
        )
    return (
        "Nota: Os preços dos itens listados valem até %s. "
        "O estoque e o frete serão informados por WhatsApp ou e-mail."
        % data_validade_orcamento(base)
    )


def mensagem_orcamento_email(nome, pedido=None):
    saudacao = "Olá, %s!" % nome if nome else "Olá!"
    mensagem = mensagem_envio_orcamento(pedido_por_voz(pedido))
    texto = (
        saudacao + "\n\n"
        + mensagem + "\n\n"
        "Gigaeletro Material Elétrico\n"
        "https://gigaeletro.com.br"
    )
    corpo = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">'
        "<p>" + html.escape(saudacao) + "</p>"
        "<p>" + html.escape(mensagem).replace(
            "WhatsApp",
            '<a href="https://wa.me/5527998235652">WhatsApp</a>',
            1,
        ) + "</p>"
        '<p style="margin-top:24px">Gigaeletro Material Elétrico<br>'
        '<a href="https://gigaeletro.com.br">gigaeletro.com.br</a></p>'
        "</div>"
    )
    return texto, corpo


def disparar_resend(chave, payload):
    requisicao = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + chave,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "gigaeletro-site/1.0",
        },
    )
    with urllib.request.urlopen(requisicao, timeout=20) as resposta:
        retorno = json.loads(resposta.read().decode("utf-8") or "{}")
    return retorno if isinstance(retorno, dict) else {}


def responder_enviar_orcamento_email(saida):
    try:
        tamanho = int(saida.headers.get("Content-Length", "0") or "0")
    except ValueError:
        tamanho = -1
    if tamanho <= 0 or tamanho > EMAIL_CORPO_MAX:
        escrever_json(saida, {"ok": False, "erro": "Orçamento grande demais para envio por e-mail."}, 413)
        return
    try:
        dados = json.loads(saida.rfile.read(tamanho).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        dados = None
    if not isinstance(dados, dict):
        escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
        return
    if str(dados.get("site") or "").strip():
        escrever_json(saida, {"ok": True})
        return
    destino = email_destino(dados.get("email"))
    if not destino:
        escrever_json(saida, {"ok": False, "erro": "Informe um e-mail válido."}, 400)
        return
    conteudo = pdf_do_payload(dados.get("pdf"))
    if not conteudo:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível ler o PDF do orçamento."}, 400)
        return
    pedido = dados.get("painel")
    if pedido is None:
        # Aba aberta antes do deploy: o script antigo não manda cliente e itens para o painel.
        print("email: pedido sem os dados do painel (script desatualizado no navegador)", file=sys.stderr, flush=True)
        escrever_json(saida, {"ok": False, "erro": "Esta página está desatualizada. Recarregue a página (F5) e envie novamente."}, 409)
        return
    if not pedido_painel_valido(pedido):
        print("email: dados do painel recusados (%s)" % motivo_pedido_invalido(pedido), file=sys.stderr, flush=True)
        escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
        return
    if envio_email_bloqueado(ip_do_cliente(saida)):
        escrever_json(saida, {"ok": False, "erro": "Muitos envios em sequência. Tente novamente em alguns minutos."}, 429)
        return
    nome = " ".join(unicodedata.normalize("NFC", str(dados.get("nome") or "")).split())[:120]
    pedido = dict(pedido)
    try:
        pedido["pdfId"] = guardar_pdf(nome or pedido.get("nome"), conteudo)
    except (ValueError, OSError) as erro:
        # Como no WhatsApp: sem o PDF publicado, o orçamento entra no painel sem o link.
        print("email: PDF não guardado (%s)" % erro, file=sys.stderr, flush=True)
        pedido["pdfId"] = ""
    # Sempre promove A Enviar → Recebido no painel antes do Resend (Área Restrita não depende do e-mail).
    try:
        registro = incluir_orcamento_painel(pedido, meio_envio_da_rota("E-mail", pedido))
    except OSError as erro:
        print("email: painel não gravado (%s)" % erro, file=sys.stderr, flush=True)
        registro = None
    if not registro:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível registrar o orçamento. Tente novamente ou use o WhatsApp."}, 500)
        return
    if registro.get("repetido"):
        # O primeiro pedido já gravou e está mandando este e-mail.
        escrever_json(saida, {"ok": True, "id": registro["id"], "pdfId": str(registro.get("pdfId") or "")})
        return
    chave = variavel_sem_aspas("RESEND_API_KEY")
    if not chave:
        # Painel já está Recebido; o cliente vê o registro mesmo sem Resend local.
        registrar_metrica(registro)
        escrever_json(saida, {
            "ok": True,
            "id": registro["id"],
            "pdfId": str(registro.get("pdfId") or ""),
            "emailEnviado": False,
            "aviso": "Orçamento registrado. Envio por e-mail indisponível no momento; use o WhatsApp se precisar reenviar o PDF.",
        })
        return
    texto, corpo = mensagem_orcamento_email(nome, pedido)
    payload = {
        "from": remetente_email(),
        "to": [destino],
        "subject": "Seu pedido de orçamento - Gigaeletro",
        "html": corpo,
        "text": texto,
        "attachments": [{"filename": EMAIL_ARQUIVO, "content": base64.b64encode(conteudo).decode("ascii")}],
    }
    copias = [email for email in emails_copia_admin() if email.lower() != destino.lower()]
    if copias:
        payload["bcc"] = copias
    if emails_copia_admin():
        payload["reply_to"] = emails_copia_admin()[0]
    try:
        retorno = disparar_resend(chave, payload)
    except urllib.error.HTTPError as erro:
        detalhe = erro.read(600).decode("utf-8", "replace")
        print("email: Resend recusou (%s) %s" % (erro.code, detalhe), file=sys.stderr, flush=True)
        # Mantém Recebido no painel (igual ao WhatsApp); só avisa que o e-mail falhou.
        registrar_metrica(registro)
        mensagem = "Orçamento registrado, mas o e-mail não foi enviado. Tente novamente ou use o WhatsApp."
        if erro.code in (401, 403, 422):
            mensagem = "Orçamento registrado. Envio por e-mail indisponível no momento. Use o WhatsApp."
        escrever_json(saida, {
            "ok": True,
            "id": registro["id"],
            "pdfId": str(registro.get("pdfId") or ""),
            "emailEnviado": False,
            "aviso": mensagem,
        })
        return
    except (urllib.error.URLError, OSError, ValueError) as erro:
        print("email: falha ao falar com o Resend (%s)" % erro, file=sys.stderr, flush=True)
        registrar_metrica(registro)
        escrever_json(saida, {
            "ok": True,
            "id": registro["id"],
            "pdfId": str(registro.get("pdfId") or ""),
            "emailEnviado": False,
            "aviso": "Orçamento registrado, mas o e-mail não foi enviado. Tente novamente ou use o WhatsApp.",
        })
        return
    registrar_metrica(registro)
    escrever_json(saida, {"ok": True, "id": registro["id"], "pdfId": registro["pdfId"], "emailId": str(retorno.get("id") or ""), "emailEnviado": True})


def desfazer_orcamento_email(registro):
    # O cliente vai tentar de novo ou usar o WhatsApp; manter o registro duplicaria o orçamento no painel.
    try:
        if registro.get("voz_anterior"):
            # O envio tinha assumido a lista de voz: ela volta como estava, em vez de sumir do painel.
            devolver_orcamento_painel(registro["voz_anterior"])
        else:
            remover_orcamento_painel(registro["id"])
    except OSError as erro:
        print("email: orçamento %s ficou no painel sem o e-mail (%s)" % (registro["id"], erro), file=sys.stderr, flush=True)


def linha_auditoria(dados):
    linha = {campo: str(dados.get(campo) or "") for campo in CAMPOS_AUDITORIA}
    if not linha["id_visitante"] and linha["id_sessao"]:
        linha["id_visitante"] = linha["id_sessao"]
    if not linha["id_visitante"]:
        linha["id_visitante"] = chave_acesso_dia(dados)
    telefone = apenas_digitos(linha.get("telefone"))
    linha["telefone"] = telefone if len(telefone) >= 10 else ""
    linha["email"] = email_lead(linha.get("email"))
    linha["cep"] = cep_lead(linha.get("cep"))
    linha["nome"] = nome_lead(linha.get("nome"))
    linha["contactado"] = lead_contactado(dados.get("contactado"))
    linha["contactado_em"] = str(dados.get("contactado_em") or "").strip()
    return linha


def deduplicar_linhas_acesso(linhas):
    """1 lead por contato (telefone ou e-mail) + dia."""
    por_contato = {}
    for dados in linhas:
        atual = normalizar_registro_acesso(dados)
        if not atual:
            continue
        chave = str(atual.get("data_hora") or "")[:10] + "|" + chave_acesso_dia(atual)
        if not chave.endswith("|") and chave.split("|", 1)[-1]:
            anterior = por_contato.get(chave)
            if anterior is None or str(atual.get("data_hora") or "") >= str(anterior.get("data_hora") or ""):
                por_contato[chave] = atual
    return list(por_contato.values())


def contar_acessos_unicos(linhas):
    """Únicos a partir dos registros já deduplicados: sempre únicos <= acessos."""
    visitantes = {
        str(item.get("id_visitante") or item.get("id_sessao") or "").strip()
        for item in linhas
        if str(item.get("id_visitante") or item.get("id_sessao") or "").strip()
    }
    return len(linhas), len(visitantes)


def auditoria_redis(datas):
    bruto = []
    for dia in datas:
        bruto.extend(ler_acessos_do_dia_redis(dia))
    bruto = deduplicar_linhas_acesso(bruto)
    bruto.sort(key=lambda item: str(item.get("data_hora") or ""), reverse=True)
    total, unicas = contar_acessos_unicos(bruto)
    return [linha_auditoria(dados) for dados in bruto[:ACESSOS_LISTA]], total, unicas


def auditoria_sqlite(datas):
    conn = conectar_acessos()
    try:
        linhas = conn.execute(
            "SELECT data_hora, nome, telefone, email, cep, dispositivo, contactado, contactado_em, "
            "id_sessao, id_visitante, ip_anonimizado "
            "FROM acessos_log WHERE data_hora >= ? ORDER BY data_hora DESC, id DESC",
            (datas[-1],),
        ).fetchall()
    finally:
        conn.close()
    bruto = deduplicar_linhas_acesso([dict(linha) for linha in linhas])
    bruto.sort(key=lambda item: str(item.get("data_hora") or ""), reverse=True)
    total, unicas = contar_acessos_unicos(bruto)
    return [linha_auditoria(dados) for dados in bruto[:ACESSOS_LISTA]], total, unicas


def auditoria_acessos(dias=ACESSOS_DIAS):
    hoje = agora_painel().date()
    datas = [(hoje - timedelta(days=atras)).isoformat() for atras in range(dias)]
    if endereco_redis():
        registros, total, unicas = auditoria_redis(datas)
        armazenamento = "redis"
    elif em_vercel():
        registros, total, unicas = [], 0, 0
        armazenamento = "nenhum"
    else:
        registros, total, unicas = auditoria_sqlite(datas)
        armazenamento = "sqlite"
    registros.sort(key=lambda linha: linha["data_hora"], reverse=True)
    return {
        "sessoesUnicas": unicas,
        "totalAcessos": total,
        "registros": registros,
        "limiteLista": ACESSOS_LISTA,
        "armazenamento": armazenamento,
    }


def responder_metricas_acesso(saida):
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
        return
    try:
        pedido = int(parametro_consulta(saida.path, "dias") or ACESSOS_DIAS)
    except ValueError:
        pedido = ACESSOS_DIAS
    # "Tudo" (0) cobre o prazo em que os registros diários ainda existem no Redis.
    limite = ACESSOS_EXPIRA // (24 * 60 * 60)
    dias = limite if pedido <= 0 else min(pedido, limite)
    try:
        dados = auditoria_acessos(dias)
        dados["periodoDias"] = 0 if pedido <= 0 else dias
    except Exception as erro:
        print("acessos: falha ao resumir (%s)" % erro, file=sys.stderr, flush=True)
        escrever_json(saida, {"ok": False, "erro": "Não foi possível ler os acessos."}, 500)
        return
    dados["ok"] = True
    escrever_json(saida, dados)


def limpar_acessos():
    """Apaga o rastreamento: hashes novos, logs legados e índices de cada dia; localmente, a tabela."""
    if endereco_redis():
        hoje = agora_painel().date()
        chaves = []
        for atras in range(-1, ACESSOS_EXPIRA // (24 * 60 * 60) + 2):
            dia = (hoje - timedelta(days=atras)).isoformat()
            chaves += [
                chave_hash_acessos(dia),
                ACESSOS_CHAVE + "log:" + dia,
                ACESSOS_CHAVE + "sessoes:" + dia,
                ACESSOS_CHAVE + "visitantes:" + dia,
            ]
        redis_pipeline([["DEL"] + chaves[inicio:inicio + 200] for inicio in range(0, len(chaves), 200)])
        return
    if em_vercel():
        return
    conn = conectar_acessos()
    try:
        conn.execute("DELETE FROM acessos_log")
        conn.commit()
    finally:
        conn.close()


def marcar_lead_contactado(identificador, dia=""):
    """Marca o lead do dia como contactado (WhatsApp aberto pela equipe)."""
    campo = str(identificador or "").strip()
    if not campo.startswith(("tel:", "mail:")):
        campo = chave_lead_contato(identificador, identificador)
    if not campo:
        return False
    dia = str(dia or "").strip()[:10] or agora_painel().strftime("%Y-%m-%d")
    agora = agora_painel().strftime("%Y-%m-%d %H:%M:%S")
    if endereco_redis():
        chave = chave_hash_acessos(dia)
        atual_bruto = redis_pipeline([["HGET", chave, campo]])[0]
        atual = registro_acesso_de_json(atual_bruto) if atual_bruto else None
        if not isinstance(atual, dict):
            return False
        atual["contactado"] = True
        atual["contactado_em"] = agora
        atual["id_visitante"] = campo
        atual["id_sessao"] = campo
        redis_pipeline([
            ["HSET", chave, campo, json.dumps(atual, ensure_ascii=False)],
            ["EXPIRE", chave, ACESSOS_EXPIRA],
        ])
        return True
    if em_vercel():
        return False
    conn = conectar_acessos()
    try:
        existente = conn.execute(
            "SELECT id FROM acessos_log WHERE substr(data_hora, 1, 10) = ? AND id_visitante = ? "
            "ORDER BY id DESC LIMIT 1",
            (dia, campo),
        ).fetchone()
        if not existente:
            return False
        conn.execute(
            "UPDATE acessos_log SET contactado = ?, contactado_em = ? WHERE id = ?",
            ("1", agora, existente["id"]),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def responder_limpar_acessos(saida):
    """POST /api/admin/metricas-acesso: limpar_trafego ou marcar_contactado."""
    corpo = ler_corpo(saida)
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False, "erro": "Sessão do painel expirada. Entre novamente na Área Restrita."}, 401)
        return
    try:
        dados = json.loads((corpo or b"").decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        dados = None
    if not isinstance(dados, dict):
        escrever_json(saida, {"ok": False, "erro": "Ação inválida."}, 400)
        return
    acao = str(dados.get("acao") or "").strip()
    if acao == "marcar_contactado":
        identificador = str(dados.get("id") or dados.get("id_visitante") or dados.get("chave") or "").strip()
        dia = str(dados.get("dia") or "").strip()[:10]
        try:
            ok = marcar_lead_contactado(identificador, dia)
        except Exception as erro:
            print("acessos: falha ao marcar contactado (%s)" % erro, file=sys.stderr, flush=True)
            escrever_json(saida, {"ok": False, "erro": "Não foi possível marcar o contato."}, 500)
            return
        if not ok:
            escrever_json(saida, {"ok": False, "erro": "Registro de tráfego não encontrado."}, 404)
            return
        escrever_json(saida, {"ok": True, "contactado": True})
        return
    if acao != "limpar_trafego":
        escrever_json(saida, {"ok": False, "erro": "Ação inválida."}, 400)
        return
    try:
        limpar_acessos()
    except Exception as erro:
        print("acessos: falha ao limpar (%s)" % erro, file=sys.stderr, flush=True)
        escrever_json(saida, {"ok": False, "erro": "Não foi possível limpar o histórico de tráfego."}, 500)
        return
    escrever_json(saida, {"ok": True})


IDENTIDADE_INDISPONIVEL = "Não foi possível confirmar sua identidade por aqui. Fale com a Gigaeletro pelo WhatsApp."


def responder_desafio_identidade(saida, documento, lista):
    """Primeira etapa do cliente: nunca devolve orçamentos, só as opções mascaradas de telefone e e-mail.

    Desafio e opções saem exclusivamente dos orçamentos do CPF/CNPJ pesquisado — sem OR por contato.
    """
    documento = documento_consulta_valido(documento)
    if not documento:
        escrever_json(saida, {"ok": False, "erro": "CPF ou CNPJ inválido"}, 400)
        return
    registros = filtrar_painel(lista, documento)
    registros = [item for item in registros if documento_do_orcamento(item) == documento]
    if not registros:
        escrever_json(saida, {"ok": True, "orcamentos": []})
        return
    restante = bloqueio_identidade(documento)
    if restante:
        escrever_json(saida, {"ok": False, "bloqueado": True, "erro": aviso_bloqueio_identidade(restante)}, 429)
        return
    reais = {campo: valor for campo, valor in dados_identidade(registros, documento).items() if valor}
    if not reais or not segredo_sessao():
        escrever_json(saida, {"ok": False, "erro": IDENTIDADE_INDISPONIVEL}, 409)
        return
    perguntas = {campo: opcoes_identidade(documento, campo, valor) for campo, valor in reais.items()}
    escrever_json(saida, {"ok": True, "verificacao": True, "perguntas": perguntas})


def responder_validar_identidade(saida, corpo):
    """POST /api/orcamentos com acao "validar_identidade": segunda etapa de "Meus Orçamentos"."""
    documento = documento_consulta_valido(corpo.get("documento"))
    if not documento:
        escrever_json(saida, {"ok": False, "erro": "CPF ou CNPJ inválido"}, 400)
        return
    restante = bloqueio_identidade(documento)
    if restante:
        escrever_json(saida, {"ok": False, "bloqueado": True, "erro": aviso_bloqueio_identidade(restante)}, 429)
        return
    try:
        registros = filtrar_painel(ler_painel(), documento)
        registros = [item for item in registros if documento_do_orcamento(item) == documento]
    except OSError:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível consultar os orçamentos."}, 500)
        return
    reais = {campo: valor for campo, valor in dados_identidade(registros, documento).items() if valor}
    if not reais or not segredo_sessao():
        escrever_json(saida, {"ok": False, "erro": IDENTIDADE_INDISPONIVEL}, 409)
        return
    # A tentativa é contada antes de conferir: pedidos em paralelo não passam todos pela verificação acima.
    tentativa, prazo = contador_identidade(documento, incrementar=True)
    if tentativa > KBA_TENTATIVAS:
        escrever_json(saida, {"ok": False, "bloqueado": True, "erro": aviso_bloqueio_identidade(prazo or KBA_BLOQUEIO)}, 429)
        return
    acertou = all(
        hmac.compare_digest(str(corpo.get(campo) or "").encode("utf-8"), valor.encode("utf-8"))
        for campo, valor in reais.items()
    )
    if acertou:
        zerar_identidade(documento)
        # Reforço final: nunca devolver orçamento de outro CPF/CNPJ.
        escrever_json(saida, {
            "ok": True,
            "orcamentos": [item for item in registros if documento_do_orcamento(item) == documento],
        })
        return
    restantes = KBA_TENTATIVAS - tentativa
    if restantes <= 0:
        escrever_json(saida, {"ok": False, "bloqueado": True, "erro": aviso_bloqueio_identidade(prazo or KBA_BLOQUEIO)}, 429)
        return
    escrever_json(saida, {
        "ok": False,
        "restantes": restantes,
        "erro": "Os dados selecionados não conferem. Resta%s %d tentativa%s." % (
            "m" if restantes > 1 else "", restantes, "s" if restantes > 1 else ""),
    }, 403)


def responder_orcamentos(saida):
    if saida.command == "GET":
        admin = token_valido(cookie_de(saida.headers.get("Cookie")))
        documento = parametro_consulta(saida.path, "documento") or parametro_consulta(saida.path, "cpf_cnpj")
        if not admin and not documento_consulta_valido(documento):
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        try:
            lista = ler_painel()
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível ler os orçamentos."}, 500)
            return
        documento = apenas_digitos(documento)
        if not admin:
            responder_desafio_identidade(saida, documento_consulta_valido(documento), lista)
            return
        inicio = parametro_consulta(saida.path, "dataInicio")
        fim = parametro_consulta(saida.path, "dataFim")
        if not str(inicio or "").strip() and not str(fim or "").strip():
            unico = parametro_consulta(saida.path, "data")
            inicio = fim = unico
        lixeira = parametro_consulta(saida.path, "lixeira") == "1"
        if not lixeira:
            # Aliases aceitos pelo frontend da Área Restrita.
            lixeira = parametro_consulta(saida.path, "excluidos") == "1"
        if not lixeira:
            lixeira = parametro_consulta(saida.path, "incluir_excluidos") == "1"
        # Admin ativos: oculta A Enviar. Lixeira: devolve excluídos (ver filtrar_painel).
        somente_enviados = bool(admin) and not lixeira
        escrever_json(saida, {"ok": True, "orcamentos": filtrar_painel(lista, documento, inicio, fim, lixeira, somente_enviados)})
        return
    if saida.command == "DELETE":
        admin = token_valido(cookie_de(saida.headers.get("Cookie")))
        identificador = parametro_consulta(saida.path, "id")
        documento = documento_consulta_valido(parametro_consulta(saida.path, "documento"))
        if not admin and not documento:
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        # Cliente sem id (ou com rascunho=1): remove rascunho A Enviar vazio.
        if not admin and parametro_consulta(saida.path, "rascunho") == "1":
            try:
                excluir_rascunho_painel(documento, identificador if id_painel_valido(identificador) else "")
            except OSError:
                escrever_json(saida, {"ok": False, "erro": "Não foi possível excluir o orçamento."}, 500)
                return
            escrever_json(saida, {"ok": True})
            return
        if not id_painel_valido(identificador):
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        try:
            removido = excluir_orcamento_painel(identificador, "" if admin else documento, "gestor" if admin else "cliente")
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível excluir o orçamento."}, 500)
            return
        if removido is None:
            escrever_json(saida, {"ok": False, "erro": "Orçamento não encontrado."}, 404)
            return
        escrever_json(saida, {"ok": True})
        return
    if saida.command != "POST":
        saida.send_error(405)
        return
    bruto = ler_corpo(saida)
    if bruto is None or len(bruto) > 256 * 1024:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 400)
        return
    try:
        corpo = json.loads(bruto.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 400)
        return
    if isinstance(corpo, dict) and corpo.get("acao") == "validar_identidade":
        responder_validar_identidade(saida, corpo)
        return
    if isinstance(corpo, dict) and str(corpo.get("acao") or "").strip().lower() == "rascunho":
        itens = corpo.get("itens") if isinstance(corpo.get("itens"), list) else []
        documento = documento_consulta_valido(corpo.get("documento"))
        if not documento:
            escrever_json(saida, {"ok": False, "erro": "CPF ou CNPJ inválido"}, 400)
            return
        if len(itens) == 0:
            try:
                excluir_rascunho_painel(documento, str(corpo.get("id") or ""))
            except OSError:
                escrever_json(saida, {"ok": False, "erro": "Não foi possível atualizar o orçamento."}, 500)
                return
            escrever_json(saida, {"ok": True, "removido": True})
            return
        try:
            registro = upsert_rascunho_painel(corpo)
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 500)
            return
        if not registro:
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        escrever_json(saida, {"ok": True, "id": registro["id"], "status": STATUS_ENVIO_RASCUNHO})
        return
    if corpo.get("restaurar") is True:
        if not token_valido(cookie_de(saida.headers.get("Cookie"))):
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        try:
            restaurado = restaurar_orcamento_painel(corpo.get("id"))
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível restaurar o orçamento."}, 500)
            return
        if restaurado is None:
            escrever_json(saida, {"ok": False, "erro": "Orçamento não encontrado."}, 404)
            return
        if not restaurado:
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        escrever_json(saida, {"ok": True})
        return
    if corpo.get("atendimento") is True:
        if not token_valido(cookie_de(saida.headers.get("Cookie"))):
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        status = corpo.get("status") if "status" in corpo else None
        vendedor = corpo.get("vendedor") if "vendedor" in corpo else None
        try:
            atualizado = atualizar_atendimento_painel(corpo.get("id"), status, vendedor)
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o atendimento."}, 500)
            return
        if atualizado is None:
            escrever_json(saida, {"ok": False, "erro": "Orçamento não encontrado."}, 404)
            return
        if not atualizado:
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        escrever_json(saida, {"ok": True})
        return
    if str(corpo.get("tipo") or "").strip().lower() == "intencoes":
        try:
            registro = registrar_intencoes(corpo)
        except (OSError, ValueError):
            escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 500)
            return
        if not registro:
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        escrever_json(saida, {
            "ok": True,
            "id": registro.get("id") or "",
            "pdfId": registro.get("pdfId") or "",
            "status": STATUS_ENVIO_RASCUNHO,
        })
        return
    try:
        registro = incluir_orcamento_painel(corpo, meio_envio_da_rota("WhatsApp", corpo))
    except OSError:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 500)
        return
    if not registro:
        escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
        return
    if not registro.get("repetido"):
        registrar_metrica(registro)
    escrever_json(saida, {
        "ok": True,
        "id": registro["id"],
        "status": registro.get("status") or status_atendimento_padrao(),
    })


def responder_orcamento_pdf(saida):
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível guardar o PDF."}, 400)
        return
    tipo = saida.headers.get("Content-Type", "")
    nome = parametro_consulta(saida.path, "nome")
    arquivo = corpo
    if "multipart/form-data" in tipo.lower():
        campos, arquivos = ler_campos_formulario(tipo, corpo)
        if not cliente_orcamento_valido(campos):
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        nome = campos.get("nome") or nome
        arquivo = arquivos.get("arquivo") or b""
    try:
        ident = guardar_pdf(nome, arquivo)
    except (ValueError, OSError):
        escrever_json(saida, {"ok": False, "erro": "Não foi possível guardar o PDF."}, 400)
        return
    escrever_json(saida, {
        "ok": True,
        "id": ident,
        "url": url_publica(saida, "/api/ver-pdf?id=" + ident)
    })


def robo_de_preview(saida):
    agente = (saida.headers.get("User-Agent") or "").lower()
    if "facebookexternalhit" in agente or "facebot" in agente:
        return True
    # O navegador interno do WhatsApp também cita "WhatsApp", mas se apresenta como Mozilla; o robô, não.
    return "whatsapp" in agente and "mozilla" not in agente


def enviar_pdf_cliente(saida, conteudo):
    saida.send_response(200)
    saida.send_header("Content-Type", "application/pdf")
    saida.send_header("Content-Length", str(len(conteudo)))
    saida.send_header("Content-Disposition", 'inline; filename="Pedido-de-Orcamento-Gigaeletro.pdf"')
    saida.send_header("X-Content-Type-Options", "nosniff")
    saida.send_header("Cache-Control", "private, no-store")
    saida.send_header("Vary", "User-Agent")
    saida.end_headers()
    saida.wfile.write(conteudo)


def html_preview_orcamento(ident):
    destino = "/api/ver-pdf?id=" + ident + "&arquivo=pdf"
    return (
        "<!DOCTYPE html>\n"
        '<html lang="pt-BR">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        "<title>GigaEletro – Orçamento On-Line</title>\n"
        '<meta property="og:title" content="GigaEletro – Orçamento On-Line">\n'
        '<meta property="og:description" content="Por favor, aguardando contato de um especialista. Grato!">\n'
        '<meta name="description" content="Por favor, aguardando contato de um especialista. Grato!">\n'
        '<meta property="og:type" content="website">\n'
        '<meta property="og:site_name" content="GigaEletro">\n'
        "<script>location.replace(" + json.dumps(destino) + ")</script>\n"
        "</head>\n"
        "<body>\n"
        '<p><a href="' + destino + '">Abrir o orçamento em PDF</a></p>\n'
        "</body>\n"
        "</html>\n"
    ).encode("utf-8")


def responder_ver_pdf(saida):
    ident = parametro_consulta(saida.path, "id")
    if not ident:
        saida.send_error(404)
        return
    conteudo = ler_pdf_guardado(ident)
    if not conteudo:
        saida.send_error(404)
        return
    # arquivo=pdf força o PDF: é o destino da página do robô caso um humano caia nela.
    if parametro_consulta(saida.path, "arquivo") == "pdf" or not robo_de_preview(saida):
        enviar_pdf_cliente(saida, conteudo)
        return
    pagina = html_preview_orcamento(ident)
    saida.send_response(200)
    saida.send_header("Content-Type", "text/html; charset=utf-8")
    saida.send_header("Content-Length", str(len(pagina)))
    saida.send_header("Cache-Control", "private, no-store")
    saida.send_header("Vary", "User-Agent")
    saida.end_headers()
    saida.wfile.write(pagina)


def responder_upload(saida):
    """Upload manual da planilha bruta Uniplus com auditoria 3 pontas (área restrita)."""
    responder_upload_manual_uniplus(saida)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        caminho = self.path.split("?", 1)[0]
        if caminho.endswith((".js", ".html")) or caminho.rstrip("/") == "/admin-estoque":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        caminho = self.path.split("?", 1)[0].rstrip("/") or "/"
        acao_catalogo = parametro_consulta(self.path, "acao")
        if caminho in ("/api/catalogo/verificar-atualizacao-diaria",) or (
            caminho == "/api/catalogo" and acao_catalogo == "verificar-atualizacao-diaria"
        ):
            responder_verificar_atualizacao_diaria(self)
            return
        if caminho in ("/api/catalogo/status-sync",) or (
            caminho == "/api/catalogo" and acao_catalogo == "status-sync"
        ):
            responder_status_sync(self)
            return
        if caminho == "/api/catalogo":
            responder_catalogo(self)
            return
        if caminho == "/api/sessao":
            responder_sessao(self)
            return
        if caminho == "/api/auditoria" or caminho.startswith("/api/equipe/"):
            if caminho.startswith("/api/equipe/"):
                responder_equipe_get(self)
            else:
                responder_auditoria(self)
            return
        if caminho == "/api/orcamentos":
            responder_orcamentos(self)
            return
        if caminho == "/api/dashboard-estatisticas":
            responder_dashboard(self)
            return
        if caminho == "/api/admin/metricas-acesso":
            responder_metricas_acesso(self)
            return
        if caminho == "/api/ver-pdf":
            responder_ver_pdf(self)
            return
        if caminho.startswith("/api/pdf/"):
            ident = caminho[len("/api/pdf/"):].strip("/")
            if not id_pdf_valido(ident):
                self.send_error(404)
                return
            self.path = "/api/ver-pdf?id=" + ident
            responder_ver_pdf(self)
            return
        if caminho == "/admin-estoque":
            self.path = "/admin.html"
        super().do_GET()

    def do_POST(self):
        caminho = self.path.split("?", 1)[0]
        if caminho == "/api/login":
            responder_login(self)
            return
        if caminho == "/api/logout":
            responder_logout(self)
            return
        if caminho == "/api/orcamento-pdf":
            responder_orcamento_pdf(self)
            return
        if caminho == "/api/orcamentos":
            responder_orcamentos(self)
            return
        if caminho == "/api/registrar-acesso":
            responder_registrar_acesso(self)
            return
        if caminho == "/api/admin/metricas-acesso":
            responder_limpar_acessos(self)
            return
        if caminho == "/api/enviar-orcamento-email":
            responder_enviar_orcamento_email(self)
            return
        if caminho.startswith("/api/equipe/"):
            responder_equipe_post(self)
            return
        if caminho == "/api/auditoria":
            responder_equipe_post(self)
            return
        acao_catalogo = parametro_consulta(self.path, "acao")
        if caminho in ("/api/catalogo/verificar-atualizacao-diaria",) or acao_catalogo == "verificar-atualizacao-diaria":
            responder_verificar_atualizacao_diaria(self)
            return
        if caminho in ("/api/catalogo/alerta-sync",) or acao_catalogo == "alerta-sync":
            responder_alerta_sync(self)
            return
        if caminho == "/api/sincronizar-catalogo" or (
            caminho == "/api/catalogo" and (
                parametro_consulta(self.path, "sync") == "1" or acao_catalogo == "sincronizar"
            )
        ):
            responder_sincronizar_catalogo(self)
            return
        if caminho in ("/api/catalogo", "/api/catalogo/upload-manual") or acao_catalogo == "upload-manual":
            responder_upload(self)
            return
        self.send_error(404)

    def do_DELETE(self):
        caminho = self.path.split("?", 1)[0]
        if caminho == "/api/orcamentos":
            responder_orcamentos(self)
            return
        if caminho.startswith("/api/equipe/") or caminho == "/api/auditoria":
            responder_equipe_delete(self)
            return
        self.send_error(404)

    def do_PUT(self):
        caminho = self.path.split("?", 1)[0]
        if caminho.startswith("/api/equipe/") or caminho == "/api/auditoria":
            # PUT /funcionarios com {id, nome} reaproveita o POST (acao=editar).
            responder_equipe_post(self)
            return
        self.send_error(404)


def ip_local():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as conexao:
            conexao.connect(("8.8.8.8", 80))
            return conexao.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    preparar_banco()
    endereco = ip_local()
    print("Gigaeletro no computador: http://127.0.0.1:8765/", flush=True)
    if endereco:
        print("No celular, na mesma rede Wi-Fi: http://%s:8765/" % endereco, flush=True)
    else:
        print("No celular, use o IP deste computador na rede Wi-Fi, por exemplo http://192.168.0.10:8765/", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
