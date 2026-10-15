"""Servidor local da Gigaeletro e núcleo das funções Python na Vercel.

O catálogo fica na tabela produtos. Processar a planilha substitui a tabela
inteira numa transação: DELETE FROM produtos, leitura do arquivo e inserção
em lote. Se a leitura falhar, o ROLLBACK devolve o catálogo anterior.

No computador o banco é data/gigaeletro.db. Na Vercel o disco do projeto é
somente leitura, então o SQLite e a auditoria ficam em /tmp e o catálogo
publicado (data/catalogo.json) continua sendo a fonte das 5476 linhas.
"""
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
FONTE_CATALOGO = ROOT / "data" / "catalogo.json"
SENHA = "GigaAdmin2026"
COOKIE_ADMIN = "gigaeletro_admin"
SEGREDO_SESSAO = b"gigaeletro-sessao-local"
SESSAO_SEGUNDOS = 12 * 60 * 60
LIMITE_ENVIO = 30 * 1024 * 1024
LIMITE_PDF = 2 * 1024 * 1024
VALIDADE_PDF = 7 * 24 * 60 * 60
PDFS = {}
PDF_LOCK = threading.Lock()
PAINEL_LOCK = threading.Lock()
PAINEL_BLOB = "orcamentos/painel.json"
PAINEL_LIMITE = 2000
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
IMPORTACAO = threading.Lock()


class PlanilhaInvalida(Exception):
    pass


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


def emitir_token():
    expira = int(time.time()) + SESSAO_SEGUNDOS
    carga = f"{expira}.{secrets.token_hex(8)}"
    assinatura = hmac.new(SEGREDO_SESSAO, carga.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{carga}.{assinatura}"


def token_valido(valor):
    partes = str(valor or "").split(".")
    if len(partes) != 3:
        return False
    carga = partes[0] + "." + partes[1]
    esperado = hmac.new(SEGREDO_SESSAO, carga.encode("utf-8"), hashlib.sha256).hexdigest()
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


def decodificar(conteudo):
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
    amostra = "\n".join(texto.split("\n")[:20])
    delimitador = ";" if amostra.count(";") > amostra.count(",") else ","
    return [list(linha) for linha in csv.reader(io.StringIO(texto), delimiter=delimitador)]


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
        raise PlanilhaInvalida(
            "Este .xls antigo não foi lido. Salve como .xlsx ou CSV. O catálogo anterior foi mantido."
        )
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


def ler_formulario(content_type, corpo):
    match = re.search(r"boundary=([^;]+)", content_type or "", re.I)
    if not match:
        raise PlanilhaInvalida("Envie a planilha pelo botão da área restrita.")
    limite = match.group(1).strip().strip('"').encode("utf-8", "ignore")
    senha = ""
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
        if 'name="senha"' in texto:
            senha = dados.decode("utf-8", "replace").strip()
        elif "filename=" in texto:
            encontrado = re.search(r'filename="([^"]*)"', texto)
            nome = encontrado.group(1) if encontrado else "planilha.csv"
            arquivo = dados
    return senha, nome, arquivo


def escrever_json(saida, dados, status=200, extra=None):
    corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
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
        escrever_json(saida, listar_produtos())
    except Exception:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível ler o catálogo."}, 500)


def responder_sessao(saida):
    escrever_json(saida, {"ok": token_valido(cookie_de(saida.headers.get("Cookie")))})


def responder_auditoria(saida):
    if not token_valido(cookie_de(saida.headers.get("Cookie"))):
        escrever_json(saida, {"ok": False}, 401)
        return
    dados = ler_auditoria()
    dados["catalogo"] = contar_produtos()
    dados["ok"] = True
    escrever_json(saida, dados)


def responder_login(saida):
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 400)
        return
    try:
        dados = json.loads(corpo.decode("utf-8")) if corpo else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 400)
        return
    senha = str(dados.get("senha") or "").strip()
    if senha != SENHA:
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta"}, 403)
        return
    escrever_json(saida, {"ok": True}, extra=[("Set-Cookie", cabecalho_cookie(emitir_token()))])


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
    valores = parse_qs(urlparse(caminho).query)
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


def filtrar_painel(lista, data, documento):
    bruto = str(data or "").strip()
    data = normalizar_data_painel(bruto) if bruto else ""
    if bruto and not data:
        return []
    documento = apenas_digitos(documento)
    saida = []
    for item in lista:
        if data and normalizar_data_painel(item.get("data")) != data:
            continue
        if documento and str(item.get("documento") or "") != documento:
            continue
        saida.append(item)
    saida.sort(key=lambda atual: (str(atual.get("data") or ""), str(atual.get("id") or "")), reverse=True)
    return saida


def id_painel_valido(valor):
    return bool(re.fullmatch(r"[0-9]{8}-[0-9a-fA-F]{8}", str(valor or "")))


def documento_consulta_valido(documento):
    documento = apenas_digitos(documento)
    if cpf_valido(documento) or cnpj_valido(documento):
        return documento
    return ""


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


