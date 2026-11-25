# -*- coding: utf-8 -*-
"""Robô local: Origem .xlsx -> CSV limpo -> POST /api/sincronizar-catalogo (3 pontas, diferença ZERO)."""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

try:
    import openpyxl
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
PADRAO_XLSX = re.compile(r"^estoque\s+.+\.xlsx$", re.I)


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
            "Pasta de origem inexistente: %s\n"
            "Crie a pasta C:\\EstoqueProdutos e salve nela a planilha exportada do Uniplus (Estoque *.xlsx)."
            % informada
        )
    if PASTA_ORIGEM_PRINCIPAL.is_dir():
        return PASTA_ORIGEM_PRINCIPAL
    if PASTA_ORIGEM_FALLBACK.is_dir():
        return PASTA_ORIGEM_FALLBACK
    raise FileNotFoundError(
        "Pasta de origem inexistente.\n"
        "Crie a pasta C:\\EstoqueProdutos e salve nela a planilha exportada do Uniplus (Estoque *.xlsx).\n"
        "(Fallback também aceito: %s)" % PASTA_ORIGEM_FALLBACK
    )


def achar_xlsx(pasta: Path, arquivo: str | None) -> Path:
    if arquivo:
        caminho = Path(arquivo)
        if not caminho.is_file():
            raise FileNotFoundError("Arquivo não encontrado: %s" % caminho)
        return caminho
    if not pasta.is_dir():
        raise FileNotFoundError(
            "Pasta de origem inexistente: %s\n"
            "Crie a pasta C:\\EstoqueProdutos e salve nela a planilha exportada do Uniplus (Estoque *.xlsx)."
            % pasta
        )
    candidatos = [
        item for item in pasta.iterdir()
        if item.is_file() and PADRAO_XLSX.match(item.name)
    ]
    if not candidatos:
        # Aceita também "Estoque*.xlsx" sem espaço rígido.
        candidatos = [
            item for item in pasta.iterdir()
            if item.is_file() and item.suffix.lower() == ".xlsx" and item.name.lower().startswith("estoque")
        ]
    if not candidatos:
        raise FileNotFoundError(
            "Nenhum Estoque *.xlsx em %s\n"
            "Salve a planilha exportada do Uniplus em C:\\EstoqueProdutos." % pasta
        )
    candidatos.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidatos[0]


def celula(linha, indice, padrao=""):
    if indice < 0 or indice >= len(linha):
        return padrao
    return linha[indice]


def ler_origem_xlsx(caminho: Path):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    try:
        ws = wb.active
        linhas = list(ws.iter_rows(values_only=True))
    finally:
        wb.close()

    if not linhas:
        raise ValueError("Planilha vazia.")

    # Detecta cabeçalho por nomes; senão assume layout Uniplus posicional.
    inicio = 0
    idx_codigo, idx_nome, idx_preco, idx_estoque, idx_tipo = 0, 1, 3, 4, 5
    cab = [str(c or "").strip().lower() for c in linhas[0]]
    if any("codigo" in c or "código" in c for c in cab):
        inicio = 1

        def achar(*nomes):
            for i, c in enumerate(cab):
                for n in nomes:
                    if n in c:
                        return i
            return -1

        idx_codigo = achar("codigo", "código")
        idx_nome = achar("nome", "descricao", "descrição", "produto")
        idx_preco = achar("preço unit", "preco unit", "prvenda", "pr venda", "preço", "preco")
        idx_estoque = achar("estoque")
        idx_tipo = achar("tipo de produto", "tipo produto", "tipo")
        if idx_codigo < 0 or idx_nome < 0:
            raise ValueError("Cabeçalho sem Código/Nome.")
        # Layout 4 colunas (Código;Nome;Estoque;PrVenda) sem tipo.
        if idx_tipo < 0 and idx_estoque >= 0 and idx_preco >= 0:
            idx_tipo = -1
        elif idx_tipo < 0:
            # Posicional Uniplus: 1=código 2=nome 4=preço 5=estoque 6=tipo
            idx_codigo, idx_nome, idx_preco, idx_estoque, idx_tipo = 0, 1, 3, 4, 5

    itens = []
    descartados_tipo = 0
    descartados_estoque_zero = 0
    for bruto in linhas[inicio:]:
        linha = list(bruto or [])
        codigo = limpar_codigo(celula(linha, idx_codigo))
        if not codigo:
            continue
        nome = str(celula(linha, idx_nome) or "").strip()
        if not nome:
            continue
        # Ignora totais/rodapé óbvios.
        if nome.lower().startswith(("total", "soma", "subtotal")):
            continue
        tipo = str(celula(linha, idx_tipo) or "").strip() if idx_tipo >= 0 else "00 - Mercadoria para revenda"
        if idx_tipo >= 0 and not TIPO_REVEND.search(tipo):
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
        "arquivo_origem": caminho.name,
    }


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
    parser.add_argument("--arquivo", help="Caminho do .xlsx de origem")
    parser.add_argument(
        "--pasta",
        default=None,
        help="Pasta com Estoque *.xlsx (padrão: C:\\EstoqueProdutos; fallback: Documents\\EstoqueProdutos)",
    )
    parser.add_argument(
        "--api",
        default=os.environ.get("CATALOGO_SYNC_URL") or "https://gigaeletro.com.br/api/sincronizar-catalogo",
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
        origem_path = achar_xlsx(pasta_origem, args.arquivo)
    except FileNotFoundError as erro:
        log("ERRO: %s" % erro)
        return 2

    log("Pasta de origem: %s" % pasta_origem)
    log("Lendo origem: %s" % origem_path)
    itens, meta = ler_origem_xlsx(origem_path)
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
            "data_geracao": datetime.utcnow().isoformat() + "Z",
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
