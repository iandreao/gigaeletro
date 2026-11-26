# -*- coding: utf-8 -*-
"""Robô local: Origem .xls/.xlsx -> CSV limpo -> POST /api/sincronizar-catalogo (3 pontas, diferença ZERO)."""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

try:
    import openpyxl
except ImportError:
    print("Instale as dependências: pip install -r requirements-sync.txt", file=sys.stderr)
    raise SystemExit(1)

try:
    import xlrd
except ImportError:
    print("Instale as dependências: pip install -r requirements-sync.txt", file=sys.stderr)
    raise SystemExit(1)

try:
    import requests
except ImportError:
    print("Instale as dependências: pip install -r requirements-sync.txt", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "logs"
CSV_EXPORT = LOGS / "ultimo_catalogo_exportado.csv"
LOG_FILE = LOGS / "sync_catalogo.log"
CENTAVO = Decimal("0.01")
TIPO_REVEND = re.compile(r"^00(\s*-|\b)", re.I)
PADRAO_ESTOQUE = re.compile(r"^estoque\s+.+\.xlsx?$", re.I)
RE_GERADO = re.compile(
    r"Gerado\s+em\s+(\d{2}/\d{2}/(?:\d{2}|\d{4}))(?:\s+(\d{2}:\d{2}:\d{2}))?",
    re.I,
)
TITULOS_ESPERADOS = {
    0: ("Código", ("codigo",)),
    1: ("Nome", ("nome",)),
    3: ("Preço Unit", ("preco unit",)),
    4: ("Estoque", ("estoque",)),
    5: ("Tipo de produto", ("tipo de produto",)),
}
MSG_CRIAR_PASTA = (
    "Crie a pasta C:\\EstoqueProdutos e salve nela a planilha exportada do Uniplus "
    "(Estoque *.xls / *.xlsx)."
)


class ValidacaoPlanilhaErro(Exception):
    def __init__(self, tipo: str, mensagem: str, detalhe: str = ""):
        super().__init__(mensagem)
        self.tipo = tipo
        self.detalhe = detalhe
        self.mensagem = mensagem


def log(msg: str) -> None:
    linha = "[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(linha, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as arq:
        arq.write(linha + "\n")


def carregar_env_local() -> None:
    env = ROOT / ".env.local"
    if not env.is_file():
        return
    for linha in env.read_text(encoding="utf-8").splitlines():
        texto = linha.strip()
        if not texto or texto.startswith("#") or "=" not in texto:
            continue
        chave, valor = texto.split("=", 1)
        chave = chave.strip()
        valor = valor.strip().strip("\"'")
        if chave and chave not in os.environ:
            os.environ[chave] = valor


def decimal_br(valor) -> Decimal:
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


def formatar(valor: Decimal) -> str:
    return format(valor.quantize(CENTAVO, rounding=ROUND_HALF_UP), "f")


def limpar_codigo(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float):
        if valor.is_integer():
            return str(int(valor))
        texto = format(valor, "f").rstrip("0").rstrip(".")
    else:
        texto = str(valor).strip()
    # Remove pontos de milhar e espaços; mantém só dígitos.
    return re.sub(r"[^\d]", "", texto)


PASTA_ORIGEM_PRINCIPAL = Path(r"C:\EstoqueProdutos")
PASTA_ORIGEM_FALLBACK = Path.home() / "Documents" / "EstoqueProdutos"


def resolver_pasta_origem(pasta_arg: str | None) -> Path:
    """Prioriza C:\\EstoqueProdutos; fallback Documents\\EstoqueProdutos."""
    if pasta_arg:
        informada = Path(pasta_arg)
        if informada.is_dir():
            return informada
        raise FileNotFoundError(
            "Pasta de origem inexistente: %s\n%s" % (informada, MSG_CRIAR_PASTA)
        )
    if PASTA_ORIGEM_PRINCIPAL.is_dir():
        return PASTA_ORIGEM_PRINCIPAL
    if PASTA_ORIGEM_FALLBACK.is_dir():
        return PASTA_ORIGEM_FALLBACK
    raise FileNotFoundError(
        "Pasta de origem inexistente.\n%s\n(Fallback também aceito: %s)"
        % (MSG_CRIAR_PASTA, PASTA_ORIGEM_FALLBACK)
    )


def _eh_planilha_estoque(nome: str) -> bool:
    lower = nome.lower()
    if not (lower.endswith(".xls") or lower.endswith(".xlsx")):
        return False
    return lower.startswith("estoque")


def achar_planilha(pasta: Path, arquivo: str | None) -> Path:
    if arquivo:
        caminho = Path(arquivo)
        if not caminho.is_file():
            raise FileNotFoundError("Arquivo não encontrado: %s" % caminho)
        return caminho
    if not pasta.is_dir():
        raise FileNotFoundError(
            "Pasta de origem inexistente: %s\n%s" % (pasta, MSG_CRIAR_PASTA)
        )
    candidatos = [
        item for item in pasta.iterdir()
        if item.is_file() and (PADRAO_ESTOQUE.match(item.name) or _eh_planilha_estoque(item.name))
    ]
    if not candidatos:
        raise FileNotFoundError(
            "Nenhum Estoque *.xls / *.xlsx em %s\n"
            "Salve a planilha exportada do Uniplus em C:\\EstoqueProdutos." % pasta
        )
    candidatos.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidatos[0]


def celula(linha, indice, padrao=""):
    if indice < 0 or indice >= len(linha):
        return padrao
    return linha[indice]


def _ler_linhas_xlsx(caminho: Path):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    try:
        ws = wb.active
        return list(ws.iter_rows(values_only=True))
    finally:
        wb.close()


def _ler_linhas_xls(caminho: Path):
    livro = xlrd.open_workbook(str(caminho), formatting_info=False)
    folha = livro.sheet_by_index(0)
    linhas = []
    for r in range(folha.nrows):
        linhas.append(tuple(folha.cell_value(r, c) for c in range(folha.ncols)))
    return linhas


def agora_sp() -> datetime:
    if ZoneInfo is not None:
        return datetime.now(ZoneInfo("America/Sao_Paulo"))
    return datetime.now(timezone(timedelta(hours=-3)))


def normalizar_titulo(valor) -> str:
    texto = unicodedata.normalize("NFD", str(valor or ""))
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    texto = re.sub(r"\s+", " ", texto).strip().lower()
    if texto.endswith("."):
        texto = texto[:-1].rstrip()
    return texto


def parse_data_carimbo(texto_data: str) -> date:
    partes = str(texto_data or "").strip().split("/")
    if len(partes) != 3:
        raise ValueError("data")
    dia, mes, ano = int(partes[0]), int(partes[1]), int(partes[2])
    if ano < 100:
        ano += 2000
    return date(ano, mes, dia)


def extrair_carimbo(linhas):
    for linha in reversed(list(linhas or [])):
        if not linha:
            continue
        textos = [str(celula(list(linha), 0) or "").strip()]
        textos.append(" ".join(str(c or "").strip() for c in linha if str(c or "").strip()))
        for texto in textos:
            match = RE_GERADO.search(texto or "")
            if not match:
                continue
            carimbo = re.sub(r"\s+", " ", match.group(0).strip())
            return carimbo, match.group(1)
    return None, None


def validar_data_geracao(linhas):
    hoje = agora_sp().date()
    hoje_txt = hoje.strftime("%d/%m/%Y")
    carimbo, data_txt = extrair_carimbo(linhas)
    if not carimbo or not data_txt:
        raise ValidacaoPlanilhaErro(
            "data_invalida",
            "Carimbo de geração não encontrado (Gerado em DD/MM/AA HH:MM:SS). Hoje: %s." % hoje_txt,
            "(carimbo não encontrado)",
        )
    try:
        data_arquivo = parse_data_carimbo(data_txt)
    except ValueError as erro:
        raise ValidacaoPlanilhaErro(
            "data_invalida",
            "Data do carimbo inválida: %s. Hoje: %s." % (carimbo, hoje_txt),
            carimbo,
        ) from erro
    if data_arquivo != hoje:
        raise ValidacaoPlanilhaErro(
            "data_invalida",
            "Planilha não é de hoje. Carimbo: %s. Hoje (America/Sao_Paulo): %s." % (carimbo, hoje_txt),
            carimbo,
        )
    return carimbo


def achar_cabecalho(linhas):
    for indice, linha in enumerate(list(linhas or [])[:40]):
        if normalizar_titulo(celula(list(linha or []), 0)) == "codigo":
            return indice
    return -1


def validar_titulos(linhas):
    indice = achar_cabecalho(linhas)
    if indice < 0:
        raise ValidacaoPlanilhaErro(
            "estrutura_invalida",
            'Cabeçalho não encontrado. Esperado Coluna 1 "Código".',
            'Coluna 1: esperado "Código"',
        )
    linha = list(linhas[indice] or [])
    divergencias = []
    for posicao, (rotulo, aceitos) in TITULOS_ESPERADOS.items():
        encontrado = str(celula(linha, posicao) or "").strip()
        if normalizar_titulo(encontrado) not in aceitos:
            divergencias.append(
                'Coluna %s: esperado "%s", encontrado "%s"'
                % (posicao + 1, rotulo, encontrado or "(vazio)")
            )
    if divergencias:
        raise ValidacaoPlanilhaErro(
            "estrutura_invalida",
            "Estrutura divergente. " + "; ".join(divergencias),
            "; ".join(divergencias),
        )
    return indice


def processar_linhas(linhas, nome_arquivo: str):
    if not linhas:
        raise ValueError("Planilha vazia.")

    carimbo = validar_data_geracao(linhas)
    inicio = validar_titulos(linhas)
    idx_codigo, idx_nome, idx_preco, idx_estoque, idx_tipo = 0, 1, 3, 4, 5

    itens = []
    descartados_tipo = 0
    descartados_estoque_zero = 0
    for bruto in linhas[inicio + 1:]:
        linha = list(bruto or [])
        codigo = limpar_codigo(celula(linha, idx_codigo))
        if not codigo:
            continue
        nome = str(celula(linha, idx_nome) or "").strip()
        if not nome:
            continue
        # Ignora totais/rodapé óbvios.
        if nome.lower().startswith(("total", "soma", "subtotal", "gerado em")):
            continue
        tipo = str(celula(linha, idx_tipo) or "").strip()
        if not TIPO_REVEND.search(tipo):
            descartados_tipo += 1
            continue
        try:
            preco = decimal_br(celula(linha, idx_preco))
            estoque = decimal_br(celula(linha, idx_estoque))
        except (InvalidOperation, ValueError, TypeError):
            continue
        if estoque <= 0:
            descartados_estoque_zero += 1
            continue
        itens.append({
            "codigo": codigo,
            "nome": nome,
            "preco": formatar(preco),
            "estoque": formatar(estoque),
        })

    if not itens:
        raise ValueError("Nenhum item elegível após filtros (tipo 00 e estoque > 0).")

    return itens, {
        "descartados_tipo": descartados_tipo,
        "descartados_estoque_zero": descartados_estoque_zero,
        "arquivo_origem": nome_arquivo,
        "carimbo_geracao": carimbo,
    }


def url_alerta(api_sync: str) -> str:
    env = (os.environ.get("CATALOGO_ALERTA_URL") or "").strip()
    if env:
        return env
    base = api_sync
    if "/api/" in base:
        base = base.split("/api/", 1)[0]
    return base.rstrip("/") + "/api/catalogo/alerta-sync"


def enviar_alerta(api_sync: str, token: str, tipo: str, detalhe: str) -> None:
    destino = url_alerta(api_sync)
    log("ALERTA %s → %s (detalhe=%s)" % (tipo, destino, detalhe))
    try:
        resp = requests.post(
            destino,
            json={"tipo": tipo, "detalhe": detalhe},
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "User-Agent": "GigaEletroSyncBot/1.0",
            },
            timeout=60,
        )
        log("Resposta alerta HTTP %s: %s" % (resp.status_code, resp.text[:500]))
    except requests.RequestException as erro:
        log("ERRO ao enviar alerta: %s" % erro)


