(function () {
  var SENHA_ADMIN = "GigaAdmin2026";
  var SESSAO = "gigaeletro-admin";

  var formSenha = document.querySelector("[data-admin-senha]");
  var painel = document.querySelector("[data-admin-arquivo]");
  var erro = document.querySelector("[data-admin-erro]");
  var status = document.querySelector("[data-admin-status]");
  var auditoria = document.querySelector("[data-auditoria]");
  var nomeArquivo = document.querySelector("[data-admin-arquivo-nome]");
  var processar = document.querySelector("[data-processar]");
  var input = document.querySelector("#planilha");
  var planilhaEscolhida = null;

  fetch("/api/sessao", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
    return resposta.json();
  }).then(function (corpo) {
    if (!corpo || !corpo.ok) {
      window.location.replace("/");
      return;
    }
    mostrarPainel();
  }).catch(function () {
    window.location.replace("/");
  });

  var sair = document.querySelector("[data-sair]");
  if (sair) {
    sair.addEventListener("click", function () {
      limparAuditoria();
      sessionStorage.removeItem(SESSAO);
      sessionStorage.removeItem("gigaeletro-auditoria");
      fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
        window.location.replace("/");
      });
    });
  }

  prepararDrop(document.querySelector("[data-drop-admin]"), input, function (file) {
    planilhaEscolhida = file;
    if (nomeArquivo) {
      nomeArquivo.hidden = !file;
      nomeArquivo.textContent = file ? "Arquivo selecionado: " + file.name : "";
    }
    if (processar) processar.disabled = !file;
    if (status) status.hidden = true;
  });

  if (processar) {
    processar.addEventListener("click", function () {
      if (!planilhaEscolhida) return;
      processar.disabled = true;
      if (status) {
        status.hidden = false;
        status.textContent = "Limpando o catálogo e lendo a planilha…";
      }
      var dados = new FormData();
      dados.append("senha", SENHA_ADMIN);
      dados.append("arquivo", planilhaEscolhida, planilhaEscolhida.name);
      fetch("/api/catalogo", { method: "POST", body: dados }).then(function (resposta) {
        return resposta.json().then(function (corpo) {
          if (!resposta.ok || !corpo.ok) {
            throw new Error(corpo.erro || "A leitura falhou e o catálogo anterior foi mantido.");
          }
          return corpo;
        });
      }).then(function (corpo) {
        if (status) status.hidden = true;
        mostrarAuditoria(corpo);
        planilhaEscolhida = null;
        if (nomeArquivo) nomeArquivo.hidden = true;
        if (input) input.value = "";
        processar.disabled = true;
      }).catch(function (falha) {
        if (status) {
          status.hidden = false;
          status.textContent = falha && falha.message ? falha.message : "A leitura falhou e o catálogo anterior foi mantido.";
        }
        processar.disabled = !planilhaEscolhida;
      });
    });
  }

  function mostrarPainel() {
    if (formSenha) formSenha.hidden = true;
    var area = document.querySelector("[data-area-restrita]");
    if (area) area.hidden = false;
    mostrarAba("orcamentos");
    limparAuditoria();
    preencherDataHoje();
    carregarOrcamentos();
  }

  function mostrarAba(nome) {
    document.querySelectorAll("[data-visao]").forEach(function (painelVisao) {
      painelVisao.hidden = painelVisao.getAttribute("data-visao") !== nome;
    });
    document.querySelectorAll("[data-aba]").forEach(function (botao) {
      botao.setAttribute("aria-selected", botao.getAttribute("data-aba") === nome ? "true" : "false");
    });
  }

  document.querySelectorAll("[data-aba]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      mostrarAba(botao.getAttribute("data-aba"));
    });
  });

  function limparAuditoria() {
    if (!auditoria) return;
    auditoria.querySelectorAll("strong").forEach(function (campo) {
      campo.textContent = "";
    });
    var lista = auditoria.querySelector("[data-audit-pulados]");
    if (lista) lista.innerHTML = "";
    auditoria.hidden = true;
  }

  function mostrarAuditoria(corpo) {
    if (!auditoria || !corpo) return;
    var linhas = auditoria.querySelector("[data-audit-linhas]");
    var inseridos = auditoria.querySelector("[data-audit-inseridos]");
    var quando = auditoria.querySelector("[data-audit-quando]");
    var lista = auditoria.querySelector("[data-audit-pulados]");
    var catalogo = auditoria.querySelector("[data-audit-catalogo]");
    if (catalogo) catalogo.textContent = String(corpo.catalogo != null ? corpo.catalogo : corpo.inseridos || 0);
    if (linhas) linhas.textContent = corpo.linhas_lidas != null ? String(corpo.linhas_lidas) : "—";
    if (inseridos) inseridos.textContent = corpo.inseridos != null ? String(corpo.inseridos) : "—";
    if (quando) quando.textContent = corpo.atualizado_em || "";
    if (lista) {
      var pulados = Array.isArray(corpo.pulados) ? corpo.pulados : [];
      lista.innerHTML = pulados.length
        ? pulados.map(function (item) { return "<li>" + escapar(item) + "</li>"; }).join("")
        : "<li>Nenhum.</li>";
    }
    auditoria.hidden = false;
  }

  function escapar(valor) {
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var campoDataInicio = document.querySelector("[data-gestor-data-inicio]");
  var campoDataFim = document.querySelector("[data-gestor-data-fim]");
  var campoDocumento = document.querySelector("[data-gestor-documento]");
  var listaGestor = document.querySelector("[data-gestor-lista]");
  var vazioGestor = document.querySelector("[data-gestor-vazio]");
  var detalhe = document.querySelector("[data-detalhe]");
  var detalheCorpo = document.querySelector("[data-detalhe-corpo]");
  var orcamentosAtuais = [];

  function digitosDocumento(valor) {
    return String(valor || "").replace(/\D/g, "").slice(0, 14);
  }

  function moedaPainel(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function documentoVisivel(digitos) {
    if (digitos.length === 11) {
      return digitos.slice(0, 3) + "." + digitos.slice(3, 6) + "." + digitos.slice(6, 9) + "-" + digitos.slice(9);
    }
    if (digitos.length === 14) {
      return digitos.slice(0, 2) + "." + digitos.slice(2, 5) + "." + digitos.slice(5, 8) + "/" + digitos.slice(8, 12) + "-" + digitos.slice(12);
    }
    return digitos;
  }

  function dataVisivel(iso) {
    var normal = dataParaConsulta(iso);
    var partes = String(normal || iso || "").split("-");
    if (partes.length !== 3) return iso || "";
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function dataParaConsulta(valor) {
    var texto = String(valor || "").trim();
    var br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return br[3] + "-" + br[2] + "-" + br[1];
    var iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    return "";
  }

  function dataHojeIso() {
    var formato = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return dataParaConsulta(formato.format(new Date()));
  }

  function preencherDataHoje() {
    var hoje = dataHojeIso();
    if (campoDataInicio && !campoDataInicio.value) campoDataInicio.value = hoje;
    if (campoDataFim && !campoDataFim.value) campoDataFim.value = hoje;
  }

  function iconeAcao(tipo) {
    var comum = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (tipo === "olho") {
      return '<svg ' + comum + '><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    if (tipo === "lixeira") {
      return '<svg ' + comum + '><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
    }
    return '<svg ' + comum + '><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';
  }

  function acharOrcamento(id) {
    return orcamentosAtuais.find(function (item) { return String(item.id) === String(id); }) || null;
  }

  function tabelaItens(item) {
    var linhas = (item.itens || []).map(function (produto) {
      return "<tr>" +
        "<td>" + escapar(produto.produto) + "</td>" +
        "<td>" + escapar(produto.codigo || "") + "</td>" +
        '<td class="num">' + escapar(produto.qtd) + "</td>" +
        '<td class="num">' + moedaPainel(produto.preco) + "</td>" +
        '<td class="num">' + moedaPainel(produto.valor) + "</td>" +
      "</tr>";
    }).join("");
    return '<table><thead><tr><th>Produto</th><th>Código</th><th class="num">Qtd</th><th class="num">Vlr. Unit.</th><th class="num">Valor</th></tr></thead><tbody>' +
      linhas +
      '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num">R$ ' + moedaPainel(item.total) + "</td></tr></tfoot></table>";
  }

  function htmlDetalhe(item) {
    return '<div class="gestor-detalhe-meta">' +
      "<p>" + escapar(dataVisivel(item.data)) + "</p>" +
      "<p>" + escapar(item.nome) + "</p>" +
      "<p>" + escapar(documentoVisivel(String(item.documento || ""))) + "</p>" +
      "<p>" + escapar(item.telefone) + "</p>" +
    "</div>" + tabelaItens(item);
  }

  function abrirDetalhe(item) {
    if (!detalhe || !detalheCorpo || !item) return;
    detalheCorpo.innerHTML = htmlDetalhe(item);
    detalhe.hidden = false;
    var fundo = document.querySelector(".overlay[data-fechar-detalhe]");
    if (fundo) fundo.hidden = false;
  }

  function fecharDetalhe() {
    if (detalhe) detalhe.hidden = true;
    var fundo = document.querySelector(".overlay[data-fechar-detalhe]");
    if (fundo) fundo.hidden = true;
  }

  function imprimirOrcamento(item) {
    if (!item) return;
    var janela = window.open("", "orcamento-gigaeletro");
    if (!janela) return;
    janela.document.open();
    janela.document.write(
      "<!DOCTYPE html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>Orçamento Gigaeletro</title>" +
      "<style>body{font-family:Manrope,Segoe UI,sans-serif;color:#111;margin:24px;font-size:12px}h1{font-size:18px;margin:0 0 8px}p{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tfoot td{font-weight:800}</style>" +
      "</head><body><h1>Gigaeletro</h1>" +
      "<p>" + escapar(dataVisivel(item.data)) + "</p>" +
      "<p>" + escapar(item.nome) + "</p>" +
      "<p>" + escapar(documentoVisivel(String(item.documento || ""))) + "</p>" +
      "<p>" + escapar(item.telefone) + "</p>" +
      tabelaItens(item) +
      "</body></html>"
    );
    janela.document.close();
    janela.focus();
    janela.print();
  }

  function renderOrcamentos(lista, concluida) {
    if (!listaGestor) return;
    orcamentosAtuais = lista;
    if (vazioGestor) vazioGestor.hidden = !concluida || lista.length > 0;
    listaGestor.innerHTML = lista.map(function (item) {
      var id = escapar(item.id);
      return "<tr>" +
        "<td>" + escapar(dataVisivel(item.data)) + "</td>" +
        "<td>" + escapar(item.nome) + "</td>" +
        "<td>" + escapar(documentoVisivel(String(item.documento || ""))) + "</td>" +
        "<td>" + escapar(item.telefone) + "</td>" +
        '<td class="num">' + moedaPainel(item.total) + "</td>" +
        '<td class="acoes"><div class="gestor-acoes">' +
          '<button type="button" data-ver-orcamento="' + id + '" aria-label="Visualizar" title="Visualizar">' + iconeAcao("olho") + "</button>" +
          '<button type="button" data-imprimir-orcamento="' + id + '" aria-label="Imprimir" title="Imprimir">' + iconeAcao("impressora") + "</button>" +
          '<button type="button" data-excluir-orcamento="' + id + '" aria-label="Excluir" title="Excluir">' + iconeAcao("lixeira") + "</button>" +
        "</div></td>" +
      "</tr>";
    }).join("");
  }

  var consultaPainel = 0;
  var idsExcluidos = {};

  function carregarOrcamentos() {
    if (!listaGestor) return;
    if (vazioGestor) vazioGestor.hidden = true;
    var pedido = ++consultaPainel;
    var docLimpo = String(campoDocumento ? campoDocumento.value : "").replace(/\D/g, "").slice(0, 14);
    var dataInicio = dataParaConsulta(campoDataInicio ? campoDataInicio.value : "");
    var dataFim = dataParaConsulta(campoDataFim ? campoDataFim.value : "");
    var url = "/api/orcamentos?dataInicio=" + encodeURIComponent(dataInicio) + "&dataFim=" + encodeURIComponent(dataFim) + "&cpf_cnpj=" + encodeURIComponent(docLimpo);
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json();
    }).then(function (corpo) {
      if (!corpo || pedido !== consultaPainel) return;
      var lista = corpo.ok && Array.isArray(corpo.orcamentos) ? corpo.orcamentos : [];
      lista = lista.filter(function (atual) { return !idsExcluidos[String(atual.id)]; });
      renderOrcamentos(lista, !!(corpo && corpo.ok));
    }).catch(function () {
      if (pedido !== consultaPainel) return;
      renderOrcamentos([], false);
    });
  }

  var formFiltros = document.querySelector("[data-gestor-filtros]");
  if (formFiltros) {
    formFiltros.addEventListener("submit", function (event) {
      event.preventDefault();
      carregarOrcamentos();
    });
  }
  if (campoDocumento) {
    campoDocumento.addEventListener("input", function () {
      campoDocumento.value = digitosDocumento(campoDocumento.value);
    });
  }
  if (listaGestor) {
    listaGestor.addEventListener("click", function (event) {
      var ver = event.target.closest("[data-ver-orcamento]");
      if (ver) {
        abrirDetalhe(acharOrcamento(ver.getAttribute("data-ver-orcamento")));
        return;
      }
      var imprimir = event.target.closest("[data-imprimir-orcamento]");
      if (imprimir) {
        imprimirOrcamento(acharOrcamento(imprimir.getAttribute("data-imprimir-orcamento")));
        return;
      }
      var excluir = event.target.closest("[data-excluir-orcamento]");
      if (excluir) excluirOrcamento(acharOrcamento(excluir.getAttribute("data-excluir-orcamento")));
    });
  }

  function excluirOrcamento(item) {
    if (!item || !item.id) return;
    var nome = String(item.nome || "este cliente");
    if (!window.confirm("Excluir o orçamento de " + nome + "?")) return;
    fetch("/api/orcamentos?id=" + encodeURIComponent(item.id), {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin"
    }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; }).then(function (corpo) {
        if (!resposta.ok || !corpo || !corpo.ok) throw new Error("excluir");
        return corpo;
      });
    }).then(function (corpo) {
      if (!corpo) return;
      fecharDetalhe();
      idsExcluidos[String(item.id)] = true;
      orcamentosAtuais = orcamentosAtuais.filter(function (atual) {
        return String(atual.id) !== String(item.id);
      });
      renderOrcamentos(orcamentosAtuais, true);
      carregarOrcamentos();
    }).catch(function () {
      window.alert("Não foi possível excluir o orçamento.");
    });
  }
  document.querySelectorAll("[data-fechar-detalhe]").forEach(function (botao) {
    botao.addEventListener("click", fecharDetalhe);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") fecharDetalhe();
  });

  function prepararDrop(zona, campo, aoEscolher) {
    if (!zona || !campo) return;
    ["dragenter", "dragover"].forEach(function (tipo) {
      zona.addEventListener(tipo, function (event) {
        event.preventDefault();
        zona.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (tipo) {
      zona.addEventListener(tipo, function (event) {
        event.preventDefault();
        zona.classList.remove("is-over");
      });
    });
    zona.addEventListener("drop", function (event) {
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      var transferencia = new DataTransfer();
      transferencia.items.add(file);
      campo.files = transferencia.files;
      aoEscolher(file);
    });
    campo.addEventListener("change", function () {
      aoEscolher((campo.files && campo.files[0]) || null);
    });
  }
})();