def excluir_orcamento_painel(identificador, documento=""):
    identificador = str(identificador or "")
    documento = apenas_digitos(documento)
    if not id_painel_valido(identificador):
        return False
    with PAINEL_LOCK:
        lista = ler_painel()
        alvo = next((item for item in lista if str(item.get("id") or "") == identificador), None)
        if alvo is None:
            return None
        if documento and str(alvo.get("documento") or "") != documento:
            return None
        restante = [item for item in lista if str(item.get("id") or "") != identificador]
        gravar_painel(restante)
    return True


def incluir_orcamento_painel(corpo):
    if not isinstance(corpo, dict):
        return None
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
    registro = {
        "id": hoje_painel().replace("-", "") + "-" + secrets.token_hex(4),
        "data": agora_painel().isoformat(timespec="seconds"),
        "nome": nome,
        "documento": documento,
        "telefone": formatar_telefone(telefone),
        "itens": itens,
        "total": round(sum(item["valor"] for item in itens), 2),
        "pdfId": pdf_id,
        "cliente": cliente_do_painel(corpo, nome, documento, telefone),
    }
    with PAINEL_LOCK:
        lista = ler_painel()
        lista.insert(0, registro)
        gravar_painel(lista[:PAINEL_LIMITE])
    return registro


def responder_orcamentos(saida):
    if saida.command == "GET":
        admin = token_valido(cookie_de(saida.headers.get("Cookie")))
        documento = parametro_consulta(saida.path, "documento")
        if not admin and not documento_consulta_valido(documento):
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        try:
            lista = ler_painel()
        except OSError:
            escrever_json(saida, {"ok": False, "erro": "Não foi possível ler os orçamentos."}, 500)
            return
        data = parametro_consulta(saida.path, "data") if admin else ""
        if not admin:
            documento = documento_consulta_valido(documento)
        escrever_json(saida, {"ok": True, "orcamentos": filtrar_painel(lista, data, documento)})
        return
    if saida.command == "DELETE":
        admin = token_valido(cookie_de(saida.headers.get("Cookie")))
        identificador = parametro_consulta(saida.path, "id")
        documento = documento_consulta_valido(parametro_consulta(saida.path, "documento"))
        if not admin and not documento:
            escrever_json(saida, {"ok": False, "erro": "Acesso restrito."}, 401)
            return
        if not id_painel_valido(identificador):
            escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
            return
        try:
            removido = excluir_orcamento_painel(identificador, "" if admin else documento)
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
    try:
        registro = incluir_orcamento_painel(corpo)
    except OSError:
        escrever_json(saida, {"ok": False, "erro": "Não foi possível gravar o orçamento."}, 500)
        return
    if not registro:
        escrever_json(saida, {"ok": False, "erro": "Dado Inválido"}, 400)
        return
    escrever_json(saida, {"ok": True, "id": registro["id"]})


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


def responder_ver_pdf(saida):
    ident = parametro_consulta(saida.path, "id")
    conteudo = ler_pdf_guardado(ident)
    if not conteudo:
        saida.send_error(404)
        return
    saida.send_response(200)
    saida.send_header("Content-Type", "application/pdf")
    saida.send_header("Content-Length", str(len(conteudo)))
    saida.send_header("Content-Disposition", 'inline; filename="Pedido-de-Orcamento-Gigaeletro.pdf"')
    saida.send_header("X-Content-Type-Options", "nosniff")
    saida.send_header("Cache-Control", "private, max-age=86400")
    saida.end_headers()
    saida.wfile.write(conteudo)


def responder_upload(saida):
    corpo = ler_corpo(saida)
    if corpo is None:
        escrever_json(saida, {"ok": False, "erro": "A planilha passou do tamanho aceito."}, 400)
        return
    try:
        senha, nome, arquivo = ler_formulario(saida.headers.get("Content-Type", ""), corpo or b"")
    except PlanilhaInvalida as erro:
        escrever_json(saida, {"ok": False, "erro": str(erro)}, 400)
        return
    if not arquivo or (senha != SENHA and not token_valido(cookie_de(saida.headers.get("Cookie")))):
        escrever_json(saida, {"ok": False, "erro": "Senha incorreta ou arquivo ausente."}, 403)
        return
    try:
        _produtos, resumo = substituir_catalogo(nome, arquivo)
    except PlanilhaInvalida as erro:
        escrever_json(saida, {"ok": False, "erro": str(erro)}, 400)
        return
    except Exception:
        escrever_json(saida, {"ok": False, "erro": "A leitura falhou e o catálogo anterior foi mantido."}, 400)
        return
    escrever_json(saida, resumo)


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
        if caminho == "/api/catalogo":
            responder_catalogo(self)
            return
        if caminho == "/api/sessao":
            responder_sessao(self)
            return
        if caminho == "/api/auditoria":
            responder_auditoria(self)
            return
        if caminho == "/api/orcamentos":
            responder_orcamentos(self)
            return
        if caminho == "/api/ver-pdf":
            responder_ver_pdf(self)
            return
        if caminho == "/admin-estoque":
            self.path = "/admin-estoque.html"
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
        if caminho != "/api/catalogo":
            self.send_error(404)
            return
        responder_upload(self)

    def do_DELETE(self):
        caminho = self.path.split("?", 1)[0]
        if caminho == "/api/orcamentos":
            responder_orcamentos(self)
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
