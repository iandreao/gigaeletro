/* Telemetria de acessos: isolada do orçamento e silenciosa mesmo se a rota falhar. */
document.addEventListener("DOMContentLoaded", function () {
  var EQUIPE = ["Aceliani", "Julio", "Ivalino", "Caixa", "Balcão 01", "Balcão 02", "Balcão 03"];
  function novaSessao() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  /* Aceita ?user=julio, ?user=Balcao01 ou ?user=Balcão%2001 e devolve o nome oficial da equipe. */
  function nomeDaEquipe(valor) {
    var chave = function (texto) {
      return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toLowerCase();
    };
    var procurado = chave(valor);
    for (var i = 0; procurado && i < EQUIPE.length; i += 1) {
      if (chave(EQUIPE[i]) === procurado) return EQUIPE[i];
    }
    return "";
  }
  try {
    var parametros = new URLSearchParams(window.location.search);
    var origem = (parametros.get("ref") || parametros.get("utm_source") || "").trim() || "Direto";
    var sessao = "";
    try {
      sessao = window.sessionStorage.getItem("gigaeletro_sessao") || "";
      if (!sessao) {
        sessao = novaSessao();
        window.sessionStorage.setItem("gigaeletro_sessao", sessao);
      }
    } catch (bloqueado) {
      sessao = sessao || novaSessao();
    }
    var quem = nomeDaEquipe(parametros.get("user"));
    try {
      if (quem) window.sessionStorage.setItem("giga_user", quem);
      else quem = nomeDaEquipe(window.sessionStorage.getItem("giga_user"));
    } catch (semAcesso) {}
    var toque = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    var dispositivo = toque && window.innerWidth < 1024 ? "Mobile" : "Desktop";
    fetch("/api/registrar-acesso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origem: origem, sessao: sessao, quem: quem || "Cliente Externo", dispositivo: dispositivo }),
      credentials: "same-origin",
      keepalive: true
    }).catch(function () {});
  } catch (falha) {}
});

