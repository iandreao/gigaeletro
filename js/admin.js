(function () {
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
  var loginAdmin = document.querySelector("[data-login-admin]");
  var erroLogin = document.querySelector("[data-login-erro]");
  var campoSenha = loginAdmin ? loginAdmin.elements.senha : null;
  var botaoEntrar = loginAdmin ? loginAdmin.querySelector("[data-entrar]") : null;

  function atualizarEntrar() {
    if (botaoEntrar) botaoEntrar.disabled = !campoSenha || campoSenha.value.length === 0;
  }

  function limparCampoSenha() {
    if (campoSenha) campoSenha.value = "";
    atualizarEntrar();
  }

  /* O dispositivo é compartilhado: a senha nunca pode aparecer preenchida pelo navegador. */
  limparCampoSenha();
  document.addEventListener("DOMContentLoaded", limparCampoSenha);
  window.addEventListener("load", limparCampoSenha);
  /* Voltar/avançar no histórico restaura a página do cache com o campo preenchido. */
  window.addEventListener("pageshow", limparCampoSenha);
  if (campoSenha) {
    campoSenha.addEventListener("focus", limparCampoSenha);
    campoSenha.addEventListener("input", atualizarEntrar);
    campoSenha.addEventListener("input", function () {
      if (erroLogin && campoSenha.value.length > 0) erroLogin.hidden = true;
    });
  }

  function avisoLogin(texto) {
    if (!erroLogin) return;
    erroLogin.textContent = texto || "Senha Inválida";
    erroLogin.hidden = false;
  }

  function mostrarLogin() {
    document.querySelectorAll("[data-area-restrita]").forEach(function (area) { area.hidden = true; });
    limparCampoSenha();
    if (loginAdmin) loginAdmin.hidden = false;
    if (campoSenha) campoSenha.focus();
  }

  var fecharLogin = document.querySelector("[data-fechar-login]");
  if (fecharLogin) {
    fecharLogin.addEventListener("click", function () {
      limparCampoSenha();
      window.location.replace("/");
    });
  }

  fetch("/api/sessao", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
    return resposta.json();
  }).then(function (corpo) {
    if (!corpo || !corpo.ok) {
      mostrarLogin();
      return;
    }
    if (loginAdmin) loginAdmin.hidden = true;
    mostrarPainel();
  }).catch(function () {
    mostrarLogin();
  });

  if (loginAdmin) {
    loginAdmin.addEventListener("submit", function (event) {
      event.preventDefault();
      var senha = String(new FormData(loginAdmin).get("senha") || "").trim();
      limparCampoSenha();
      if (erroLogin) erroLogin.hidden = true;
      fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senha })
      }).then(function (resposta) {
        return resposta.json().catch(function () { return null; }).then(function (corpo) {
          return { status: resposta.status, corpo: corpo };
        });
      }).then(function (resultado) {
        var corpo = resultado.corpo;
        if (!corpo || !corpo.ok) {
          limparCampoSenha();
          /* 503 é falta de configuração no servidor, não senha errada. */
          avisoLogin(resultado.status === 503 && corpo && corpo.erro ? corpo.erro : "Senha Inválida");
          if (campoSenha) campoSenha.focus();
          return;
        }
        loginAdmin.hidden = true;
        mostrarPainel();
      }).catch(function () {
        limparCampoSenha();
        avisoLogin("Sem conexão com o servidor. Tente novamente.");
        if (campoSenha) campoSenha.focus();
      });
    });
  }

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
      dados.append("arquivo", planilhaEscolhida, planilhaEscolhida.name);
      fetch("/api/catalogo", { method: "POST", credentials: "same-origin", body: dados }).then(function (resposta) {
        if (resposta.status === 401) {
          mostrarLogin();
          throw new Error("Sessão do painel expirada. Entre novamente na Área Restrita.");
        }
        return resposta.json().then(function (corpo) {
          if (!resposta.ok || !corpo.ok) {
            throw new Error(corpo.erro || "A leitura falhou e o catálogo anterior foi mantido.");
          }
          return corpo;
        });
      }).then(function (corpo) {
        if (status) status.hidden = true;
        mostrarAuditoria(corpo);
        limparPlanilhaEscolhida();
      }).catch(function (falha) {
        if (status) {
          status.hidden = false;
          status.textContent = falha && falha.message ? falha.message : "A leitura falhou e o catálogo anterior foi mantido.";
        }
        limparPlanilhaEscolhida();
      });
    });
  }

  function limparPlanilhaEscolhida() {
    planilhaEscolhida = null;
    if (nomeArquivo) {
      nomeArquivo.hidden = true;
      nomeArquivo.textContent = "";
    }
    if (input) input.value = "";
    if (processar) processar.disabled = true;
  }

  function mostrarPainel() {
    if (formSenha) formSenha.hidden = true;
    document.querySelectorAll("[data-area-restrita]").forEach(function (area) { area.hidden = false; });
    mostrarAba("orcamentos");
    limparAuditoria();
    preencherDataHoje();
    carregarOrcamentos();
    carregarDashboard();
  }

  function mostrarAba(nome) {
    document.querySelectorAll("[data-visao]").forEach(function (painelVisao) {
      painelVisao.hidden = painelVisao.getAttribute("data-visao") !== nome;
    });
    document.querySelectorAll("[data-aba]").forEach(function (botao) {
      botao.setAttribute("aria-selected", botao.getAttribute("data-aba") === nome ? "true" : "false");
    });
  }

  function fecharMenuGestor() {
    var botao = document.querySelector(".nav-toggle");
    var abas = document.querySelector(".gestor-abas");
    if (botao) botao.setAttribute("aria-expanded", "false");
    if (abas) abas.classList.remove("is-open");
  }

  document.querySelectorAll("[data-aba]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      mostrarAba(botao.getAttribute("data-aba"));
      fecharMenuGestor();
      if (botao.getAttribute("data-aba") === "dashboard") carregarDashboard();
      if (botao.getAttribute("data-aba") === "trafego") carregarTrafego();
    });
  });

  var menuGestor = document.querySelector(".nav-toggle");
  if (menuGestor) {
    menuGestor.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var abas = document.querySelector(".gestor-abas");
      var aberto = menuGestor.getAttribute("aria-expanded") === "true";
      if (aberto || !abas) {
        fecharMenuGestor();
        return;
      }
      menuGestor.setAttribute("aria-expanded", "true");
      abas.classList.add("is-open");
    });
    document.addEventListener("click", function (event) {
      if (menuGestor.getAttribute("aria-expanded") !== "true") return;
      if (event.target.closest(".nav-toggle") || event.target.closest(".gestor-abas")) return;
      fecharMenuGestor();
    });
  }

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

  function campoPorId(id, seletor) {
    return document.getElementById(id) || document.querySelector(seletor);
  }

  var campoDataInicio = campoPorId("filtro-data-inicio", "[data-gestor-data-inicio]");
  var campoDataFim = campoPorId("filtro-data-fim", "[data-gestor-data-fim]");
  var campoDocumento = campoPorId("filtro-cpf-cnpj", "[data-gestor-documento]");
  var listaGestor = document.querySelector("[data-gestor-lista]");
  var vazioGestor = document.querySelector("[data-gestor-vazio]");
  var avisoBusca = document.querySelector("[data-gestor-busca-aviso]");
  var detalhe = document.querySelector("[data-detalhe]");
  var detalheCorpo = document.querySelector("[data-detalhe-corpo]");
  var orcamentosAtuais = [];
  var orcamentosCarregados = [];
  var cargaConcluida = false;
  var campoFiltroStatus = campoPorId("filtro-status", "[data-gestor-status]");
  var campoFiltroVendedor = campoPorId("filtro-vendedor", "[data-gestor-vendedor]");

  [campoDataInicio, campoDataFim, campoDocumento, campoFiltroStatus, campoFiltroVendedor].forEach(function (campo) {
    if (!campo) return;
    campo.readOnly = false;
    campo.disabled = false;
    campo.removeAttribute("readonly");
    campo.removeAttribute("disabled");
  });

  function mostrarAvisoBusca(texto) {
    if (texto) console.log("[orcamentos]", texto);
    if (!avisoBusca) return;
    avisoBusca.hidden = !texto;
    avisoBusca.textContent = texto || "";
  }

  function lerFiltrosBusca() {
    var inicio = document.getElementById("filtro-data-inicio");
    var fim = document.getElementById("filtro-data-fim");
    var documento = document.getElementById("filtro-cpf-cnpj");
    var status = document.getElementById("filtro-status");
    var vendedor = document.getElementById("filtro-vendedor");
    return {
      dataInicio: dataParaConsulta(inicio ? inicio.value : ""),
      dataFim: dataParaConsulta(fim ? fim.value : ""),
      cpf_cnpj: String(documento ? documento.value : "").replace(/\D/g, "").slice(0, 14),
      status: status ? status.value : "",
      vendedor: vendedor ? vendedor.value : ""
    };
  }

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
    var fontes = [orcamentosCarregados, orcamentosAtuais];
    var i;
    for (i = 0; i < fontes.length; i += 1) {
      var achado = (fontes[i] || []).find(function (item) { return String(item.id) === String(id); });
      if (achado) return achado;
    }
    return null;
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

  var STATUS_ORCAMENTO = ["Pendente", "Analisado", "Respondido"];
  var VENDEDORES = ["Bruno", "Summer", "Júlio", "Aceliani"];

  function statusAtual(item) {
    return STATUS_ORCAMENTO.indexOf(item && item.status) >= 0 ? item.status : "Pendente";
  }

  function vendedorAtual(item) {
    return VENDEDORES.indexOf(item && item.vendedor) >= 0 ? item.vendedor : "";
  }

  function classeStatus(valor) {
    if (valor === "Analisado") return "analisado";
    if (valor === "Respondido") return "respondido";
    return "pendente";
  }

  function opcoesSelect(valores, atual, rotuloVazio) {
    var html = "";
    if (rotuloVazio) {
      html += '<option value="">' + escapar(rotuloVazio) + "</option>";
    }
    valores.forEach(function (nome) {
      html += '<option value="' + escapar(nome) + '"' + (nome === atual ? " selected" : "") + ">" + escapar(nome) + "</option>";
    });
    return html;
  }

  function pintarStatus(select) {
    if (!select) return;
    select.className = "gestor-status gestor-status-" + classeStatus(select.value);
  }

  function gravarCampoLocal(id, campo, valor) {
    orcamentosCarregados.forEach(function (item) {
      if (String(item.id) === String(id)) item[campo] = valor;
    });
    renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), true);
  }

  function salvarAtendimento(select) {
    var id = select.getAttribute("data-id");
    var campo = select.hasAttribute("data-status") ? "status" : "vendedor";
    var valor = select.value;
    var anterior = select.dataset.anterior;
    var corpo = { id: id, atendimento: true };
    corpo[campo] = valor;
    if (campo === "status") pintarStatus(select);
    gravarCampoLocal(id, campo, valor);
    fetch("/api/orcamentos", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; }).then(function (publicado) {
        if (!resposta.ok || !publicado || !publicado.ok) throw new Error("gravar");
        return publicado;
      });
    }).catch(function () {
      gravarCampoLocal(id, campo, anterior == null ? "" : anterior);
      window.alert("Não foi possível salvar o atendimento.");
    });
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
        '<td class="status"><select class="gestor-status gestor-status-' + classeStatus(statusAtual(item)) + '" data-status data-id="' + id + '" data-anterior="' + escapar(statusAtual(item)) + '" aria-label="Status">' +
          opcoesSelect(STATUS_ORCAMENTO, statusAtual(item)) +
        "</select></td>" +
        '<td class="vendedor"><select class="gestor-vendedor" data-vendedor data-id="' + id + '" data-anterior="' + escapar(vendedorAtual(item)) + '" aria-label="Vendedor">' +
          opcoesSelect(VENDEDORES, vendedorAtual(item), "Selecione...") +
        "</select></td>" +
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

  function aplicarFiltrosLocais(lista) {
    var filtros = lerFiltrosBusca();
    var status = filtros.status;
    var vendedor = filtros.vendedor;
    return (lista || []).filter(function (item) {
      if (idsExcluidos[String(item.id)]) return false;
      if (status && statusAtual(item) !== status) return false;
      if (vendedor && vendedorAtual(item) !== vendedor) return false;
      return true;
    });
  }

  function carregarOrcamentos() {
    if (!listaGestor) return;
    if (vazioGestor) vazioGestor.hidden = true;
    var pedido = ++consultaPainel;
    var filtros = lerFiltrosBusca();
    var url = "/api/orcamentos?dataInicio=" + encodeURIComponent(filtros.dataInicio) + "&dataFim=" + encodeURIComponent(filtros.dataFim) + "&cpf_cnpj=" + encodeURIComponent(filtros.cpf_cnpj);
    console.log("[orcamentos] busca", filtros, url);
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        mostrarAvisoBusca("Sessão expirada. Entre novamente na área restrita.");
        console.log("[orcamentos] erro", 401);
        window.location.replace("/");
        return null;
      }
      return resposta.json().then(function (corpo) {
        return { status: resposta.status, ok: resposta.ok, corpo: corpo };
      }).catch(function () {
        return { status: resposta.status, ok: false, corpo: null };
      });
    }).then(function (resultado) {
      if (!resultado || pedido !== consultaPainel) return;
      var corpo = resultado.corpo;
      console.log("[orcamentos] resposta", resultado.status, corpo);
      if (!resultado.ok || !corpo || corpo.ok === false) {
        orcamentosCarregados = [];
        cargaConcluida = false;
        renderOrcamentos([], false);
        mostrarAvisoBusca(corpo && corpo.erro ? corpo.erro : "Erro ao consultar os orçamentos.");
        return;
      }
      var lista = Array.isArray(corpo.orcamentos) ? corpo.orcamentos : [];
      lista = lista.filter(function (atual) { return !idsExcluidos[String(atual.id)]; });
      orcamentosCarregados = lista;
      cargaConcluida = true;
      var visiveis = aplicarFiltrosLocais(orcamentosCarregados);
      renderOrcamentos(visiveis, true);
      mostrarAvisoBusca("");
      console.log("[orcamentos] lista", lista.length, "visiveis", visiveis.length);
    }).catch(function (erro) {
      if (pedido !== consultaPainel) return;
      console.log("[orcamentos] erro", erro);
      orcamentosCarregados = [];
      cargaConcluida = false;
      renderOrcamentos([], false);
      mostrarAvisoBusca("Erro ao consultar os orçamentos.");
    });
  }

  var formFiltros = document.querySelector("[data-gestor-filtros]");
  if (formFiltros) {
    formFiltros.addEventListener("submit", function (event) {
      event.preventDefault();
      carregarOrcamentos();
    });
    formFiltros.addEventListener("change", function (event) {
      var alvo = event.target;
      if (!alvo) return;
      if (alvo.hasAttribute("data-gestor-status") || alvo.hasAttribute("data-gestor-vendedor")) {
        renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), cargaConcluida);
        return;
      }
      if (alvo.hasAttribute("data-gestor-data-inicio") || alvo.hasAttribute("data-gestor-data-fim") || alvo.hasAttribute("data-gestor-documento")) {
        carregarOrcamentos();
      }
    });
  }
  if (campoDocumento) {
    var documentoTimer = 0;
    campoDocumento.addEventListener("input", function () {
      campoDocumento.value = digitosDocumento(campoDocumento.value);
      window.clearTimeout(documentoTimer);
      documentoTimer = window.setTimeout(carregarOrcamentos, 250);
    });
  }
  if (listaGestor) {
    listaGestor.addEventListener("focusin", function (event) {
      var select = event.target.closest("select[data-status], select[data-vendedor]");
      if (select) select.dataset.anterior = select.value;
    });
    listaGestor.addEventListener("change", function (event) {
      var select = event.target.closest("select[data-status], select[data-vendedor]");
      if (select) salvarAtendimento(select);
    });
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
      orcamentosCarregados = orcamentosCarregados.filter(function (atual) {
        return String(atual.id) !== String(item.id);
      });
      renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), true);
      carregarOrcamentos();
    }).catch(function () {
      window.alert("Não foi possível excluir o orçamento.");
    });
  }
  var dashDias = 30;
  var dashPedido = 0;
  var trafegoDias = 30;
  var trafegoPedido = 0;
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function diasAtras(dias) {
    var data = new Date(dataHojeIso() + "T12:00:00Z");
    data.setUTCDate(data.getUTCDate() - (dias - 1));
    return data.toISOString().slice(0, 10);
  }

  function rotuloPeriodo(chave, agrupamento) {
    var partes = String(chave).split("-");
    if (agrupamento === "mes") return MESES[Number(partes[1]) - 1] + "/" + partes[0].slice(2);
    return partes[2] + "/" + partes[1];
  }

  function pct(valor) {
    return String(Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })) + "%";
  }

  function htmlDivisao(partes) {
    var barra = partes.map(function (parte) {
      return '<span class="' + parte.classe + '" style="width:' + Number(parte.dado.pct || 0) + '%"></span>';
    }).join("");
    var totalQtd = 0;
    var totalValor = 0;
    var linhas = partes.map(function (parte) {
      var qtd = Number(parte.dado.qtd || 0);
      var valor = Number(parte.dado.valor || 0);
      totalQtd += qtd;
      totalValor += valor;
      return '<tr><th scope="row"><i class="' + parte.classe + '"></i>' +
        '<span class="dash-nome-longo">' + escapar(parte.nome) + '</span>' +
        '<span class="dash-nome-curto">' + escapar(parte.curto) + '</span></th>' +
        '<td>' + qtd + '</td><td>' + moedaPainel(valor) + '</td><td>' + pct(parte.dado.pct) + '</td></tr>';
    }).join("");
    return '<div class="dash-divisao" role="img" aria-label="' + escapar(partes.map(function (parte) {
      return parte.nome + " " + pct(parte.dado.pct);
    }).join(", ")) + '">' + barra + '</div>' +
      '<div class="dash-tabela-caixa"><table class="dash-tabela">' +
      '<thead><tr><th scope="col">Categoria</th><th scope="col">Qtd.</th><th scope="col">Valor (R$)</th><th scope="col">%</th></tr></thead>' +
      '<tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><th scope="row">Total:</th><td>' + totalQtd + '</td><td>' + moedaPainel(totalValor) + '</td>' +
      '<td>' + (totalQtd ? "100%" : "0%") + '</td></tr></tfoot></table></div>';
  }

  function htmlSerie(serie, agrupamento) {
    if (!serie.length) return '<p class="dash-vazio">Sem orçamentos no período.</p>';
    var maior = Math.max.apply(null, serie.map(function (ponto) { return ponto.total; }).concat([1]));
    var passo = Math.max(1, Math.ceil(serie.length / 8));
    return serie.map(function (ponto, indice) {
      var rotulo = rotuloPeriodo(ponto.periodo, agrupamento);
      var mostrar = indice % passo === 0 || indice === serie.length - 1;
      return '<div class="dash-coluna" title="' + escapar(rotulo + ": " + ponto.total + " orçamento(s)") + '">' +
        '<div class="dash-pilha" style="height:' + (ponto.total * 100 / maior) + '%">' +
        '<span class="dash-cor-gigavoz" style="flex-grow:' + ponto.gigavoz + '"></span>' +
        '<span class="dash-cor-tradicional" style="flex-grow:' + ponto.tradicional + '"></span>' +
        '</div><small>' + (mostrar ? escapar(rotulo) : "") + '</small></div>';
    }).join("");
  }

  function renderDashboard(dados) {
    var total = document.querySelector("[data-dash-total]");
    var periodo = document.querySelector("[data-dash-periodo-texto]");
    var serie = document.querySelector("[data-dash-serie]");
    var metodo = document.querySelector("[data-dash-metodo]");
    var pessoa = document.querySelector("[data-dash-pessoa]");
    var nota = document.querySelector("[data-dash-nota]");
    if (total) total.textContent = String(dados.total || 0);
    if (periodo) {
      periodo.textContent = dados.inicio
        ? (dados.inicio === dados.fim ? "em " + dataVisivel(dados.inicio) : "de " + dataVisivel(dados.inicio) + " a " + dataVisivel(dados.fim))
        : "orçamentos";
    }
    if (serie) {
      serie.classList.toggle("is-mensal", dados.agrupamento === "mes");
      serie.innerHTML = htmlSerie(dados.serie || [], dados.agrupamento);
    }
    if (metodo) {
      metodo.innerHTML = htmlDivisao([
        { classe: "dash-cor-tradicional", nome: "Catálogo Tradicional", curto: "Tradicional", dado: dados.metodo.tradicional },
        { classe: "dash-cor-gigavoz", nome: "GigaVoz", curto: "GigaVoz", dado: dados.metodo.gigavoz }
      ]);
    }
    if (pessoa) {
      pessoa.innerHTML = htmlDivisao([
        { classe: "dash-cor-pf", nome: "Pessoa Física (CPF)", curto: "Física (CPF)", dado: dados.pessoa.pf },
        { classe: "dash-cor-pj", nome: "Pessoa Jurídica (CNPJ)", curto: "Jurídica (CNPJ)", dado: dados.pessoa.pj }
      ]);
    }
    if (nota) {
      var semValor = Number(dados.semValor || 0);
      nota.hidden = !semValor;
      nota.textContent = semValor
        ? semValor + " orçamento(s) antigo(s) do período já saíram do painel e não têm valor registrado: entram na quantidade, mas não no Valor."
        : "";
    }
  }

  function avisoDashboard(texto) {
    var aviso = document.querySelector("[data-dash-aviso]");
    if (!aviso) return;
    aviso.hidden = !texto;
    aviso.textContent = texto || "";
  }

  function carregarDashboard() {
    var grade = document.querySelector("[data-dash-grid]");
    if (!grade) return;
    var pedido = ++dashPedido;
    var url = "/api/dashboard-estatisticas";
    if (dashDias > 0) {
      url += "?dataInicio=" + encodeURIComponent(diasAtras(dashDias)) + "&dataFim=" + encodeURIComponent(dataHojeIso());
    }
    grade.setAttribute("aria-busy", "true");
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      if (pedido !== dashPedido) return;
      grade.setAttribute("aria-busy", "false");
      if (!corpo || !corpo.ok) {
        avisoDashboard(corpo && corpo.erro ? corpo.erro : "Erro ao carregar o painel comercial.");
        return;
      }
      avisoDashboard("");
      renderDashboard(corpo);
    }).catch(function () {
      if (pedido !== dashPedido) return;
      grade.setAttribute("aria-busy", "false");
      avisoDashboard("Erro ao carregar o painel comercial.");
    });
  }

  function horarioAcesso(valor) {
    var partes = String(valor || "").split(" ");
    var data = partes[0].split("-");
    return data.length === 3 ? data[2] + "/" + data[1] + "/" + data[0] + " " + (partes[1] || "") : String(valor || "");
  }

  function renderTrafego(dados) {
    var unicos = document.querySelector("[data-trafego-unicos]");
    var resumo = document.querySelector("[data-trafego-resumo]");
    var lista = document.querySelector("[data-trafego-lista]");
    var vazio = document.querySelector("[data-trafego-vazio]");
    var registros = dados.registros || [];
    var dias = Number(dados.periodoDias || 0);
    var total = Number(dados.totalAcessos || 0);
    if (unicos) unicos.textContent = String(dados.sessoesUnicas || 0);
    if (resumo) {
      resumo.textContent = dados.armazenamento === "nenhum"
        ? "Contagem desativada: falta a variável REDIS_URL na Vercel."
        : "usuário(s) único(s) " +
          (dias === 1 ? "hoje" : (dias ? "nos últimos " + dias + " dias" : "em todo o período")) +
          " · " + total + " acesso(s) registrado(s)" +
          (total > registros.length ? " · mostrando os " + registros.length + " mais recentes" : "");
    }
    if (vazio) vazio.hidden = registros.length > 0;
    if (lista) {
      lista.innerHTML = registros.map(function (linha) {
        return "<tr>" +
          "<td>" + escapar(horarioAcesso(linha.data_hora)) + "</td>" +
          '<td class="quem">' + escapar(linha.quem_acessou || "—") + "</td>" +
          "<td>" + escapar(linha.dispositivo || "—") + "</td>" +
          "<td>" + escapar(linha.origem || "Direto") + "</td>" +
          "</tr>";
      }).join("");
    }
  }

  function carregarTrafego() {
    var grade = document.querySelector("[data-trafego]");
    var aviso = document.querySelector("[data-trafego-aviso]");
    if (!grade) return;
    var pedido = ++trafegoPedido;
    grade.setAttribute("aria-busy", "true");
    fetch("/api/admin/metricas-acesso?dias=" + encodeURIComponent(trafegoDias), { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      if (pedido !== trafegoPedido) return;
      grade.setAttribute("aria-busy", "false");
      var erro = !corpo || !corpo.ok;
      if (aviso) {
        aviso.hidden = !erro;
        aviso.textContent = erro ? (corpo && corpo.erro ? corpo.erro : "Erro ao carregar o tráfego do site.") : "";
      }
      if (!erro) renderTrafego(corpo);
    }).catch(function () {
      if (pedido !== trafegoPedido) return;
      grade.setAttribute("aria-busy", "false");
      if (aviso) {
        aviso.hidden = false;
        aviso.textContent = "Erro ao carregar o tráfego do site.";
      }
    });
  }

  var CHAVE_DISPOSITIVO = "giga_nome_dispositivo";
  var seletorDispositivo = document.querySelector("[data-nome-dispositivo]");
  var dispositivoAtual = document.querySelector("[data-dispositivo-atual]");

  function nomeDispositivoSalvo() {
    try {
      return window.localStorage.getItem(CHAVE_DISPOSITIVO) || "";
    } catch (semAcesso) {
      return "";
    }
  }

  function mostrarDispositivoAtual() {
    var nome = nomeDispositivoSalvo();
    if (dispositivoAtual) {
      dispositivoAtual.textContent = nome ? "Este navegador: " + nome : "Este navegador ainda não foi identificado (conta como Cliente Externo).";
    }
    if (seletorDispositivo && nome) seletorDispositivo.value = nome;
  }

  var salvarDispositivo = document.querySelector("[data-salvar-dispositivo]");
  if (salvarDispositivo && seletorDispositivo) {
    salvarDispositivo.addEventListener("click", function () {
      var nome = seletorDispositivo.value;
      try {
        window.localStorage.setItem(CHAVE_DISPOSITIVO, nome);
      } catch (semAcesso) {
        window.alert("Este navegador não permite salvar o nome (modo privado ou armazenamento bloqueado).");
        return;
      }
      mostrarDispositivoAtual();
      window.alert("Este dispositivo agora está identificado como " + nome);
    });
  }
  mostrarDispositivoAtual();

  document.querySelectorAll("[data-trafego-dias]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      trafegoDias = Number(botao.getAttribute("data-trafego-dias")) || 0;
      document.querySelectorAll("[data-trafego-dias]").forEach(function (outro) {
        outro.setAttribute("aria-pressed", outro === botao ? "true" : "false");
      });
      carregarTrafego();
    });
  });

  document.querySelectorAll("[data-dash-dias]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      dashDias = Number(botao.getAttribute("data-dash-dias")) || 0;
      document.querySelectorAll("[data-dash-dias]").forEach(function (outro) {
        outro.setAttribute("aria-pressed", outro === botao ? "true" : "false");
      });
      carregarDashboard();
    });
  });

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