def ler_origem(caminho: Path):
    ext = caminho.suffix.lower()
    if ext == ".xls":
        log("Lendo com xlrd (.xls): %s" % caminho.name)
        linhas = _ler_linhas_xls(caminho)
    elif ext == ".xlsx":
        log("Lendo com openpyxl (.xlsx): %s" % caminho.name)
        linhas = _ler_linhas_xlsx(caminho)
    else:
        raise ValueError("Extensão não suportada: %s (use .xls ou .xlsx)" % ext)
    return processar_linhas(linhas, caminho.name)


def totais(itens):
    qtd = len(itens)
    soma_preco = sum((decimal_br(i["preco"]) for i in itens), Decimal("0.00")).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    soma_estoque = sum((decimal_br(i["estoque"]) for i in itens), Decimal("0.00")).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    return qtd, soma_preco, soma_estoque


def salvar_csv(itens, destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", encoding="utf-8", newline="") as arq:
        escritor = csv.writer(arq, delimiter=";")
        escritor.writerow(["codigo", "nome", "preco", "estoque"])
        for item in itens:
            escritor.writerow([item["codigo"], item["nome"], item["preco"], item["estoque"]])


def ler_csv(destino: Path):
    itens = []
    with destino.open("r", encoding="utf-8", newline="") as arq:
        leitor = csv.DictReader(arq, delimiter=";")
        for linha in leitor:
            codigo = limpar_codigo(linha.get("codigo"))
            nome = str(linha.get("nome") or "").strip()
            if not codigo or not nome:
                continue
            itens.append({
                "codigo": codigo,
                "nome": nome,
                "preco": formatar(decimal_br(linha.get("preco"))),
                "estoque": formatar(decimal_br(linha.get("estoque"))),
            })
    return itens


def tabela_batimento(origem, csv_tot, vercel=None) -> str:
    linhas = [
        "",
        "Batimento 3 pontas (diferença deve ser 0.00)",
        "-" * 78,
        "%-14s %12s %14s %14s %12s" % ("Métrica", "Origem", "CSV", "Vercel", "Diferença"),
        "-" * 78,
    ]
    metricas = [
        ("qtd_itens", origem[0], csv_tot[0], None if vercel is None else vercel[0]),
        ("soma_preco", origem[1], csv_tot[1], None if vercel is None else vercel[1]),
        ("soma_estoque", origem[2], csv_tot[2], None if vercel is None else vercel[2]),
    ]
    for nome, o, c, v in metricas:
        if isinstance(o, Decimal):
            o_txt, c_txt = formatar(o), formatar(c)
            d_oc = formatar(o - c)
        else:
            o_txt, c_txt = str(o), str(c)
            d_oc = str(o - c)
        if v is None:
            v_txt, d_ov = "-", d_oc
        elif isinstance(v, Decimal):
            v_txt = formatar(v)
            d_ov = formatar(o - v)
        else:
            v_txt = str(v)
            d_ov = str(int(o) - int(v))
        # Diferença reportada: Origem vs Vercel quando houver; senão Origem vs CSV.
        dif = d_ov if v is not None else d_oc
        linhas.append("%-14s %12s %14s %14s %12s" % (nome, o_txt, c_txt, v_txt, dif))
    linhas.append("-" * 78)
    return "\n".join(linhas)


def main() -> int:
    carregar_env_local()
    parser = argparse.ArgumentParser(description="Sincroniza estoque Uniplus -> CSV -> Vercel Blob")
    parser.add_argument("--arquivo", help="Caminho do .xls / .xlsx de origem")
    parser.add_argument(
        "--pasta",
        default=None,
        help="Pasta com Estoque *.xls / *.xlsx (padrão: C:\\EstoqueProdutos; fallback: Documents\\EstoqueProdutos)",
    )
    parser.add_argument(
        "--api",
        default=os.environ.get("CATALOGO_SYNC_URL") or "https://www.gigaeletro.com.br/api/sincronizar-catalogo",
        help="URL do endpoint de sincronização",
    )
    parser.add_argument("--token", default=os.environ.get("CATALOGO_SYNC_TOKEN") or "", help="Bearer token")
    args = parser.parse_args()

    token = (args.token or "").strip()
    if not token:
        log("ERRO: defina CATALOGO_SYNC_TOKEN no .env.local ou passe --token")
        return 2

    try:
        pasta_origem = resolver_pasta_origem(args.pasta)
        origem_path = achar_planilha(pasta_origem, args.arquivo)
    except FileNotFoundError as erro:
        log("ERRO: %s" % erro)
        return 2

    log("Pasta de origem: %s" % pasta_origem)
    log("Arquivo de origem: %s" % origem_path)
    try:
        itens, meta = ler_origem(origem_path)
    except ValidacaoPlanilhaErro as erro:
        log("ABORTADO validação (%s): %s" % (erro.tipo, erro.mensagem))
        enviar_alerta(args.api, token, erro.tipo, erro.detalhe)
        return 6
    except Exception as erro:
        log("ERRO ao ler origem: %s" % erro)
        return 2

    qtd_o, soma_po, soma_eo = totais(itens)
    log(
        "Origem elegível: qtd=%s soma_preco=%s soma_estoque=%s (descartados tipo=%s estoque0=%s)"
        % (qtd_o, formatar(soma_po), formatar(soma_eo), meta["descartados_tipo"], meta["descartados_estoque_zero"])
    )

    salvar_csv(itens, CSV_EXPORT)
    log("CSV exportado: %s" % CSV_EXPORT)
    itens_csv = ler_csv(CSV_EXPORT)
    qtd_c, soma_pc, soma_ec = totais(itens_csv)

    log(tabela_batimento((qtd_o, soma_po, soma_eo), (qtd_c, soma_pc, soma_ec)))
    if qtd_c == 0 or qtd_o != qtd_c or soma_po != soma_pc or soma_eo != soma_ec:
        log("ABORTADO: diferença diferente de zero entre Origem e CSV.")
        return 3

    payload = {
        "itens": itens_csv,
        "auditoria": {
            "qtd_itens": qtd_c,
            "soma_preco": formatar(soma_pc),
            "soma_estoque": formatar(soma_ec),
            "descartados_tipo": meta["descartados_tipo"],
            "descartados_estoque_zero": meta["descartados_estoque_zero"],
            "arquivo_origem": meta["arquivo_origem"],
            "data_geracao": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    }
    log("Enviando para %s (%s itens)..." % (args.api, qtd_c))
    try:
        resp = requests.post(
            args.api,
            json=payload,
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "User-Agent": "GigaEletroSyncBot/1.0",
            },
            timeout=180,
        )
    except requests.RequestException as erro:
        log("ERRO de rede: %s" % erro)
        return 4

    if resp.status_code != 200:
        log("ERRO HTTP %s: %s" % (resp.status_code, resp.text[:1000]))
        return 4

    try:
        corpo = resp.json()
    except ValueError:
        log("ERRO: resposta não-JSON: %s" % resp.text[:500])
        return 4

    va = (corpo or {}).get("vercel_auditoria") or {}
    try:
        qtd_v = int(va.get("qtd_itens"))
        soma_pv = decimal_br(va.get("soma_preco"))
        soma_ev = decimal_br(va.get("soma_estoque"))
    except (TypeError, ValueError, InvalidOperation):
        log("ERRO: vercel_auditoria inválida: %s" % va)
        return 5

    log(tabela_batimento((qtd_o, soma_po, soma_eo), (qtd_c, soma_pc, soma_ec), (qtd_v, soma_pv, soma_ev)))
    if qtd_o != qtd_v or soma_po != soma_pv or soma_eo != soma_ev or qtd_c != qtd_v or soma_pc != soma_pv or soma_ec != soma_ev:
        log("ABORTADO: diferença diferente de zero entre Origem/CSV/Vercel.")
        return 5

    log("OK: diferença ZERO nas 3 pontas. Sync concluída.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