(function () {
  var WHATSAPP = "5527998235652";
  var CHAVE_PEDIDO = "gigaeletro-orcamento";
  var CHAVE_RASCUNHO = "gigaeletro_rascunho";
  var VALIDADE_RASCUNHO = 15 * 24 * 60 * 60 * 1000;
  var SITE_PDF = "https://gigaeletro.com.br";
  var logoPdf = new Image();
  logoPdf.src = "assets/logo-gigaeletro.jpg";

  var catalogo = [];
  var indiceBusca = [];
  var loteCatalogo = 0;
  var LINHAS_IMEDIATAS = 120;
  var LINHAS_POR_QUADRO = 600;
  var selecionados = carregarPedido();
  var busca = "";

  var listaEl = document.querySelector("[data-catalogo]");
  var ancoraCatalogo = "orcamento";
  var resumoEl = document.querySelector("[data-resumo]");
  var resumoVazio = document.querySelector("[data-resumo-vazio]");
  var subtotalEl = document.querySelector("[data-subtotal]");
  var avisoEnvio = document.querySelector("[data-envio-aviso]");
  var buscaEl = document.querySelector("[data-busca]");
  var combo = document.querySelector("[data-busca-combo]");
  var sugestoesEl = document.querySelector("[data-sugestoes]");
  var restrita = document.querySelector("[data-restrita]");
  var restritaOverlay = document.querySelector(".overlay[data-fechar-restrita]");
  var restritaErro = document.querySelector("[data-restrita-erro]");
  var enviar = document.querySelector("[data-enviar]");
  var enviarEmail = document.querySelector("[data-enviar-email]");
  /* Desligado até o domínio ser verificado no Resend; mude para true para liberar o botão. */
  var EMAIL_ATIVO = false;
  var limparOrcamento = document.querySelector("[data-limpar-orcamento]");
  var status = document.querySelector("[data-cart-status]");
  var formCliente = document.querySelector("[data-cliente]");
  var consultaCnpj = 0;
  var consultaCep = 0;
  var cepPedido = "";
  var envioEmCurso = false;
  var envioEmailEmCurso = false;
  var restaurandoCliente = false;
  var clienteAvisado = false;
  var timerClientePronto = 0;
  var sugestaoAtiva = -1;
  var orcamentoSendoEditadoId = "";
  var orcamentoSendoEditadoDocumento = "";

  if (buscaEl) {
    buscaEl.addEventListener("input", function () {
      busca = buscaEl.value;
      sugestaoAtiva = -1;
      var encontrados = resultadoBusca();
      renderSugestoes(encontrados);
      renderCatalogo(encontrados);
      voltarListaAoTopo();
    });
    buscaEl.addEventListener("keydown", function (event) {
      var opcoes = sugestoesEl ? sugestoesEl.querySelectorAll("[data-sugestao]") : [];
      if (event.key === "ArrowDown" && opcoes.length) {
        event.preventDefault();
        sugestaoAtiva = Math.min(sugestaoAtiva + 1, opcoes.length - 1);
        marcarSugestao(opcoes);
      } else if (event.key === "ArrowUp" && opcoes.length) {
        event.preventDefault();
        sugestaoAtiva = Math.max(sugestaoAtiva - 1, 0);
        marcarSugestao(opcoes);
      } else if (event.key === "Enter" && sugestaoAtiva >= 0 && opcoes[sugestaoAtiva]) {
        event.preventDefault();
        escolherSugestao();
      } else if (event.key === "Escape") {
        fecharSugestoes();
      }
    });
  }

  if (sugestoesEl) {
    sugestoesEl.addEventListener("click", function (event) {
      var botao = event.target.closest("[data-sugestao]");
      if (!botao) return;
      escolherSugestao(botao);
    });
  }

  document.addEventListener("click", function (event) {
    if (!combo || combo.contains(event.target)) return;
    fecharSugestoes();
  });

  if (listaEl) {
    listaEl.addEventListener("click", function (event) {
      var botao = event.target.closest(".add-mini");
      if (!botao) return;
      adicionar(botao.getAttribute("data-add"));
    });
  }

  if (resumoEl) {
    resumoEl.addEventListener("click", function (event) {
      var botao = event.target.closest("[data-acao]");
      if (!botao) return;
      alterar(botao.getAttribute("data-id"), botao.getAttribute("data-acao"));
    });
    resumoEl.addEventListener("input", function (event) {
      var campo = event.target.closest("[data-qtd]");
      if (!campo) return;
      var qtd = parseInt(campo.value, 10);
      if (!isFinite(qtd) || qtd < 1) return;
      definirQtd(campo.getAttribute("data-qtd"), qtd);
    });
    resumoEl.addEventListener("change", function (event) {
      var campo = event.target.closest("[data-qtd]");
      if (!campo) return;
      var qtd = parseInt(campo.value, 10);
      if (!isFinite(qtd) || qtd < 1) qtd = 1;
      campo.value = String(qtd);
      definirQtd(campo.getAttribute("data-qtd"), qtd);
    });
  }

  document.querySelectorAll("[data-abrir-restrita]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      setRestrita(true);
    });
  });

  document.querySelectorAll("[data-fechar-restrita]").forEach(function (botao) {
    botao.addEventListener("click", function () { setRestrita(false); });
  });

  var formRestrita = document.querySelector("[data-restrita-form]");
  if (formRestrita) {
    formRestrita.addEventListener("submit", function (event) {
      event.preventDefault();
      var senha = String(new FormData(formRestrita).get("senha") || "").trim();
      fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senha })
      }).then(function (resposta) {
        return resposta.json();
      }).then(function (corpo) {
        if (!corpo || !corpo.ok) {
          if (restritaErro) restritaErro.hidden = false;
          return;
        }
        window.location.href = "/admin-estoque";
      }).catch(function () {
        if (restritaErro) restritaErro.hidden = false;
      });
    });
  }

  var esqueciSenha = document.querySelector("[data-esqueci-senha]");
  if (esqueciSenha) {
    var textoSenha = "Olá, sou o gestor do SiteGigaeletro e esqueci minha senha de acesso. Solicito a chave de redefinição para o painel.";
    esqueciSenha.href = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(textoSenha);
    esqueciSenha.target = "_blank";
    esqueciSenha.rel = "noopener noreferrer";
  }

  document.querySelectorAll("[data-abrir-catalogo]").forEach(function (botao) {
    botao.addEventListener("click", function () { setCatalogo(true); });
  });
  document.querySelectorAll("[data-fechar-catalogo]").forEach(function (botao) {
    botao.addEventListener("click", function () { setCatalogo(false); });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (sugestoesEl && !sugestoesEl.hidden) {
      fecharSugestoes();
      return;
    }
    var catalogoModal = document.querySelector("[data-catalogo-modal]");
    if (catalogoModal && !catalogoModal.hidden) {
      setCatalogo(false);
      return;
    }
    setRestrita(false);
  });

  if (formCliente) {
    formCliente.addEventListener("input", function (event) {
      var alvo = event.target;
      if (alvo && alvo.name === "uf") {
        var posicao = alvo.selectionStart;
        alvo.value = alvo.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
        if (alvo.setSelectionRange && posicao !== null) alvo.setSelectionRange(posicao, posicao);
      }
      if (alvo && (alvo.name === "documento" || alvo.name === "cep" || alvo.name === "email" || alvo.name === "celular")) {
        if (!valorInvalido(alvo)) limparAvisoCampo(alvo);
      }
      if (alvo && alvo.name === "celular") aplicarMascaraTelefone(alvo);
      if (alvo && alvo.name === "documento") {
        aplicarMascaraDocumento(alvo);
        consultarCnpjSeCompleto();
      }
      if (alvo && alvo.name === "cep") {
        aplicarMascaraCep(alvo);
        var digitosCep = apenasDigitos(alvo.value);
        if (digitosCep.length === 8) consultarCep(digitosCep);
      }
      liberarEnvio();
    });
    formCliente.addEventListener("change", function (event) {
      if (restaurandoCliente) return;
      if (event.target && event.target.name === "tipo") limparCamposCliente();
      acompanharCliente(true);
    });
    formCliente.addEventListener("keydown", function (event) {
      if (event.key !== "Tab" && event.key !== "Enter") return;
      if (!campoMonitorado(event.target) || !valorInvalido(event.target)) return;
      event.preventDefault();
      mostrarDadoInvalido(event.target);
      event.target.focus();
    });
    formCliente.addEventListener("focusout", function (event) {
      var campo = event.target;
      if (!campoMonitorado(campo) || !valorInvalido(campo)) return;
      var destino = event.relatedTarget;
      if (destino && destino.closest && (destino.closest(".site-header") || destino.closest("[data-enviar], [data-enviar-email]") || destino.closest(".tipo-pessoa") || destino.closest("[data-historico]") || destino.closest("[data-editar-orcamento]") || destino.closest("[data-abrir-historico]"))) return;
      window.setTimeout(function () {
        if (valorInvalido(campo) && document.activeElement !== campo) campo.focus();
      }, 0);
    });
    atualizarRotuloDocumento();
  }

  document.addEventListener("mousedown", function (event) {
    var ativo = document.activeElement;
    if (!campoMonitorado(ativo) || !formCliente || !formCliente.contains(ativo) || !valorInvalido(ativo)) return;
    if (ativo === event.target || ativo.contains(event.target)) return;
    /* O menu superior nunca fica preso a um campo inválido. */
    if (event.target.closest && (event.target.closest(".site-header") || event.target.closest("[data-enviar], [data-enviar-email]") || event.target.closest(".tipo-pessoa") || event.target.closest("[data-historico]") || event.target.closest("[data-editar-orcamento]") || event.target.closest("[data-abrir-historico]"))) return;
    event.preventDefault();
    mostrarDadoInvalido(ativo);
    ativo.focus();
  }, true);

  document.addEventListener("click", function (event) {
    var ativo = document.activeElement;
    if (!campoMonitorado(ativo) || !valorInvalido(ativo)) return;
    if (event.target.closest && (event.target.closest(".site-header") || event.target.closest("[data-enviar], [data-enviar-email]") || event.target.closest(".tipo-pessoa") || event.target.closest("[data-historico]") || event.target.closest("[data-editar-orcamento]") || event.target.closest("[data-abrir-historico]"))) return;
    if (ativo.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    mostrarDadoInvalido(ativo);
    ativo.focus();
  }, true);

  if (enviar) {
    enviar.textContent = "Enviar por WhatsApp";
    enviar.addEventListener("click", enviarWhatsApp);
    if (enviarEmail) {
      enviarEmail.addEventListener("click", enviarPorEmail);
      if (!EMAIL_ATIVO) enviarEmail.title = "Envio por e-mail em breve";
    }
    document.addEventListener("gv-itens-orcamento", function (evento) {
      incluirItensVoz(evento && evento.detail);
    });
  }

  if (limparOrcamento) {
    limparOrcamento.innerHTML = icone("lixeira") + "<span>Limpar Lista</span>";
    limparOrcamento.addEventListener("click", function () {
      if (!carrinhoValido()) return;
      if (!window.confirm("Deseja realmente limpar todos os itens do seu orçamento?")) return;
      /* Só os itens saem. Os dados do cliente continuam preenchidos. */
      zerarQuadroOrcamento();
      if (status) status.textContent = "Orçamento limpo.";
      document.dispatchEvent(new CustomEvent("gv-orcamento-limpo"));
    });
  }

  var inicio = document.getElementById("btnInicio") || document.querySelector('.nav a[href="#inicio"]');
  if (inicio) {
    inicio.addEventListener("click", function () {
      /* Reset total: fecha o que estiver sobre a home e zera o orçamento. */
      setCatalogo(false);
      setHistorico(false);
      setRestrita(false);
      fecharSugestoes();
      limparDepoisDoEnvio();
    });
  }

  var documentoConsulta = "";
  var historicoConsulta = [];
  var historicoPedido = 0;
  var historicoBuscando = false;

  function setHistorico(aberto) {
    if (aberto) {
      setCatalogo(false);
      setRestrita(false);
    }
    var modal = document.querySelector("[data-historico]");
    var fundo = document.querySelector("[data-historico-overlay]");
    if (modal) modal.hidden = !aberto;
    if (fundo) fundo.hidden = !aberto;
    if (!aberto) return;
    documentoConsulta = "";
    historicoConsulta = [];
    historicoBuscando = false;
    historicoPedido += 1;
    var campoBusca = document.querySelector("[data-historico-documento]");
    var erroBusca = document.querySelector("[data-historico-erro]");
    if (campoBusca) campoBusca.value = "";
    if (erroBusca) erroBusca.hidden = true;
    renderRecentes();
    if (campoBusca) window.setTimeout(function () { campoBusca.focus(); }, 0);
  }

  document.querySelectorAll("[data-abrir-historico]").forEach(function (botao) {
    botao.addEventListener("click", function () { setHistorico(true); });
  });
  document.querySelectorAll("[data-fechar-historico]").forEach(function (botao) {
    botao.addEventListener("click", function () { setHistorico(false); });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    setHistorico(false);
  });

  var buscaHistorico = document.querySelector("[data-historico-busca]");
  if (buscaHistorico) {
    var campoBusca = buscaHistorico.querySelector("[data-historico-documento]");
    if (campoBusca) {
      campoBusca.addEventListener("input", function () {
        aplicarMascaraBusca(campoBusca);
      });
    }
    buscaHistorico.addEventListener("submit", buscarHistorico);
  }

  var recentesLista = document.querySelector("[data-recentes-lista]");
  if (recentesLista) {
    recentesLista.addEventListener("click", function (event) {
      var excluir = event.target.closest("[data-excluir-orcamento]");
      if (excluir) {
        excluirRecente(excluir.getAttribute("data-excluir-orcamento"));
        return;
      }
      var botao = event.target.closest("[data-editar-orcamento]");
      if (!botao) return;
      editarRecente(botao.getAttribute("data-editar-orcamento"));
      setHistorico(false);
    });
  }

  renderCatalogo();
  renderResumo();
  renderRecentes();
  carregarPublicado();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restaurarRascunho);
  } else {
    restaurarRascunho();
  }

  window.addEventListener("resize", function () {
    var modal = document.querySelector("[data-catalogo-modal]");
    if (!modal || modal.hidden || modal.classList.contains("is-arrastando")) return;
    if (modal.dataset.arrastado === "1" && !layoutCatalogoCelular()) {
      var form = document.querySelector("[data-cliente]");
      if (!form) return;
      var largura = form.getBoundingClientRect().width;
      modal.style.width = largura + "px";
      return;
    }
    posicionarCatalogo(ancoraCatalogo);
  });

  function adicionar(codigo) {
    if (document.body.dataset.gvCatalogoTravado === "1") return;
    /* Item de catálogo entra no lugar da lista de voz, e só neste momento. */
    if (selecionados.some(itemVoz)) {
      selecionados = selecionados.filter(function (item) { return !itemVoz(item); });
      limparVozDoOrcamento();
    }
    var produto = catalogo.find(function (item) { return item.codigo === codigo; });
    if (!produto) return;
    var atual = selecionados.find(function (item) { return item.codigo === codigo; });
    if (!atual) {
      selecionados.push({
        codigo: produto.codigo,
        produto: produto.produto,
        preco: produto.preco,
        estoque: produto.estoque,
        qtd: 1
      });
    }
    salvarPedido();
    renderResumo();
    liberarEnvio();
    ancoraCatalogo = "formulario";
    posicionarCatalogo("formulario");
    var campo = acharQuantidade(codigo);
    var linha = campo && campo.closest ? campo.closest(".cart-item") : null;
    if (linha && linha.scrollIntoView) linha.scrollIntoView({ block: "nearest" });
    if (status) status.textContent = produto.produto + " entrou no orçamento. Informe a quantidade desejada.";
  }

  function definirQtd(codigo, qtd) {
    selecionados.forEach(function (item) {
      if (item.codigo === codigo) item.qtd = qtd;
    });
    salvarPedido();
    atualizarTotais();
  }

  function alterar(codigo, acao) {
    selecionados = selecionados.map(function (item) {
      if (item.codigo !== codigo) return item;
      var qtd = item.qtd;
      if (acao === "mais") qtd += 1;
      if (acao === "menos" || acao === "remover") qtd -= acao === "remover" ? qtd : 1;
      return {
        codigo: item.codigo,
        produto: item.produto,
        preco: item.preco,
        estoque: item.estoque,
        qtd: qtd
      };
    }).filter(function (item) { return item.qtd > 0; });
    salvarPedido();
    renderResumo();
  }

  function layoutCatalogoCelular() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  function limparPosicaoCatalogo(modal) {
    modal.style.left = "";
    modal.style.top = "";
    modal.style.right = "";
    modal.style.bottom = "";
    modal.style.width = "";
    modal.style.transform = "";
    delete modal.dataset.arrastado;
  }

  function posicionarCatalogo() {
    var modal = document.querySelector("[data-catalogo-modal]");
    if (!modal) return;
    limparPosicaoCatalogo(modal);
  }

  function setCatalogo(aberto) {
    /* O catálogo abre no modo tradicional, mesmo que ainda exista lista de voz no quadro. */
    if (aberto && document.body.dataset.gvCatalogoTravado === "1") return;
    if (aberto) {
      setHistorico(false);
      setRestrita(false);
    }
    var modal = document.querySelector("[data-catalogo-modal]");
    var fundo = document.querySelector("[data-catalogo-overlay]");
    if (modal) modal.hidden = !aberto;
    if (fundo) fundo.hidden = !aberto;
    document.body.classList.toggle("catalogo-aberto", aberto);
    if (aberto) {
      ancoraCatalogo = "orcamento";
      posicionarCatalogo("orcamento");
      if (buscaEl) buscaEl.focus();
    } else {
      fecharSugestoes();
    }
  }

  function linhaCatalogo(item) {
    var codigo = escapar(item.codigo);
    var nome = escapar(item.produto);
    return (
      '<article class="catalog-row">' +
        '<div class="catalog-info">' +
          '<h3 class="catalog-nome">' + nome + "</h3>" +
        "</div>" +
        '<div class="catalog-buy">' +
          '<p class="preco"><strong>' + numero(item.preco) + "</strong></p>" +
          '<button class="add-mini" type="button" data-add="' + codigo + '" aria-label="Adicionar ' + nome + ' ao orçamento">Adicionar</button>' +
        "</div>" +
      "</article>"
    );
  }

  function indexarCatalogo() {
    /* Nome e SKU normalizados e o HTML da linha ficam prontos uma vez só; cada tecla apenas compara e junta. */
    indiceBusca = catalogo.map(function (item) {
      return {
        item: item,
        nome: termoDeBusca(item.produto),
        sku: codigoDeBusca(item.codigo),
        html: linhaCatalogo(item)
      };
    });
  }

  function termoDeBusca(valor) {
    return normalizar(valor);
  }

  function codigoDeBusca(valor) {
    /* Os SKUs vêm com ponto de milhar ("7.503"): só letras e dígitos contam, para "7503" achar o produto. */
    return normalizar(valor).replace(/[^a-z0-9]/g, "");
  }

  function resultadoBusca() {
    var termo = termoDeBusca(busca);
    if (!termo) return indiceBusca;
    var codigo = codigoDeBusca(busca);
    var exatos = [];
    var demais = [];
    for (var i = 0; i < indiceBusca.length; i += 1) {
      var entrada = indiceBusca[i];
      if (codigo && entrada.sku === codigo) exatos.push(entrada);
      else if (entrada.nome.startsWith(termo) || (codigo && entrada.sku.startsWith(codigo))) demais.push(entrada);
    }
    /* O SKU digitado por inteiro vem primeiro; o resto mantém a ordem do catálogo. */
    return exatos.length ? exatos.concat(demais) : demais;
  }

  function voltarListaAoTopo() {
    if (!listaEl) return;
    listaEl.scrollTop = 0;
    var modal = listaEl.closest("[data-catalogo-modal]");
    if (modal) modal.scrollTop = 0;
  }

  function htmlDasLinhas(visiveis, inicio, fim) {
    var html = [];
    for (var i = inicio; i < fim && i < visiveis.length; i += 1) html.push(visiveis[i].html);
    return html.join("");
  }

  function renderCatalogo(encontrados) {
    if (!listaEl) return;
    var lote = ++loteCatalogo;
    var visiveis = encontrados || resultadoBusca();
    if (!visiveis.length) {
      listaEl.innerHTML = catalogo.length
        ? '<p class="resumo-vazio catalogo-sem-resultado">Produtos inexistentes</p>'
        : '<p class="resumo-vazio">Catálogo vazio.</p>';
      return;
    }
    /* O topo aparece na mesma tecla; o restante entra nos quadros seguintes e é descartado se outra tecla chegar antes. */
    listaEl.innerHTML = htmlDasLinhas(visiveis, 0, LINHAS_IMEDIATAS);
    var proxima = LINHAS_IMEDIATAS;
    function continuar() {
      if (lote !== loteCatalogo || proxima >= visiveis.length) return;
      listaEl.insertAdjacentHTML("beforeend", htmlDasLinhas(visiveis, proxima, proxima + LINHAS_POR_QUADRO));
      proxima += LINHAS_POR_QUADRO;
      window.requestAnimationFrame(continuar);
    }
    window.requestAnimationFrame(continuar);
  }

  function renderSugestoes(encontrados) {
    if (!sugestoesEl || !buscaEl) return;
    if (!normalizar(busca)) {
      fecharSugestoes();
      return;
    }
    var visiveis = encontrados || resultadoBusca();
    var limite = visiveis.slice(0, 8).map(function (entrada) { return entrada.item; });
    if (!limite.length) {
      /* Sem coincidências o aviso "Produtos inexistentes" fica só na lista do catálogo. */
      fecharSugestoes();
      return;
    }
    sugestoesEl.hidden = false;
    buscaEl.setAttribute("aria-expanded", "true");
    sugestoesEl.innerHTML = limite.map(function (item) {
      var estoque = item.estoque === undefined || item.estoque === null || String(item.estoque).trim() === ""
        ? "—"
        : String(item.estoque);
      return (
        '<li><button type="button" role="option" data-sugestao="' + escapar(item.codigo) + '">' +
          "<strong>" + escapar(item.produto) + "</strong>" +
          "<span>Código (SKU): " + escapar(item.codigo) + " · Estoque: " + escapar(estoque) + " · " + moeda(item.preco) + "</span>" +
        "</button></li>"
      );
    }).join("") + (visiveis.length > limite.length
      ? '<li class="suggest-more">Mostrando 8 de ' + visiveis.length + ". Continue digitando.</li>"
      : "");
  }

  function marcarSugestao(opcoes) {
    Array.prototype.forEach.call(opcoes, function (opcao, indice) {
      opcao.classList.toggle("is-active", indice === sugestaoAtiva);
      if (indice === sugestaoAtiva) opcao.scrollIntoView({ block: "nearest" });
    });
  }

  function escolherSugestao(botao) {
    var opcoes = sugestoesEl ? sugestoesEl.querySelectorAll("[data-sugestao]") : [];
    var escolhido = botao || opcoes[sugestaoAtiva];
    var codigo = escolhido ? escolhido.getAttribute("data-sugestao") : "";
    /* O termo digitado continua no campo e na lista filtrada: só o cliente apaga a busca. */
    fecharSugestoes();
    if (codigo) adicionar(codigo);
    if (buscaEl) buscaEl.focus({ preventScroll: true });
  }

  function fecharSugestoes() {
    sugestaoAtiva = -1;
    if (sugestoesEl) {
      sugestoesEl.hidden = true;
      sugestoesEl.innerHTML = "";
    }
    if (buscaEl) buscaEl.setAttribute("aria-expanded", "false");
  }

  function renderResumo() {
    atualizarValidadeTela();
    if (resumoVazio) resumoVazio.hidden = carrinhoValido();
    var abrirCatalogo = document.querySelector(".hero-acao [data-abrir-catalogo]");
    if (abrirCatalogo) {
      abrirCatalogo.hidden = false;
      abrirCatalogo.style.removeProperty("display");
      abrirCatalogo.style.removeProperty("visibility");
    }
    if (!resumoEl) {
      atualizarTotais();
      return;
    }
    resumoEl.innerHTML = selecionados.map(function (item) {
      var codigo = escapar(item.codigo);
      return (
        '<li class="cart-item">' +
          '<p class="cart-nome"><strong class="cart-prod">Prod.: </strong><span>' + escapar(item.produto) + "</span></p>" +
          '<div class="cart-compacta">' +
            '<strong class="cart-rotulo">Qtd:</strong>' +
            '<span class="cart-seletor">' +
              '<button class="qtd-btn" type="button" data-acao="menos" data-id="' + codigo + '" aria-label="Diminuir quantidade">−</button>' +
              '<span class="qtd-num" data-qtd="' + codigo + '">' + item.qtd + "</span>" +
              '<button class="qtd-btn" type="button" data-acao="mais" data-id="' + codigo + '" aria-label="Aumentar quantidade">+</button>' +
            "</span>" +
            '<strong class="cart-rotulo">Vlr. Unit:</strong>' +
            '<span class="cart-preco">' + (itemVoz(item) ? "Sob consulta" : numero(item.preco)) + "</span>" +
            '<strong class="cart-rotulo">Total:</strong>' +
            '<span class="cart-total" data-linha-total="' + codigo + '">' + (itemVoz(item) ? "Sob consulta" : numero(item.preco * item.qtd)) + "</span>" +
            '<button class="remover" type="button" data-acao="remover" data-id="' + codigo + '" aria-label="Remover" title="Remover">' + icone("lixeira") + "</button>" +
          "</div>" +
        "</li>"
      );
    }).join("");
    atualizarTotais();
  }

  function atualizarTotais() {
    var subtotal = selecionados.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    if (resumoEl) {
      Array.prototype.forEach.call(resumoEl.querySelectorAll("[data-linha-total]"), function (el) {
        var codigo = el.getAttribute("data-linha-total");
        var item = selecionados.find(function (atual) { return atual.codigo === codigo; });
        if (item) el.textContent = itemVoz(item) ? "Sob consulta" : numero(item.preco * item.qtd);
      });
    }
    liberarEnvio();
    if (subtotalEl) subtotalEl.textContent = moeda(subtotal);
  }

  function acharQuantidade(codigo) {
    if (!resumoEl) return null;
    var campos = resumoEl.querySelectorAll("[data-qtd]");
    for (var i = 0; i < campos.length; i += 1) {
      if (campos[i].getAttribute("data-qtd") === codigo) return campos[i];
    }
    return null;
  }

  function destinoWhatsApp() {
    var digitos = String(WHATSAPP).replace(/\D/g, "");
    if (digitos.indexOf("55") !== 0) digitos = "55" + digitos;
    return digitos;
  }

  function textoOrcamento(cliente, id) {
    const idOrcamento = String(id || "").trim();
    const nomeCliente = String(cliente && cliente.tipo || "").toUpperCase() === "PJ"
      ? String((cliente && cliente.razaoSocial) || (cliente && cliente.nome) || "").trim()
      : String((cliente && cliente.nome) || "").trim();
    const celularCliente = String((cliente && cliente.celular) || "").trim();
    if (!idOrcamento) {
      return [
        "Olá, estamos processando sua lista de materiais para orçamento e um especialista irá atendê-lo em breve.",
        "",
        `${nomeCliente} – Contato ${celularCliente}`
      ].join("\n");
    }
    const link = SITE_PDF + "/api/ver-pdf?id=" + idOrcamento;
    return [
      "Olá, clicar no link abaixo para ver a lista dos materiais a serem orçados.",
      "",
      link,
      "",
      `${nomeCliente} – Contato ${celularCliente}`
    ].join("\n");
  }

  function urlWhatsApp(texto) {
    const textoWhats = texto;
    const urlFinal = `https://wa.me/${destinoWhatsApp()}?text=${encodeURIComponent(textoWhats)}`;
    return urlFinal;
  }

  function dispararWhatsApp(texto) {
    const url = urlWhatsApp(texto);
    /* Roda depois do upload do PDF, fora do toque do cliente: o Safari do iPhone bloqueia
       window.open e target="_blank" nesse momento, mas não a navegação da própria aba. */
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = url;
      return;
    }
    /* iPad com iPadOS se apresenta como Mac e bloqueadores de pop-up devolvem null. */
    const aba = window.open(url, "_blank");
    if (!aba) window.location.href = url;
  }

  function honeypotPreenchido() {
    var campo = formCliente && formCliente.elements.sobrenome_confirmacao;
    return !!(campo && String(campo.value || "").trim());
  }

  function soltarBotaoEnvio() {
    if (enviar) enviar.textContent = "Enviar por WhatsApp";
    liberarEnvio();
  }

  function campoIncompleto(campo) {
    if (!campo) return false;
    var valor = String(campo.value || "").trim();
    if (!valor) return true;
    if (campo.name === "documento") {
      var digitos = apenasDigitos(valor);
      return tipoPessoa() === "pj" ? !cnpjValido(digitos) : !cpfValido(digitos);
    }
    if (campo.name === "cep") return apenasDigitos(valor).length !== 8;
    if (campo.name === "uf") return valor.length !== 2;
    if (campo.name === "celular") return !telefoneValido(valor);
    if (campo.name === "email") return !emailValido(valor);
    return false;
  }

  function primeiroCampoIncompleto() {
    if (!formCliente) return null;
    var campos = formCliente.querySelectorAll("input[required]");
    var i;
    for (i = 0; i < campos.length; i += 1) {
      if (campoIncompleto(campos[i])) return campos[i];
    }
    return null;
  }

  function enviarWhatsApp() {
    if (envioEmCurso) return;
    setCatalogo(false);
    /* Enviar por WhatsApp só segue com o formulário amarelo completo e válido. */
    var pendente = primeiroCampoIncompleto();
    if (pendente || !formularioPreenchido()) {
      alert("Favor preencher os dados do cliente");
      if (!pendente && formCliente) pendente = formCliente.querySelector("input[required]");
      if (pendente) pendente.focus();
      return;
    }
    if (enviar) {
      enviar.disabled = true;
      enviar.textContent = "Processando...";
    }
    if (honeypotPreenchido()) {
      limparDepoisDoEnvio();
      return;
    }
    setCatalogo(false);
    var quadroOrcamento = document.querySelector(".quote-side") || document.querySelector("#carrinho");
    var listaVozNaTela = !!(quadroOrcamento && String(quadroOrcamento.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1);
    if (!carrinhoValido() && !listaVozNaTela) {
      mostrarAviso("Adicione ao menos um produto ao orçamento.");
      soltarBotaoEnvio();
      return;
    }
    if (avisoEnvio && (listaVozNaTela || String(avisoEnvio.textContent || "").indexOf("Adicione ao menos um produto") !== -1)) {
      avisoEnvio.classList.remove("gv-aviso-livre");
      avisoEnvio.style.display = "none";
      avisoEnvio.hidden = true;
      if (String(avisoEnvio.textContent || "").indexOf("Adicione ao menos um produto") !== -1) avisoEnvio.textContent = "";
    }
    if (enviar && formularioPreenchido() && (carrinhoValido() || listaVozNaTela)) {
      enviar.disabled = false;
      enviar.removeAttribute("disabled");
    }
    var cliente = lerCliente();
    var erro = validarCliente(cliente);
    if (erro) {
      mostrarAviso(erro);
      soltarBotaoEnvio();
      return;
    }
    var subtotal = selecionados.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    var arquivo;
    try {
      arquivo = new File([gerarPdf(cliente, subtotal)], "Pedido-de-Orcamento-Gigaeletro.pdf", { type: "application/pdf" });
    } catch (falha) {
      mostrarAviso("Não foi possível gerar o PDF do orçamento.");
      soltarBotaoEnvio();
      return;
    }
    var dados = new FormData();
    dados.append("nome", cliente.nome);
    dados.append("tipo", tipoPessoa());
    dados.append("documento", cliente.documento);
    dados.append("email", cliente.email);
    dados.append("cep", cliente.cep);
    dados.append("arquivo", arquivo, "Pedido-de-Orcamento-Gigaeletro.pdf");
    envioEmCurso = true;
    if (enviar) enviar.disabled = true;
    if (avisoEnvio) avisoEnvio.hidden = true;
    var textoSemPdf = textoOrcamento(cliente, "");
    fetch("/api/orcamento-pdf", { method: "POST", body: dados }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (publicado) {
        if (!resposta.ok || !publicado || !publicado.url) {
          throw new Error((publicado && publicado.erro) || "upload");
        }
        return publicado;
      });
    }).then(function (publicado) {
      var link = linkPdf(publicado);
      var idSalvo = publicado.id ? String(publicado.id) : "";
      if (!idSalvo) {
        var trecho = String(link).match(/[?&]id=([^&]+)/);
        if (trecho) idSalvo = decodeURIComponent(trecho[1]);
      }
      cliente.tipo = tipoPessoa();
      var texto = textoOrcamento(cliente, idSalvo);
      return publicarPainel(cliente, idSalvo).then(function () {
        limparDepoisDoEnvio();
        mostrarSucessoEnvio();
        dispararWhatsApp(texto);
      });
    }, function () {
      return publicarPainel(cliente, "").then(function () {
        limparDepoisDoEnvio();
        mostrarSucessoEnvio();
        dispararWhatsApp(textoSemPdf);
      });
    }).then(function () {
      envioEmCurso = false;
      liberarEnvio();
    });
  }

  function pdfEmBase64(blob) {
    return new Promise(function (resolver, rejeitar) {
      var leitor = new FileReader();
      leitor.onload = function () { resolver(String(leitor.result || "").split(",")[1] || ""); };
      leitor.onerror = function () { rejeitar(leitor.error); };
      leitor.readAsDataURL(blob);
    });
  }

  function soltarBotaoEmail() {
    envioEmailEmCurso = false;
    if (enviarEmail) enviarEmail.textContent = "Enviar por E-mail";
    liberarEnvio();
  }

  function enviarPorEmail() {
    if (!EMAIL_ATIVO || envioEmCurso || envioEmailEmCurso) return;
    setCatalogo(false);
    if (!carrinhoValido()) {
      mostrarAviso("Adicione ao menos um produto ao orçamento.");
      return;
    }
    /* Neste envio o e-mail do formulário é o destinatário: ele é conferido antes dos demais campos. */
    var campoEmail = formCliente && formCliente.elements.email;
    var destino = String(campoEmail && campoEmail.value || "").trim();
    if (!destino) {
      mostrarAviso("Informe seu e-mail para receber o orçamento.");
      if (campoEmail) campoEmail.focus();
      return;
    }
    if (!emailValido(destino)) {
      reterCampo("email");
      mostrarAviso("E-mail inválido. Confira o endereço para receber o orçamento.");
      return;
    }
    var pendente = primeiroCampoIncompleto();
    if (pendente || !formularioPreenchido()) {
      alert("Favor preencher os dados do cliente");
      if (!pendente && formCliente) pendente = formCliente.querySelector("input[required]");
      if (pendente) pendente.focus();
      return;
    }
    var cliente = lerCliente();
    var erro = validarCliente(cliente);
    if (erro) {
      mostrarAviso(erro);
      return;
    }
    var subtotal = selecionados.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    var pdf;
    try {
      pdf = gerarPdf(cliente, subtotal);
    } catch (falha) {
      mostrarAviso("Não foi possível gerar o PDF do orçamento.");
      return;
    }
    envioEmailEmCurso = true;
    if (enviarEmail) {
      enviarEmail.disabled = true;
      enviarEmail.textContent = "Enviando...";
    }
    var armadilha = formCliente && formCliente.elements.sobrenome_confirmacao;
    pdfEmBase64(pdf).then(function (base64) {
      return fetch("/api/enviar-orcamento-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: destino,
          nome: cliente.nome,
          pdf: base64,
          site: armadilha ? String(armadilha.value || "") : ""
        })
      });
    }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (corpo) {
        if (!resposta.ok || !corpo || !corpo.ok) throw { erroServidor: corpo && corpo.erro };
      });
    }).then(function () {
      soltarBotaoEmail();
      mostrarAviso("Orçamento enviado para " + destino);
    }, function (falha) {
      soltarBotaoEmail();
      mostrarAviso((falha && falha.erroServidor) || "Não foi possível enviar o e-mail agora. Tente novamente ou use o WhatsApp.");
    });
  }

  function gravarPainelGestor(cliente, pdfId) {
    var corpo = {
      nome: cliente.nome,
      documento: apenasDigitos(cliente.documento),
      telefone: apenasDigitos(cliente.celular),
      pdfId: pdfId || "",
      tipo: cliente.tipo,
      cliente: copiarCliente(cliente),
      itens: selecionados.map(function (item) {
        return {
          codigo: item.codigo,
          produto: item.produto,
          qtd: item.qtd,
          preco: item.preco
        };
      }).concat(itensVoz().map(function (item) {
        return {
          codigo: "",
          produto: String((item && (item.rotulo || item.texto)) || "").trim(),
          qtd: item && item.qtd ? item.qtd : 1,
          preco: 0
        };
      }).filter(function (item) { return item.produto; }))
    };
    return fetch("/api/orcamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (publicado) {
        if (!resposta.ok || !publicado || !publicado.ok) return "";
        return String(publicado.id || "");
      });
    }).catch(function () { return ""; });
  }

  function publicarPainel(cliente, pdfId) {
    var antigo = orcamentoSendoEditadoId;
    var documentoAntigo = orcamentoSendoEditadoDocumento || apenasDigitos(cliente && cliente.documento);
    return gravarPainelGestor(cliente, pdfId).then(function (idPainel) {
      if (!idPainel || !antigo || antigo === idPainel) return idPainel;
      return descartarPainelEditado(antigo, documentoAntigo).then(function () { return idPainel; });
    });
  }

  function descartarPainelEditado(id, documento) {
    var doc = apenasDigitos(documento);
    if (!id || !doc) return Promise.resolve();
    return fetch("/api/orcamentos?id=" + encodeURIComponent(id) + "&documento=" + encodeURIComponent(doc), {
      method: "DELETE",
      cache: "no-store"
    }).catch(function () { return null; });
  }

  var timerSucessoEnvio = 0;

  function mostrarSucessoEnvio() {
    mostrarAviso("Orçamento enviado com sucesso via Whatsapp");
  }

  function encerrarSucessoEnvio() {
    timerSucessoEnvio = 0;
    if (!avisoEnvio || !avisoEnvio.classList.contains("gv-aviso-sucesso")) return;
    avisoEnvio.classList.remove("gv-aviso-sucesso");
    avisoEnvio.hidden = true;
    avisoEnvio.textContent = "";
    if (resumoVazio && !selecionados.length) {
      resumoVazio.hidden = false;
      resumoVazio.textContent = "Nenhum produto no orçamento.";
    }
  }

  function mostrarAviso(texto) {
    if (!avisoEnvio) return;
    if (timerSucessoEnvio) {
      window.clearTimeout(timerSucessoEnvio);
      timerSucessoEnvio = 0;
    }
    var quadro = document.querySelector(".quote-side") || document.querySelector("#carrinho");
    var listaVozNaTela = !!(quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1);
    if (String(texto || "").indexOf("Adicione ao menos um produto") !== -1 && (listaVozNaTela || itensVoz().length >= 1 || vozInclusa())) {
      avisoEnvio.classList.remove("gv-aviso-livre");
      avisoEnvio.style.display = "none";
      avisoEnvio.hidden = true;
      avisoEnvio.textContent = "";
      liberarEnvio();
      return;
    }
    avisoEnvio.classList.add("gv-aviso-livre");
    avisoEnvio.classList.toggle("gv-aviso-sucesso", texto === "Orçamento enviado com sucesso via Whatsapp" || String(texto || "").indexOf("Orçamento enviado para ") === 0);
    avisoEnvio.hidden = false;
    avisoEnvio.style.display = "";
    avisoEnvio.textContent = texto;
    if (avisoEnvio.classList.contains("gv-aviso-sucesso")) {
      timerSucessoEnvio = window.setTimeout(encerrarSucessoEnvio, 30000);
    }
  }

  function lerCliente() {
    var dados = formCliente ? new FormData(formCliente) : new FormData();
    var identificacao = String(dados.get("nome") || "").trim();
    var pj = tipoPessoa() === "pj";
    return {
      tipo: pj ? "pj" : "pf",
      nome: identificacao,
      razaoSocial: pj ? identificacao : "",
      documento: String(dados.get("documento") || "").trim(),
      celular: mascaraTelefone(dados.get("celular") || ""),
      email: String(dados.get("email") || "").trim(),
      endereco: String(dados.get("endereco") || "").trim(),
      numero: String(dados.get("numero") || "").trim(),
      bairro: String(dados.get("bairro") || "").trim(),
      cidade: String(dados.get("cidade") || "").trim(),
      uf: String(dados.get("uf") || "").trim().toUpperCase(),
      cep: String(dados.get("cep") || "").trim()
    };
  }

  function validarCliente(cliente) {
    if (!cliente.nome || !cliente.celular || !cliente.email || !cliente.endereco || !cliente.numero || !cliente.bairro || !cliente.cidade || !cliente.uf || !cliente.cep) {
      return "Preencha nome, celular, e-mail e o endereço completo.";
    }
    if (!telefoneValido(cliente.celular)) {
      reterCampo("celular");
      return "Dado Inválido";
    }
    if (!emailValido(cliente.email)) {
      reterCampo("email");
      return "Dado Inválido";
    }
    if (apenasDigitos(cliente.cep).length !== 8) {
      reterCampo("cep");
      return "Dado Inválido";
    }
    if (cliente.uf.length !== 2) return "Informe a UF com duas letras.";
    var digitos = apenasDigitos(cliente.documento);
    if (tipoPessoa() === "pf" ? !cpfValido(digitos) : !cnpjValido(digitos)) {
      reterCampo("documento");
      return "Dado Inválido";
    }
    limparAvisoCampo(formCliente && formCliente.elements.documento);
    limparAvisoCampo(formCliente && formCliente.elements.email);
    limparAvisoCampo(formCliente && formCliente.elements.cep);
    return "";
  }

  function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function campoMonitorado(campo) {
    return !!(campo && (campo.name === "documento" || campo.name === "cep" || campo.name === "email" || campo.name === "celular"));
  }

  function valorInvalido(campo) {
    var valor = String(campo && campo.value || "").trim();
    if (!valor) return false;
    if (campo.name === "email") return !emailValido(valor);
    if (campo.name === "cep") return apenasDigitos(valor).length !== 8;
    if (campo.name === "celular") return !telefoneValido(valor);
    var digitos = apenasDigitos(valor);
    return tipoPessoa() === "pj" ? !cnpjValido(digitos) : !cpfValido(digitos);
  }

  function avisoDoCampo(campo) {
    if (!campo || !formCliente) return null;
    if (campo.name === "documento") return formCliente.querySelector("[data-doc-aviso]");
    var label = campo.closest("label");
    return label ? label.querySelector("[data-campo-aviso]") : null;
  }

  function mostrarDadoInvalido(campo) {
    if (!campo) return;
    campo.classList.add("is-invalido");
    var aviso = avisoDoCampo(campo);
    if (!aviso) return;
    aviso.hidden = false;
    aviso.textContent = "Dado Inválido";
  }

  function limparAvisoCampo(campo) {
    if (!campo) return;
    campo.classList.remove("is-invalido");
    var aviso = avisoDoCampo(campo);
    if (aviso) aviso.hidden = true;
  }

  function reterCampo(nome) {
    var campo = formCliente && formCliente.elements[nome];
    if (!campo) return;
    mostrarDadoInvalido(campo);
    campo.focus();
  }

  function limparVozDoOrcamento() {
    window.listaIntencoesVoz = [];
    window.listaIntencoes = [];
    window.gvIntencoes = [];
    var campo = document.querySelector('input[name="gv-intencoes"]');
    if (campo) campo.value = "";
    try { sessionStorage.removeItem("gv-intencoes"); } catch (erro) { /* o navegador pode bloquear o armazenamento */ }
    Array.prototype.forEach.call(document.querySelectorAll("[data-gv-voz-resumo]"), function (marcador) {
      marcador.remove();
    });
  }

  function zerarQuadroOrcamento() {
    selecionados = [];
    limparVozDoOrcamento();
    salvarPedido();
    renderResumo();
    if (resumoVazio) {
      resumoVazio.hidden = false;
      resumoVazio.textContent = "Nenhum produto no orçamento.";
    }
    liberarEnvio();
  }

  function limparDepoisDoEnvio() {
    var fisico = formCliente && formCliente.querySelector('input[name="tipo"][value="pf"]');
    if (fisico) fisico.checked = true;
    limparCamposCliente();
    zerarQuadroOrcamento();
    orcamentoSendoEditadoId = "";
    orcamentoSendoEditadoDocumento = "";
    if (enviar) enviar.textContent = "Enviar por WhatsApp";
    document.dispatchEvent(new CustomEvent("gv-orcamento-enviado"));
  }

  function preencherCliente(cliente) {
    if (!formCliente || !cliente) return;
    restaurandoCliente = true;
    var tipo = String(cliente.tipo || "").toLowerCase() === "pj" ? "pj" : "pf";
    var radio = formCliente.querySelector('input[name="tipo"][value="' + tipo + '"]');
    if (radio) radio.checked = true;
    atualizarRotuloDocumento();
    var campos = {
      documento: cliente.documento,
      cep: cliente.cep,
      nome: cliente.nome,
      endereco: cliente.endereco,
      numero: cliente.numero,
      bairro: cliente.bairro,
      cidade: cliente.cidade,
      uf: cliente.uf,
      celular: cliente.celular || cliente.telefone,
      email: cliente.email
    };
    Object.keys(campos).forEach(function (nome) {
      var campo = formCliente.elements[nome];
      if (!campo) return;
      campo.value = String(campos[nome] || "");
      if (nome === "documento") aplicarMascaraDocumento(campo);
      if (nome === "cep") aplicarMascaraCep(campo);
      if (nome === "celular") aplicarMascaraTelefone(campo);
      if (nome === "uf") campo.value = String(campo.value || "").toUpperCase();
      limparAvisoCampo(campo);
    });
    cepPedido = apenasDigitos(campos.cep || "");
    consultaCnpj += 1;
    consultaCep += 1;
    restaurandoCliente = false;
    liberarEnvio();
  }

  function limparCamposCliente() {
    if (!formCliente) return;
    var nomes = ["documento", "cep", "nome", "endereco", "numero", "bairro", "cidade", "uf", "celular", "email", "sobrenome_confirmacao"];
    nomes.forEach(function (nome) {
      var campo = formCliente.elements[nome];
      if (!campo) return;
      campo.value = "";
      limparAvisoCampo(campo);
    });
    cepPedido = "";
    consultaCnpj += 1;
    consultaCep += 1;
    atualizarRotuloDocumento();
    if (avisoEnvio) avisoEnvio.hidden = true;
    liberarEnvio();
  }

  function apenasDigitos(valor) {
    return String(valor || "").replace(/\D/g, "");
  }

  function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    return digitoCpf(cpf, 9) === Number(cpf.charAt(9)) && digitoCpf(cpf, 10) === Number(cpf.charAt(10));
  }

  function digitoCpf(cpf, tamanho) {
    var soma = 0;
    var i;
    for (i = 0; i < tamanho; i += 1) soma += Number(cpf.charAt(i)) * (tamanho + 1 - i);
    var resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  function cnpjValido(cnpj) {
    if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
    var peso1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    var peso2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return digitoCnpj(cnpj, peso1) === Number(cnpj.charAt(12)) && digitoCnpj(cnpj, peso2) === Number(cnpj.charAt(13));
  }

  function digitoCnpj(cnpj, pesos) {
    var soma = 0;
    var i;
    for (i = 0; i < pesos.length; i += 1) soma += Number(cnpj.charAt(i)) * pesos[i];
    var resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  function tipoPessoa() {
    var marcado = formCliente && formCliente.querySelector('input[name="tipo"]:checked');
    return marcado && marcado.value === "pj" ? "pj" : "pf";
  }

  function limiteDocumento() {
    return tipoPessoa() === "pj" ? 14 : 11;
  }

  function mascaraDocumento(digitos) {
    var d = String(digitos || "").slice(0, limiteDocumento());
    if (tipoPessoa() === "pj") {
      var cnpj = d.slice(0, 2);
      if (d.length > 2) cnpj += "." + d.slice(2, 5);
      if (d.length > 5) cnpj += "." + d.slice(5, 8);
      if (d.length > 8) cnpj += "/" + d.slice(8, 12);
      if (d.length > 12) cnpj += "-" + d.slice(12, 14);
      return cnpj;
    }
    var cpf = d.slice(0, 3);
    if (d.length > 3) cpf += "." + d.slice(3, 6);
    if (d.length > 6) cpf += "." + d.slice(6, 9);
    if (d.length > 9) cpf += "-" + d.slice(9, 11);
    return cpf;
  }

  function posicaoAposDigitos(texto, quantidade) {
    if (quantidade <= 0) return 0;
    var vistos = 0;
    var i;
    for (i = 0; i < texto.length; i += 1) {
      if (/\d/.test(texto.charAt(i))) {
        vistos += 1;
        if (vistos === quantidade) return i + 1;
      }
    }
    return texto.length;
  }

  function mascaraTelefone(valor) {
    var d = apenasDigitos(valor).slice(0, 11);
    if (d.length < 3) return d.length ? "(" + d : "";
    if (d.length < 7) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length < 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function aplicarMascaraTelefone(campo) {
    if (!campo) return;
    var inicio = campo.selectionStart;
    var digitosAntes = apenasDigitos(String(campo.value || "").slice(0, inicio == null ? 0 : inicio)).length;
    if (digitosAntes > 11) digitosAntes = 11;
    var formatado = mascaraTelefone(campo.value);
    if (campo.value !== formatado) campo.value = formatado;
    if (document.activeElement === campo && campo.setSelectionRange) {
      var nova = posicaoAposDigitos(campo.value, digitosAntes);
      campo.setSelectionRange(nova, nova);
    }
  }

  function telefoneValido(valor) {
    var d = apenasDigitos(valor);
    if (d.length !== 10 && d.length !== 11) return false;
    var ddd = Number(d.slice(0, 2));
    return ddd >= 11 && ddd <= 99;
  }

  function aplicarMascaraDocumento(campo) {
    if (!campo) return;
    var inicio = campo.selectionStart;
    var digitosAntes = apenasDigitos(String(campo.value || "").slice(0, inicio == null ? 0 : inicio)).length;
    var limite = limiteDocumento();
    if (digitosAntes > limite) digitosAntes = limite;
    var formatado = mascaraDocumento(apenasDigitos(campo.value));
    if (campo.value !== formatado) campo.value = formatado;
    if (document.activeElement === campo && campo.setSelectionRange) {
      var nova = posicaoAposDigitos(campo.value, digitosAntes);
      campo.setSelectionRange(nova, nova);
    }
  }

  function atualizarRotuloDocumento() {
    if (!formCliente) return;
    var rotulo = formCliente.querySelector("[data-doc-rotulo]");
    var campo = formCliente.elements.documento;
    var pj = tipoPessoa() === "pj";
    var rotuloNome = formCliente.querySelector("[data-nome-rotulo]");
    if (rotuloNome) rotuloNome.textContent = pj ? "Razão Social" : "Nome";
    if (rotulo) rotulo.textContent = pj ? "CNPJ" : "CPF";
    if (!campo) return;
    campo.placeholder = pj ? "00.000.000/0000-00" : "000.000.000-00";
    campo.removeAttribute("maxlength");
  }

  function consultarCnpjSeCompleto() {
    var campo = formCliente && formCliente.elements.documento;
    if (!campo || tipoPessoa() !== "pj") return;
    var digitos = apenasDigitos(campo.value);
    if (digitos.length === 14 && cnpjValido(digitos)) consultarCnpj(digitos);
  }

  function formularioPreenchido() {
    if (!formCliente) return false;
    var nomes = ["nome", "documento", "celular", "email", "endereco", "numero", "bairro", "cidade", "uf", "cep"];
    var i;
    for (i = 0; i < nomes.length; i += 1) {
      var campo = formCliente.elements[nomes[i]];
      if (!campo || !String(campo.value || "").trim()) return false;
    }
    return true;
  }

  function itensVoz() {
    var lista = window.listaIntencoesVoz;
    if (Array.isArray(lista) && lista.length) return lista;
    var extra = window.gvIntencoes;
    if (Array.isArray(extra) && extra.length) {
      window.listaIntencoesVoz = extra;
      return extra;
    }
    var campo = document.querySelector('input[name="gv-intencoes"]');
    if (campo && String(campo.value || "").trim()) {
      try {
        var dados = JSON.parse(campo.value);
        if (Array.isArray(dados) && dados.length) {
          window.listaIntencoesVoz = dados;
          return dados;
        }
      } catch (erro) { /* o campo oculto pode estar vazio */ }
    }
    try {
      var guardado = sessionStorage.getItem("gv-intencoes");
      if (guardado) {
        var salvo = JSON.parse(guardado);
        var itens = salvo && (salvo.itens || salvo);
        if (Array.isArray(itens) && itens.length) {
          window.listaIntencoesVoz = itens;
          return itens;
        }
      }
    } catch (erroGuardado) { /* o navegador pode bloquear o armazenamento */ }
    return [];
  }

  function marcadorVozNoDom() {
    var quadro = document.querySelector(".quote-side");
    if (quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1) return true;
    var marcador = document.querySelector("[data-gv-voz-resumo]");
    return !!(marcador && String(marcador.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1);
  }

  function vozInclusa() {
    return itensVoz().length > 0 || marcadorVozNoDom();
  }

  function ocultarErroCarrinho() {
    if (!avisoEnvio) return;
    if (String(avisoEnvio.textContent || "").indexOf("Adicione ao menos um produto") === -1) return;
    avisoEnvio.style.display = "none";
    avisoEnvio.hidden = true;
    avisoEnvio.textContent = "";
  }

  function itemVoz(item) {
    return String(item && item.codigo || "").indexOf("voz-") === 0;
  }

  function incluirItensVoz(pacote) {
    if (!Array.isArray(pacote)) return;
    /* Confirmar a lista de voz substitui os itens de catálogo. A troca de modo não faz isso. */
    if (selecionados.some(function (item) { return !itemVoz(item); })) selecionados = [];
    var carimbo = Date.now().toString(36);
    pacote.forEach(function (item, indice) {
      var nome = String((item && (item.rotulo || item.texto)) || "").trim();
      if (!nome) return;
      selecionados.push({
        codigo: "voz-" + carimbo + "-" + indice,
        produto: nome,
        preco: 0,
        estoque: 0,
        qtd: item && item.qtd ? item.qtd : 1
      });
    });
    salvarPedido();
    renderResumo();
    liberarEnvio();
  }

  function carrinhoValido() {
    var quadro = document.querySelector(".quote-side") || document.querySelector("#carrinho");
    var listaVozNaTela = !!(quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1);
    return selecionados.length > 0 || itensVoz().length >= 1 || listaVozNaTela;
  }

  function clienteCompleto() {
    return formularioPreenchido() && !primeiroCampoIncompleto();
  }

  function avisarClientePronto() {
    if (clienteAvisado || !clienteCompleto()) return;
    clienteAvisado = true;
    document.dispatchEvent(new CustomEvent("gv-cliente-pronto"));
  }

  function acompanharCliente(imediato) {
    window.clearTimeout(timerClientePronto);
    if (!clienteCompleto()) {
      clienteAvisado = false;
      return;
    }
    if (clienteAvisado) return;
    /* E-mail e número já passam na validação no meio da digitação: espera a pausa ou a saída do campo.
       Na saída, a folga curta deixa o navegador concluir a troca de foco antes de a escolha assumir. */
    timerClientePronto = window.setTimeout(avisarClientePronto, imediato ? 150 : 1500);
  }

  function liberarEnvio() {
    acompanharCliente(false);
    if (limparOrcamento) limparOrcamento.hidden = !carrinhoValido();
    if (enviarEmail && !envioEmailEmCurso) enviarEmail.disabled = !EMAIL_ATIVO || envioEmCurso || !carrinhoValido();
    if (!enviar || envioEmCurso) return;
    var quadro = document.querySelector(".quote-side") || document.querySelector("#carrinho");
    var listaVozNaTela = !!(quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1);
    if (itensVoz().length >= 1 || listaVozNaTela) {
      ocultarErroCarrinho();
      if (resumoVazio) resumoVazio.hidden = true;
    }
    /* O botão fica clicável com itens no quadro; a checagem do cliente acontece no clique. */
    var liberar = carrinhoValido();
    enviar.disabled = !liberar;
    if (liberar) enviar.removeAttribute("disabled");
  }

  function consultarCnpj(cnpj) {
    var ticket = consultaCnpj + 1;
    consultaCnpj = ticket;
    mostrarAviso("Consultando o CNPJ…");
    fetch("https://brasilapi.com.br/api/cnpj/v1/" + cnpj).then(function (resposta) {
      if (!resposta.ok) throw new Error("nao encontrado");
      return resposta.json();
    }).then(function (dados) {
      if (ticket !== consultaCnpj || !formCliente || !dados) return;
      preencherSeVier("nome", dados.razao_social || dados.nome);
      preencherSeVier("endereco", dados.logradouro);
      preencherSeVier("numero", dados.numero);
      preencherSeVier("bairro", dados.bairro);
      preencherSeVier("cidade", dados.municipio);
      preencherSeVier("uf", dados.uf ? String(dados.uf).toUpperCase() : "");
      var cep = apenasDigitos(dados.cep);
      if (cep.length === 8) preencherSeVier("cep", formatarCep(cep));
      if (avisoEnvio) avisoEnvio.hidden = true;
      atualizarTotais();
      var endereco = formCliente.elements.endereco;
      if (cep.length === 8 && endereco && !String(endereco.value || "").trim()) consultarCep(cep);
      else focarAposConsulta();
    }).catch(function () {
      if (ticket !== consultaCnpj) return;
      mostrarAviso("Não consegui consultar o CNPJ. Preencha o endereço.");
    });
  }

  function preencherSeVier(nome, valor) {
    var campo = formCliente && formCliente.elements[nome];
    if (!campo || valor === undefined || valor === null || String(valor).trim() === "") return;
    campo.value = String(valor).trim();
  }

  function formatarCep(valor) {
    var digitos = apenasDigitos(valor).slice(0, 8);
    if (digitos.length < 6) return digitos;
    return digitos.slice(0, 5) + "-" + digitos.slice(5);
  }

  function aplicarMascaraCep(campo) {
    if (!campo) return;
    var inicio = campo.selectionStart;
    var digitosAntes = apenasDigitos(String(campo.value || "").slice(0, inicio == null ? 0 : inicio)).length;
    if (digitosAntes > 8) digitosAntes = 8;
    var formatado = formatarCep(campo.value);
    if (campo.value !== formatado) campo.value = formatado;
    if (document.activeElement === campo && campo.setSelectionRange) {
      var nova = posicaoAposDigitos(campo.value, digitosAntes);
      campo.setSelectionRange(nova, nova);
    }
  }

  function focarAposConsulta() {
    if (!formCliente) return;
    var campo = formCliente.elements[tipoPessoa() === "pf" ? "nome" : "numero"];
    if (campo) campo.focus();
  }

  function aplicarEnderecoCep(dados) {
    preencherSeVier("endereco", dados.logradouro || dados.street);
    preencherSeVier("bairro", dados.bairro || dados.neighborhood);
    preencherSeVier("cidade", dados.localidade || dados.city);
    preencherSeVier("uf", dados.uf || dados.state);
  }

  function consultarCep(cep) {
    if (!cep || cep === cepPedido) return;
    cepPedido = cep;
    var ticket = consultaCep + 1;
    consultaCep = ticket;
    mostrarAviso("Consultando o CEP…");
    fetch("https://viacep.com.br/ws/" + cep + "/json/").then(function (resposta) {
      if (!resposta.ok) throw new Error("viacep");
      return resposta.json();
    }).then(function (dados) {
      if (dados && dados.erro) throw new Error("cep-invalido");
      return dados;
    }).catch(function (falha) {
      if (falha && falha.message === "cep-invalido") throw falha;
      return fetch("https://brasilapi.com.br/api/cep/v2/" + cep).then(function (resposta) {
        if (resposta.status === 404) throw new Error("cep-invalido");
        if (!resposta.ok) throw new Error("brasilapi");
        return resposta.json();
      });
    }).then(function (dados) {
      if (ticket !== consultaCep || !formCliente || !dados) return;
      aplicarEnderecoCep(dados);
      preencherSeVier("cep", formatarCep(cep));
      if (avisoEnvio) avisoEnvio.hidden = true;
      atualizarTotais();
      focarAposConsulta();
    }).catch(function (falha) {
      if (ticket !== consultaCep) return;
      cepPedido = "";
      if (falha && falha.message === "cep-invalido") {
        reterCampo("cep");
        mostrarAviso("Dado Inválido");
        return;
      }
      mostrarAviso("Não consegui consultar o CEP. Preencha o endereço.");
    });
  }

  function gerarPdf(cliente, subtotal) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jspdf");
    var dataCriacao = new Date();
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var margem = 12;
    var largura = doc.internal.pageSize.getWidth();
    var altura = doc.internal.pageSize.getHeight();
    var util = largura - margem * 2;
    var alturaRodape = 24;
    var yRodape = altura - margem - alturaRodape;
    var alturaCabeca = 8;
    var alturaLinha = 8;
    var colunas = [
      { titulo: "Itens", largura: 9, alinhamento: "center" },
      { titulo: "Código", largura: 14, alinhamento: "center" },
      { titulo: "Nome", largura: 0, alinhamento: "left" },
      { titulo: "Qte", largura: 16, alinhamento: "center" },
      { titulo: "Pr.Unitário", largura: 20.8, alinhamento: "right" },
      { titulo: "Total", largura: 25.2, alinhamento: "right" }
    ];
    colunas[2].largura = util - colunas.reduce(function (soma, coluna) { return soma + coluna.largura; }, 0);

    function traco() {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.setTextColor(0, 0, 0);
    }

    function textoCelula(x, y, w, h, rotulo, valor) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      var prefixo = rotulo + " ";
      var larguraRotulo = doc.getTextWidth(prefixo);
      doc.setFont("helvetica", "normal");
      var linhas = doc.splitTextToSize(String(valor || ""), Math.max(8, w - larguraRotulo - 3.2));
      if (!linhas.length) linhas = [""];
      linhas = linhas.slice(0, 2);
      var base = y + (h - linhas.length * 3.4) / 2 + 2.8;
      doc.setFont("helvetica", "bold");
      doc.text(prefixo, x + 1.6, base);
      doc.setFont("helvetica", "normal");
      doc.text(linhas, x + 1.6 + larguraRotulo, base);
    }

    function desenharCliente(y) {
      var alturas = [11, 11, 11, 11];
      var linhas = [
        [["Nome:", cliente.nome, 0.5], ["CPF/CNPJ:", cliente.documento, 0.5]],
        [["End:", cliente.endereco, 0.72], ["Nr:", cliente.numero, 0.28]],
        [
          ["Cidade:", cliente.cidade, 0.34],
          ["Bairro:", cliente.bairro, 0.34],
          ["UF:", cliente.uf, 0.12],
          ["CEP:", cliente.cep, 0.2]
        ],
        [["Telefone / Celular:", cliente.celular, 0.5], ["e-mail:", cliente.email, 0.5]]
      ];
      var alturaGrade = alturas.reduce(function (soma, atual) { return soma + atual; }, 0);
      traco();
      doc.rect(margem, y, util, alturaGrade);
      var yLinha = y;
      linhas.forEach(function (campos, indice) {
        if (indice > 0) doc.line(margem, yLinha, margem + util, yLinha);
        var x = margem;
        campos.forEach(function (campo, posicao) {
          var w = util * campo[2];
          if (posicao > 0) doc.line(x, yLinha, x, yLinha + alturas[indice]);
          textoCelula(x, yLinha, w, alturas[indice], campo[0], campo[1]);
          x += w;
        });
        yLinha += alturas[indice];
      });
      return yLinha;
    }

    function desenharTabela(y, h, itens, inicio) {
      traco();
      doc.setFillColor(255, 255, 255);
      doc.rect(margem, y, util, h, "S");
      doc.line(margem, y + alturaCabeca, margem + util, y + alturaCabeca);
      var x = margem;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      colunas.forEach(function (coluna, indice) {
        if (indice > 0) doc.line(x, y, x, y + h);
        var tamanhoCabeca = 8;
        doc.setFontSize(tamanhoCabeca);
        while (tamanhoCabeca > 6 && doc.getTextWidth(coluna.titulo) > coluna.largura - 1.2) {
          tamanhoCabeca -= 0.5;
          doc.setFontSize(tamanhoCabeca);
        }
        doc.text(coluna.titulo, x + coluna.largura / 2, y + 5.2, { align: "center" });
        x += coluna.largura;
      });
      doc.setFont("helvetica", "normal");
      itens.forEach(function (item, indice) {
        var codigoCelula = itemVoz(item) ? "" : String(item.codigo || "").replace(/^voz-.*$/i, "");
        var nomeCelula = String(item.produto || "").replace(/^voz-[a-z0-9]+-\d+\s*-\s*/i, "");
        if (itemVoz(item)) nomeCelula = nomeCelula.replace(/^\d+\s*-\s*/, "");
        nomeCelula = nomeCelula.trim();
        var valores = [
          String(inicio + indice + 1),
          codigoCelula,
          nomeCelula,
          String(item.qtd),
          numero(item.preco),
          numero(item.preco * item.qtd)
        ];
        var yTexto = y + alturaCabeca + indice * alturaLinha + 5.2;
        x = margem;
        valores.forEach(function (valor, posicao) {
          var coluna = colunas[posicao];
          var texto = valor;
          var tamanho = 8;
          if (posicao === 2) {
            var limite = Math.max(12, coluna.largura - 3);
            tamanho = 8;
            while (tamanho > 6.5) {
              doc.setFontSize(tamanho);
              if (doc.getTextWidth(valor) <= limite) break;
              tamanho -= 0.5;
            }
            doc.setFontSize(tamanho);
            if (doc.getTextWidth(valor) > limite) {
              texto = doc.splitTextToSize(valor, limite);
            }
          }
          var tx = x + 1.5;
          if (coluna.alinhamento === "center") tx = x + coluna.largura / 2;
          if (coluna.alinhamento === "right") tx = x + coluna.largura - 1.5;
          var base = Array.isArray(texto) ? yTexto - 1.6 : yTexto;
          doc.setFontSize(posicao === 2 ? tamanho : 8);
          doc.text(texto, tx, base, { align: coluna.alinhamento });
          x += coluna.largura;
        });
      });
    }

    function desenharRodape() {
      var larguraTotal = 58;
      var xTotal = margem + util - larguraTotal;
      var nota = "Nota: " + textoValidade(dataCriacao);
      traco();
      doc.rect(margem, yRodape, util - larguraTotal, alturaRodape);
      doc.rect(xTotal, yRodape, larguraTotal, alturaRodape);
      doc.line(xTotal, yRodape + alturaRodape / 2, xTotal + larguraTotal, yRodape + alturaRodape / 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      var linhas = doc.splitTextToSize(nota, util - larguraTotal - 6);
      var baseNota = yRodape + (alturaRodape - linhas.length * 3.5) / 2 + 3;
      doc.text(linhas, margem + 3, baseNota);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Valor Total", xTotal + larguraTotal / 2, yRodape + 7.2, { align: "center" });
      doc.setFontSize(12);
      doc.text(moeda(subtotal), xTotal + larguraTotal / 2, yRodape + alturaRodape / 2 + 7.4, { align: "center" });
    }

    var itensDocumento = selecionados.slice();
    itensVoz().forEach(function (item) {
      var nome = String((item && (item.rotulo || item.texto)) || "").trim();
      if (!nome) return;
      itensDocumento.push({ codigo: "", produto: nome, qtd: item.qtd || 1, preco: 0 });
    });
    var inicioItem = 0;
    var primeira = true;
    var acabou = false;
    while (!acabou) {
      if (!primeira) doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(0, 0, 0);
      var alturaLogo = 12;
      var larguraLogo = alturaLogo * 366 / 184;
      if (logoPdf.complete && logoPdf.naturalWidth) {
        doc.addImage(logoPdf, "JPEG", margem, 16 - 2.2 - alturaLogo / 2, larguraLogo, alturaLogo);
      }
      doc.text("PEDIDO DE ORÇAMENTO", largura / 2, 16, { align: "center" });
      var yTabela = primeira ? desenharCliente(22) + 6 : 24;
      var lote = itensDocumento.slice(inicioItem, inicioItem + Math.max(1, Math.floor((yRodape - 4 - yTabela - alturaCabeca) / alturaLinha)));
      desenharTabela(yTabela, yRodape - 4 - yTabela, lote, inicioItem);
      inicioItem += lote.length;
      acabou = inicioItem >= itensDocumento.length;
      if (acabou) desenharRodape();
      primeira = false;
    }
    return doc.output("blob");
  }

  function setRestrita(aberto) {
    if (aberto) {
      setCatalogo(false);
      setHistorico(false);
    }
    if (!restrita || !restritaOverlay) return;
    restrita.hidden = !aberto;
    restritaOverlay.hidden = !aberto;
    document.body.classList.toggle("drawer-open", aberto);
    if (restritaErro) restritaErro.hidden = true;
    if (!aberto && formRestrita) formRestrita.reset();
    if (aberto) {
      var campo = formRestrita && formRestrita.querySelector("input");
      if (campo) campo.focus();
    }
  }

  function carregarPublicado() {
    fetch("/api/catalogo", { cache: "no-store" }).then(function (resposta) {
      if (!resposta.ok) return fetch("data/catalogo.json", { cache: "no-store" });
      return resposta;
    }).catch(function () {
      return fetch("data/catalogo.json", { cache: "no-store" });
    }).then(function (resposta) {
      if (!resposta || !resposta.ok) return [];
      return resposta.json();
    }).then(function (dados) {
      catalogo = Array.isArray(dados) ? dados.filter(function (item) {
        return item && item.produto && isFinite(item.preco);
      }) : [];
      indexarCatalogo();
      renderCatalogo();
    }).catch(function () {
      catalogo = [];
      indexarCatalogo();
      renderCatalogo();
    });
  }

  function linkPdf(publicado) {
    var id = publicado && publicado.id ? String(publicado.id) : "";
    if (!id && publicado && publicado.url) {
      var achado = String(publicado.url).match(/[?&]id=([^&]+)/);
      if (achado) id = decodeURIComponent(achado[1]);
    }
    if (!id) return publicado && publicado.url ? String(publicado.url) : "";
    return SITE_PDF + "/api/ver-pdf?id=" + encodeURIComponent(id);
  }

  function copiarItens(lista) {
    return (lista || []).map(function (item) {
      return {
        codigo: String(item.codigo || ""),
        produto: String(item.produto || ""),
        preco: Number(item.preco),
        estoque: item.estoque,
        qtd: Number(item.qtd)
      };
    }).filter(function (item) {
      return item.codigo && item.produto && isFinite(item.preco) && item.qtd > 0;
    });
  }

  function copiarCliente(cliente) {
    var origem = cliente || {};
    return {
      tipo: String(origem.tipo || "").toLowerCase() === "pj" ? "pj" : "pf",
      nome: String(origem.nome || ""),
      documento: String(origem.documento || ""),
      celular: String(origem.celular || ""),
      email: String(origem.email || ""),
      endereco: String(origem.endereco || ""),
      numero: String(origem.numero || ""),
      bairro: String(origem.bairro || ""),
      cidade: String(origem.cidade || ""),
      uf: String(origem.uf || "").toUpperCase(),
      cep: String(origem.cep || "")
    };
  }

  function mascaraBuscaDocumento(digitos) {
    var d = String(digitos || "").replace(/\D/g, "").slice(0, 14);
    if (d.length <= 11) {
      var cpf = d.slice(0, 3);
      if (d.length > 3) cpf += "." + d.slice(3, 6);
      if (d.length > 6) cpf += "." + d.slice(6, 9);
      if (d.length > 9) cpf += "-" + d.slice(9, 11);
      return cpf;
    }
    var cnpj = d.slice(0, 2);
    if (d.length > 2) cnpj += "." + d.slice(2, 5);
    if (d.length > 5) cnpj += "." + d.slice(5, 8);
    if (d.length > 8) cnpj += "/" + d.slice(8, 12);
    if (d.length > 12) cnpj += "-" + d.slice(12, 14);
    return cnpj;
  }

  function aplicarMascaraBusca(campo) {
    if (!campo) return;
    var inicio = campo.selectionStart;
    var digitosAntes = apenasDigitos(String(campo.value || "").slice(0, inicio == null ? 0 : inicio)).length;
    if (digitosAntes > 14) digitosAntes = 14;
    var formatado = mascaraBuscaDocumento(campo.value);
    if (campo.value !== formatado) campo.value = formatado;
    if (document.activeElement === campo && campo.setSelectionRange) {
      var nova = posicaoAposDigitos(campo.value, digitosAntes);
      campo.setSelectionRange(nova, nova);
    }
  }

  function documentoBuscaValido(digitos) {
    if (digitos.length === 11) return cpfValido(digitos);
    if (digitos.length === 14) return cnpjValido(digitos);
    return false;
  }

  function buscarHistorico(event) {
    if (event) event.preventDefault();
    var campo = document.querySelector("[data-historico-documento]");
    var erro = document.querySelector("[data-historico-erro]");
    var docLimpo = String(campo ? campo.value : "").replace(/\D/g, "");
    var pedido = ++historicoPedido;
    if (!documentoBuscaValido(docLimpo)) {
      documentoConsulta = "";
      historicoConsulta = [];
      historicoBuscando = false;
      if (erro) {
        erro.hidden = false;
        erro.textContent = "CPF ou CNPJ inválido";
      }
      renderRecentes();
      if (campo) campo.focus();
      return;
    }
    documentoConsulta = docLimpo;
    historicoConsulta = [];
    historicoBuscando = true;
    if (erro) erro.hidden = true;
    renderRecentes();
    fetch("/api/orcamentos?documento=" + encodeURIComponent(docLimpo), { cache: "no-store" }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (corpo) {
        if (!resposta.ok || !corpo || !corpo.ok || !Array.isArray(corpo.orcamentos)) {
          throw new Error("busca");
        }
        return corpo.orcamentos;
      });
    }).then(function (lista) {
      if (pedido !== historicoPedido) return;
      historicoBuscando = false;
      historicoConsulta = lista.map(registroHistorico).filter(function (item) { return item.id; });
      renderRecentes();
    }).catch(function () {
      if (pedido !== historicoPedido) return;
      historicoBuscando = false;
      historicoConsulta = [];
      if (erro) {
        erro.hidden = false;
        erro.textContent = "Não foi possível consultar os orçamentos.";
      }
      renderRecentes();
    });
  }

  function documentoDoRegistro(item) {
    if (!item) return "";
    return apenasDigitos(item.documento || (item.cliente && item.cliente.documento) || "");
  }

  function icone(tipo) {
    var comum = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (tipo === "lixeira") {
      return '<svg ' + comum + '><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
    }
    if (tipo === "olho") {
      return '<svg ' + comum + '><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    return '<svg ' + comum + '><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  }

  function registroHistorico(item) {
    var origem = item || {};
    var clienteSalvo = origem.cliente && typeof origem.cliente === "object" ? origem.cliente : {};
    var documento = apenasDigitos(origem.documento || clienteSalvo.documento || "");
    var cliente = copiarCliente(Object.assign({
      tipo: documento.length > 11 ? "pj" : "pf",
      nome: String(origem.nome || ""),
      documento: documento,
      celular: String(origem.telefone || "")
    }, clienteSalvo));
    cliente.documento = documento;
    return {
      id: String(origem.id || ""),
      pdfId: String(origem.pdfId || ""),
      data: String(origem.data || ""),
      nome: String(origem.nome || cliente.nome || ""),
      documento: documento,
      total: Number(origem.total) || 0,
      itens: copiarItens(origem.itens),
      cliente: cliente
    };
  }

  function excluirRecente(id) {
    var registro = historicoConsulta.find(function (item) { return item.id === id; });
    if (!registro || !documentoConsulta) return;
    var nome = registro.nome || "este cliente";
    if (!window.confirm("Excluir o orçamento de " + nome + "?")) return;
    fetch("/api/orcamentos?id=" + encodeURIComponent(id) + "&documento=" + encodeURIComponent(documentoConsulta), {
      method: "DELETE",
      cache: "no-store"
    }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (corpo) {
        if (!resposta.ok || !corpo || !corpo.ok) throw new Error("excluir");
      });
    }).then(function () {
      if (orcamentoSendoEditadoId === id) {
        orcamentoSendoEditadoId = "";
        orcamentoSendoEditadoDocumento = "";
      }
      historicoConsulta = historicoConsulta.filter(function (item) { return item.id !== id; });
      renderRecentes();
    }).catch(function () {
      window.alert("Não foi possível excluir o orçamento.");
    });
  }

  function editarRecente(id) {
    if (document.body.dataset.gvCatalogoTravado === "1" || selecionados.some(itemVoz)) {
      window.alert("Envie o orçamento ou clique em Início antes de abrir outro orçamento.");
      return;
    }
    var registro = historicoConsulta.find(function (item) { return item.id === id; });
    var itens = registro ? copiarItens(registro.itens) : [];
    if (!itens.length) {
      mostrarAviso("Este orçamento não tem itens salvos para editar. Use Abrir PDF.");
      return;
    }
    selecionados = itens;
    orcamentoSendoEditadoId = String(id || "");
    orcamentoSendoEditadoDocumento = registro.documento || documentoConsulta;
    salvarPedido();
    renderResumo();
    if (registro.cliente) preencherCliente(registro.cliente);
    if (enviar) enviar.textContent = "Enviar por WhatsApp";
    liberarEnvio();
    if (avisoEnvio) avisoEnvio.hidden = true;
    if (resumoEl) resumoEl.scrollTop = 0;
  }

  function formatarEnvio(iso) {
    var texto = String(iso || "");
    var soData = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (soData) return soData[3] + "/" + soData[2] + "/" + soData[1];
    var data = new Date(texto);
    if (isNaN(data.getTime())) return "";
    function dois(numero) { return String(numero).padStart(2, "0"); }
    return dois(data.getDate()) + "/" + dois(data.getMonth() + 1) + "/" + data.getFullYear() + " " + dois(data.getHours()) + ":" + dois(data.getMinutes());
  }

  function renderRecentes() {
    var lista = document.querySelector("[data-recentes-lista]");
    var vazio = document.querySelector("[data-historico-vazio]");
    if (!lista) return;
    lista.textContent = "";
    if (!documentoConsulta) {
      if (vazio) vazio.hidden = true;
      return;
    }
    if (historicoBuscando) {
      if (vazio) {
        vazio.hidden = false;
        vazio.textContent = "Buscando orçamentos...";
      }
      return;
    }
    var itens = historicoConsulta.filter(function (item) {
      return documentoDoRegistro(item) === documentoConsulta;
    });
    if (vazio) {
      vazio.hidden = itens.length > 0;
      vazio.textContent = "Nenhum orçamento salvo para este CPF/CNPJ";
    }
    itens.forEach(function (item) {
      var linha = document.createElement("li");
      var quando = document.createElement("span");
      quando.textContent = formatarEnvio(item.data) + " · " + moeda(item.total);
      var acoes = document.createElement("span");
      acoes.className = "historico-acoes";
      if (item.pdfId) {
        var abrir = document.createElement("a");
        abrir.href = SITE_PDF + "/api/ver-pdf?id=" + encodeURIComponent(item.pdfId);
        abrir.target = "_blank";
        abrir.rel = "noopener noreferrer";
        abrir.innerHTML = icone("olho");
        abrir.setAttribute("aria-label", "Visualizar");
        abrir.title = "Visualizar";
        acoes.appendChild(abrir);
      } else {
        var semPdf = document.createElement("button");
        semPdf.type = "button";
        semPdf.innerHTML = icone("olho");
        semPdf.setAttribute("aria-label", "Visualizar");
        semPdf.title = "Visualizar";
        semPdf.addEventListener("click", function () {
          mostrarAviso("Este orçamento não tem PDF salvo para visualizar.");
        });
        acoes.appendChild(semPdf);
      }
      var editar = document.createElement("button");
      editar.type = "button";
      editar.setAttribute("data-editar-orcamento", item.id);
      editar.innerHTML = icone("lapis");
      editar.setAttribute("aria-label", "Alterar");
      editar.title = "Alterar";
      var excluir = document.createElement("button");
      excluir.type = "button";
      excluir.className = "historico-excluir";
      excluir.setAttribute("data-excluir-orcamento", item.id);
      excluir.innerHTML = icone("lixeira");
      excluir.setAttribute("aria-label", "Excluir");
      excluir.title = "Excluir";
      acoes.appendChild(editar);
      acoes.appendChild(excluir);
      linha.appendChild(quando);
      linha.appendChild(acoes);
      lista.appendChild(linha);
    });
  }

  function lerRascunho() {
    var salvo = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || "null");
    if (salvo && !Array.isArray(salvo)) {
      if (Date.now() - (Number(salvo.salvoEm) || 0) > VALIDADE_RASCUNHO) {
        localStorage.removeItem(CHAVE_RASCUNHO);
        return [];
      }
      return salvo.itens;
    }
    if (salvo) return salvo;
    /* Rascunho da versão anterior, guardado só na aba. */
    var antigo = JSON.parse(sessionStorage.getItem(CHAVE_PEDIDO) || "[]");
    sessionStorage.removeItem(CHAVE_PEDIDO);
    if (Array.isArray(antigo) && antigo.length) {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ itens: antigo, salvoEm: Date.now() }));
    }
    return antigo;
  }

  function carregarPedido() {
    try {
      var dados = lerRascunho();
      if (!Array.isArray(dados)) return [];
      return dados.filter(function (item) {
        return item && item.codigo && item.produto && isFinite(item.preco) && item.qtd > 0;
      });
    } catch (erro) {
      return [];
    }
  }

  function salvarPedido() {
    try {
      if (selecionados.length) {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ itens: selecionados, salvoEm: Date.now() }));
      } else {
        localStorage.removeItem(CHAVE_RASCUNHO);
      }
    } catch (erro) { /* modo privado ou cota cheia: o orçamento segue só na memória */ }
  }

  function restaurarRascunho() {
    selecionados = carregarPedido();
    salvarPedido();
    renderResumo();
    liberarEnvio();
  }

  function numero(valor) {
    var partes = Math.abs(Number(valor) || 0).toFixed(2).split(".");
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return inteiro + "," + partes[1];
  }

  function moeda(valor) {
    return "R$ " + numero(valor);
  }

  function dataValidade(base) {
    var criacao = base instanceof Date ? base : new Date();
    /* Meio-dia evita que mudança de fuso mova a data. Date resolve meses, bissextos e virada de ano. */
    var validade = new Date(criacao.getFullYear(), criacao.getMonth(), criacao.getDate(), 12);
    validade.setDate(validade.getDate() + 15);
    var dia = String(validade.getDate()).padStart(2, "0");
    var mes = String(validade.getMonth() + 1).padStart(2, "0");
    return dia + "/" + mes + "/" + validade.getFullYear();
  }

  function textoValidade(base) {
    return "Os preços constantes deste orçamento têm validade para até o dia " + dataValidade(base) + ". O estoque e o frete serão confirmados no Whatsapp.";
  }

  function atualizarValidadeTela() {
    var aviso = document.querySelector("[data-validade]");
    if (aviso) aviso.textContent = textoValidade();
  }

  function normalizar(valor) {
    return String(valor || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      /* Medidas: "2,5" e "2.5" dão a mesma string; vírgula fora de número é só separador. */
      .replace(/(\d),(?=\d)/g, "$1.")
      .replace(/,/g, " ")
      /* "100 x 2.5" = "100x2.5" e "10 mm" = "10mm". */
      .replace(/(\d)\s*x\s*(?=\d)/g, "$1x")
      .replace(/(\d)\s+(?=[a-z])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapar(valor) {
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
