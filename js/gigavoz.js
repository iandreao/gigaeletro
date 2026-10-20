(function () {
  "use strict";

  var TEXTO_INICIAL = "Clique no microfone e fale os materiais que você precisa.";
  var TEXTO_OUVINDO = "Ouvindo... Pode ditar seus produtos. Clique novamente para parar.";
  var TEXTO_ERRO = "Acesso ao microfone negado ou não suportado. Por favor, utilize o formulário tradicional ou revise as permissões do seu navegador.";

  var raiz = null;
  var retorno = null;
  var gravador = null;
  var botaoMic = null;
  var ondas = null;
  var statusEl = null;
  var area = null;
  var avancar = null;
  var prefixoFala = "";
  var corteResultado = 0;
  var resultadosVistos = 0;
  var escrevendo = false;
  var grupos = null;
  var listaSucesso = null;
  var listaPendente = null;
  var timerGrupos = 0;
  var indiceCatalogo = null;
  var tentativasCatalogo = 0;
  var reconhecimento = null;
  var ouvindo = false;
  var iniciando = false;
  var erroAtivo = false;

  function criarTela() {
    var fundo = document.createElement("div");
    fundo.className = "gv-backdrop";
    fundo.innerHTML =
      '<div class="gv-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="gv-titulo">' +
        '<div class="gv-etapa" data-gv-etapa="escolha">' +
          '<img class="gv-logo" src="assets/logo-gigaeletro.jpg?v=3" width="366" height="184" alt="Gigaeletro Material Elétrico">' +
          '<h2 class="gv-titulo" id="gv-titulo">Olá, seja muito bem-vindo! É um grande prazer atender — escolha a forma que deseja solicitar seu orçamento.</h2>' +
          '<div class="gv-cards">' +
            '<button class="gv-card" type="button" data-gv-acao="catalogo">' +
              '<span class="gv-card-selo">Tradicional</span>' +
              '<span class="gv-card-titulo">Consultar Catálogo de Produtos</span>' +
              '<span class="gv-card-texto">Use o formulário e o catálogo que já estão na página.</span>' +
            "</button>" +
            '<button class="gv-card" type="button" data-gv-acao="voz">' +
              '<span class="gv-card-selo">Comando de voz</span>' +
              '<span class="gv-card-titulo">Falar os Produtos que Deseja</span>' +
              '<span class="gv-card-texto">Informe os itens por voz no tradutor GigaVoz.</span>' +
            "</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    fundo.addEventListener("click", aoClicar);
    return fundo;
  }

  function ancoraRetorno() {
    var estreito = window.matchMedia("(max-width: 767px)").matches;
    return document.querySelector(estreito ? ".nav-toggle" : ".nav");
  }

  function posicionarRetorno() {
    if (!retorno || retorno.hidden) return;
    var ancora = ancoraRetorno();
    if (!ancora) return;
    var rect = ancora.getBoundingClientRect();
    var estreito = window.matchMedia("(max-width: 767px)").matches;
    if (estreito) {
      var logo = document.querySelector(".brand");
      var livre = logo ? rect.left - logo.getBoundingClientRect().right - 16 : 140;
      retorno.style.maxWidth = Math.max(96, Math.round(livre)) + "px";
      retorno.style.whiteSpace = "normal";
    } else {
      retorno.style.maxWidth = "";
      retorno.style.whiteSpace = "";
    }
    var altura = retorno.offsetHeight || 26;
    var topo = rect.top + Math.max(0, (rect.height - altura) / 2);
    retorno.style.top = Math.max(4, Math.round(topo)) + "px";
    retorno.style.right = Math.max(8, Math.round(window.innerWidth - rect.left + 8)) + "px";
    retorno.style.left = "auto";
  }

  function garantirRetorno() {
    if (retorno) return retorno;
    retorno = document.createElement("button");
    retorno.type = "button";
    retorno.className = "gv-back-to-welcome";
    retorno.textContent = "🔄 Mudar modo de atendimento";
    retorno.hidden = true;
    retorno.addEventListener("click", reabrirBoasVindas);
    window.addEventListener("resize", posicionarRetorno);
    document.body.appendChild(retorno);
    return retorno;
  }

  function reabrirBoasVindas() {
    pararEscuta();
    limparTranscricao();
    limparRevisao();
    if (gravador) gravador.hidden = true;
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    raiz = criarTela();
    document.body.appendChild(raiz);
    garantirRetorno().hidden = true;
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  function fecharBoasVindas() {
    if (!raiz) return;
    raiz.remove();
    raiz = null;
    garantirRetorno().hidden = false;
    posicionarRetorno();
    var campo = document.querySelector('.cliente-form input[name="documento"]');
    if (campo) campo.focus();
  }

  function aoClicar(evento) {
    var acao = evento.target.closest("[data-gv-acao]");
    if (!acao) return;
    var nome = acao.getAttribute("data-gv-acao");
    if (nome === "catalogo") fecharBoasVindas();
    if (nome === "voz") abrirGravador();
  }

  function criarGravador() {
    gravador = document.createElement("div");
    gravador.className = "gv-recorder-container";
    gravador.setAttribute("role", "dialog");
    gravador.setAttribute("aria-labelledby", "gv-recorder-titulo");
    gravador.innerHTML =
      '<p class="gv-recorder-titulo" id="gv-recorder-titulo">Comando de voz</p>' +
      '<div class="gv-waves" data-gv-ondas hidden aria-hidden="true">' +
        "<span></span><span></span><span></span><span></span>" +
      "</div>" +
      '<button class="gv-mic" type="button" data-gv-mic aria-pressed="false" aria-label="Iniciar escuta">' +
        '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"></path>' +
          '<path d="M19 11a7 7 0 0 1-14 0"></path>' +
          '<path d="M12 18v3"></path>' +
        "</svg>" +
      "</button>" +
      '<p class="gv-status-text" data-gv-status></p>';
    botaoMic = gravador.querySelector("[data-gv-mic]");
    ondas = gravador.querySelector("[data-gv-ondas]");
    statusEl = gravador.querySelector("[data-gv-status]");
    statusEl.textContent = TEXTO_INICIAL;
    botaoMic.addEventListener("click", alternarMicrofone);
    garantirCaixa();
    document.body.appendChild(gravador);
  }

  function garantirCaixa() {
    if (!statusEl) return;
    if (!area) {
      area = document.createElement("textarea");
      area.className = "gv-transcript-area";
      area.setAttribute("data-gv-transcricao", "");
      area.setAttribute("aria-label", "Texto falado");
      area.rows = 3;
      area.addEventListener("input", aoEditarTranscricao);
      area.addEventListener("keyup", agendarGrupos);
    }
    statusEl.insertAdjacentElement("afterend", area);
    garantirGrupos();
    area.hidden = false;
    atualizarAvanco();
  }

  function garantirGrupos() {
    if (!area) return;
    if (!grupos) {
      grupos = document.createElement("div");
      grupos.className = "gv-groups";
      grupos.innerHTML =
        '<section class="gv-group-success">' +
          '<h3 class="gv-group-titulo">🟩 Materiais Identificados no Estoque</h3>' +
          '<ul class="gv-group-list" data-gv-success></ul>' +
        "</section>" +
        '<section class="gv-group-pending">' +
          '<h3 class="gv-group-titulo">🟨 Itens para Revisão (Não Localizados)</h3>' +
          '<ul class="gv-group-list" data-gv-pending></ul>' +
        "</section>";
      listaSucesso = grupos.querySelector("[data-gv-success]");
      listaPendente = grupos.querySelector("[data-gv-pending]");
    }
    if (!confirmar) {
      confirmar = document.createElement("button");
      confirmar.className = "gv-confirmar";
      confirmar.type = "button";
      confirmar.textContent = "Confirmar e Inserir no Orçamento";
      confirmar.disabled = true;
      confirmar.addEventListener("click", confirmarOrcamento);
    }
    area.insertAdjacentElement("afterend", grupos);
    grupos.insertAdjacentElement("afterend", confirmar);
  }

  function abrirGravador() {
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    pararEscuta();
    if (!gravador) criarGravador();
    garantirCaixa();
    limparRevisao();
    limparTranscricao();
    erroAtivo = false;
    statusEl.textContent = TEXTO_INICIAL;
    gravador.hidden = false;
    garantirRetorno().hidden = false;
    posicionarRetorno();
    botaoMic.focus();
  }

  function apiReconhecimento() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function definirOuvindo(ativo) {
    ouvindo = ativo;
    if (ondas) {
      ondas.hidden = !ativo;
      ondas.setAttribute("aria-hidden", ativo ? "false" : "true");
    }
    if (botaoMic) {
      botaoMic.setAttribute("aria-pressed", ativo ? "true" : "false");
      botaoMic.setAttribute("aria-label", ativo ? "Parar escuta" : "Iniciar escuta");
    }
  }

  function voltarEstadoInicial() {
    iniciando = false;
    definirOuvindo(false);
    if (!erroAtivo && statusEl) statusEl.textContent = TEXTO_INICIAL;
  }

  function soltarMicrofone() {
    var atual = reconhecimento;
    reconhecimento = null;
    if (!atual) return;
    atual.onstart = null;
    atual.onend = null;
    atual.onerror = null;
    atual.onresult = null;
    try { atual.abort(); } catch (erro) { /* a sessão já pode ter terminado */ }
  }

  function mostrarErro() {
    erroAtivo = true;
    iniciando = false;
    soltarMicrofone();
    definirOuvindo(false);
    if (statusEl) statusEl.textContent = TEXTO_ERRO;
  }

  function pararEscuta() {
    erroAtivo = false;
    soltarMicrofone();
    voltarEstadoInicial();
  }

  function aoEditarTranscricao() {
    if (escrevendo) return;
    prefixoFala = area ? area.value : "";
    corteResultado = resultadosVistos;
    agendarGrupos();
    atualizarAvanco();
  }

  function temPalavra() {
    return !!(area && area.value.trim());
  }

  function atualizarAvanco() {
    if (!avancar) return;
    var ativo = temPalavra();
    avancar.hidden = !ativo;
    avancar.disabled = !ativo;
  }

  function limparTranscricao() {
    if (area) area.value = "";
    if (timerGrupos) clearTimeout(timerGrupos);
    atualizarGrupos();
    atualizarAvanco();
  }

  function acrescentarFala(evento) {
    if (!area || !evento || !evento.results) return;
    resultadosVistos = evento.results.length;
    var falado = "";
    var i;
    for (i = corteResultado; i < evento.results.length; i++) {
      var trecho = evento.results[i][0] && evento.results[i][0].transcript;
      if (trecho) falado += trecho;
    }
    falado = falado.replace(/\s+/g, " ").trim();
    var base = prefixoFala.replace(/\s+$/, "");
    escrevendo = true;
    area.value = base && falado ? base + " " + falado : (falado || base);
    escrevendo = false;
    area.scrollTop = area.scrollHeight;
    agendarGrupos();
    atualizarAvanco();
  }

  function iniciarEscuta() {
    var API = apiReconhecimento();
    if (!API) {
      mostrarErro();
      return;
    }
    soltarMicrofone();
    erroAtivo = false;
    iniciando = true;
    prefixoFala = area ? area.value.replace(/\s+$/, "") : "";
    corteResultado = 0;
    resultadosVistos = 0;
    var sessao = new API();
    reconhecimento = sessao;
    sessao.lang = "pt-BR";
    sessao.continuous = true;
    sessao.interimResults = true;
    sessao.onresult = function (evento) {
      if (reconhecimento !== sessao) return;
      acrescentarFala(evento);
    };
    sessao.onstart = function () {
      if (reconhecimento !== sessao) return;
      iniciando = false;
      erroAtivo = false;
      definirOuvindo(true);
      if (statusEl) statusEl.textContent = TEXTO_OUVINDO;
    };
    sessao.onerror = function (evento) {
      if (reconhecimento !== sessao) return;
      var codigo = evento && evento.error;
      if (codigo === "not-allowed" || codigo === "service-not-allowed" || codigo === "audio-capture") mostrarErro();
    };
    sessao.onend = function () {
      if (reconhecimento !== sessao) return;
      if (ouvindo && !erroAtivo) {
        prefixoFala = area ? area.value.replace(/\s+$/, "") : "";
        corteResultado = 0;
        resultadosVistos = 0;
        try {
          sessao.start();
          return;
        } catch (erro) { /* segue para encerrar */ }
      }
      reconhecimento = null;
      voltarEstadoInicial();
    };
    try {
      sessao.start();
    } catch (erro) {
      reconhecimento = null;
      mostrarErro();
    }
  }

  function alternarMicrofone() {
    if (ouvindo || iniciando) pararEscuta();
    else iniciarEscuta();
  }

  function semAcento(texto) {
    return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function tokensDe(texto) {
    var limpo = semAcento(texto).replace(/[^a-z0-9]+/g, " ").trim();
    return limpo ? limpo.split(/\s+/) : [];
  }

  function radical(palavra) {
    if (palavra.length > 4 && palavra.slice(-2) === "es") return palavra.slice(0, -2);
    if (palavra.length > 3 && palavra.slice(-1) === "s") return palavra.slice(0, -1);
    return palavra;
  }

  function combinaPalavra(falada, nome) {
    var a = radical(falada);
    var b = radical(nome);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.indexOf(a) === 0) return true;
    if (b.length >= 4 && a.indexOf(b) === 0) return true;
    return false;
  }

  function lerQuantidade(lista) {
    var nomes = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100 };
    if (!lista.length) return { qtd: 1, resto: lista };
    if (/^\d+$/.test(lista[0])) return { qtd: parseInt(lista[0], 10), resto: lista.slice(1) };
    if (nomes[lista[0]]) return { qtd: nomes[lista[0]], resto: lista.slice(1) };
    if (/^\d+$/.test(lista[lista.length - 1])) return { qtd: parseInt(lista[lista.length - 1], 10), resto: lista.slice(0, -1) };
    if (nomes[lista[lista.length - 1]]) return { qtd: nomes[lista[lista.length - 1]], resto: lista.slice(0, -1) };
    return { qtd: 1, resto: lista };
  }

  function catalogoVisivel() {
    return Array.prototype.map.call(document.querySelectorAll(".add-mini[data-add]"), function (botao) {
      var rotulo = botao.getAttribute("aria-label") || "";
      var achado = rotulo.match(/^Adicionar (.+) ao orçamento$/);
      var nome = achado ? achado[1] : "";
      if (!nome) {
        var linha = botao.closest(".catalog-row");
        var titulo = linha && linha.querySelector(".catalog-nome");
        nome = titulo ? titulo.textContent : "";
      }
      return { codigo: botao.getAttribute("data-add"), nome: nome, botao: botao };
    }).filter(function (item) { return item.codigo && item.nome; });
  }

  function indiceProdutos() {
    var total = document.querySelectorAll(".add-mini[data-add]").length;
    if (indiceCatalogo && indiceCatalogo.total === total) return indiceCatalogo.itens;
    var itens = catalogoVisivel();
    var i;
    for (i = 0; i < itens.length; i += 1) itens[i].tokens = tokensDe(itens[i].nome);
    indiceCatalogo = { total: total, itens: itens };
    return itens;
  }

  function melhorProduto(falados) {
    var produtos = indiceProdutos();
    var melhor = null;
    var melhorNota = 0;
    var melhorTamanho = 0;
    var i;
    for (i = 0; i < produtos.length; i += 1) {
      var produto = produtos[i];
      var nomes = produto.tokens;
      var acertos = 0;
      var p;
      for (p = 0; p < falados.length; p += 1) {
        var palavra = falados[p];
        var n;
        for (n = 0; n < nomes.length; n += 1) {
          if (combinaPalavra(palavra, nomes[n])) {
            acertos += 1;
            break;
          }
        }
      }
      if (!acertos) continue;
      var nota = acertos / falados.length;
      var tamanho = nomes.length;
      var ganha = nota > melhorNota || (nota === melhorNota && melhor && tamanho < melhorTamanho);
      if (ganha) {
        melhor = produto;
        melhorNota = nota;
        melhorTamanho = tamanho;
      }
    }
    if (!melhor || melhorNota < 1) return null;
    return melhor;
  }

  function interpretarPedido(texto) {
    var partes = semAcento(texto).split(/\s*(?:,|;|\.| e | mais )\s*/);
    var mapa = {};
    var ordem = [];
    var paradas = { de: 1, da: 1, do: 1, das: 1, dos: 1, para: 1, pra: 1, com: 1, no: 1, na: 1, em: 1, por: 1, ao: 1, aos: 1 };
    partes.forEach(function (parte) {
      var lista = tokensDe(parte).filter(function (token) { return !paradas[token]; });
      var lido = lerQuantidade(lista);
      if (!lido.resto.length || !isFinite(lido.qtd) || lido.qtd < 1) return;
      var produto = melhorProduto(lido.resto);
      if (!produto) return;
      if (!mapa[produto.codigo]) {
        mapa[produto.codigo] = { codigo: produto.codigo, qtd: 0, nome: produto.nome, botao: produto.botao };
        ordem.push(produto.codigo);
      }
      mapa[produto.codigo].qtd += Math.min(500, lido.qtd);
    });
    return ordem.map(function (codigo) { return mapa[codigo]; });
  }

  function lerQtd(codigo) {
    var alvo = document.querySelector('.quote-side [data-qtd="' + String(codigo).replace(/"/g, "") + '"]');
    var valor = alvo ? parseInt(alvo.textContent, 10) : 0;
    return isFinite(valor) ? valor : 0;
  }

  function injetarProduto(pedido) {
    if (!pedido || !pedido.botao) return;
    var destino = Math.max(1, Math.min(500, pedido.qtd));
    if (!lerQtd(pedido.codigo)) pedido.botao.click();
    var atual = lerQtd(pedido.codigo);
    var passos = 0;
    while (atual < destino && passos < 500) {
      var mais = document.querySelector('.quote-side [data-acao="mais"][data-id="' + String(pedido.codigo).replace(/"/g, "") + '"]');
      if (!mais) break;
      mais.click();
      atual += 1;
      passos += 1;
    }
    while (atual > destino && passos < 1000) {
      var menos = document.querySelector('.quote-side [data-acao="menos"][data-id="' + String(pedido.codigo).replace(/"/g, "") + '"]');
      if (!menos) break;
      menos.click();
      atual -= 1;
      passos += 1;
    }
  }

  function focarPrimeiroCampo() {
    var form = document.querySelector(".cliente-form");
    if (!form) return;
    var campos = form.querySelectorAll("input[required]");
    var i;
    for (i = 0; i < campos.length; i += 1) {
      var campo = campos[i];
      var aviso = campo.parentElement && campo.parentElement.querySelector("[data-doc-aviso], [data-campo-aviso]");
      if (!String(campo.value || "").trim() || (aviso && !aviso.hidden)) {
        campo.focus();
        return;
      }
    }
    if (campos[0]) campos[0].focus();
  }

  var pedidosRevisao = [];
  var previa = null;
  var listaPrevia = null;
  var confirmar = null;

  function escaparTexto(valor) {
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function garantirPrevia() {
    if (!gravador) return;
    if (!previa) {
      previa = document.createElement("div");
      previa.className = "gv-preview";
      previa.hidden = true;
      previa.innerHTML =
        '<p class="gv-preview-titulo">Produtos identificados</p>' +
        '<ul class="gv-preview-list"></ul>' +
        '<button class="gv-confirmar" type="button">Confirmar e Inserir no Orçamento</button>';
      listaPrevia = previa.querySelector(".gv-preview-list");
      confirmar = previa.querySelector(".gv-confirmar");
      confirmar.addEventListener("click", confirmarOrcamento);
      gravador.appendChild(previa);
    }
  }

  function limparRevisao() {
    pedidosRevisao = [];
    if (gravador) gravador.classList.remove("gv-em-revisao");
    if (listaPrevia) listaPrevia.innerHTML = "";
    if (previa) previa.hidden = true;
  }

  function mostrarRevisao(pedidos) {
    garantirPrevia();
    pedidosRevisao = pedidos;
    listaPrevia.innerHTML = pedidos.map(function (pedido) {
      return '<li class="gv-preview-item"><span class="gv-preview-qtd">' + pedido.qtd + "</span> x <span class=\"gv-preview-nome\">" + escaparTexto(pedido.nome) + "</span></li>";
    }).join("");
    gravador.classList.add("gv-em-revisao");
    previa.hidden = false;
    if (confirmar) confirmar.focus();
  }

  function classificarTexto(texto) {
    var preparado = String(texto || "").replace(/\s+(?=\d+\s)/g, ", ");
    var partes = preparado.split(/\s*(?:,|;|\.|\se\s|\smais\s)\s*/i);
    var mapa = {};
    var ordem = [];
    var pendentes = [];
    var paradas = { de: 1, da: 1, do: 1, das: 1, dos: 1, para: 1, pra: 1, com: 1, no: 1, na: 1, em: 1, por: 1, ao: 1, aos: 1 };
    partes.forEach(function (parte) {
      var trecho = parte.replace(/\s+/g, " ").trim();
      if (!trecho) return;
      var lista = tokensDe(trecho).filter(function (token) { return !paradas[token]; });
      var lido = lerQuantidade(lista);
      if (!lido.resto.length || !isFinite(lido.qtd) || lido.qtd < 1) return;
      var produto = melhorProduto(lido.resto);
      if (!produto) {
        pendentes.push(trecho);
        return;
      }
      if (!mapa[produto.codigo]) {
        mapa[produto.codigo] = { codigo: produto.codigo, nome: produto.nome, botao: produto.botao, qtd: 0 };
        ordem.push(produto.codigo);
      }
      mapa[produto.codigo].qtd += Math.min(500, lido.qtd);
    });
    return {
      ok: ordem.map(function (codigo) { return mapa[codigo]; }),
      pendentes: pendentes
    };
  }

  function desenharGrupo(itens, identificado) {
    if (!itens.length) return '<li class="gv-group-vazio">Nenhum item neste grupo.</li>';
    if (!identificado) {
      return itens.map(function (trecho) {
        return '<li class="gv-group-item">' + escaparTexto(trecho) + "</li>";
      }).join("");
    }
    return itens.map(function (item) {
      return '<li class="gv-group-item"><span class="gv-group-qtd">' + item.qtd + '</span> x <span class="gv-group-nome">' + escaparTexto(item.nome) + "</span></li>";
    }).join("");
  }

  function agendarGrupos() {
    tentativasCatalogo = 0;
    if (timerGrupos) clearTimeout(timerGrupos);
    timerGrupos = setTimeout(atualizarGrupos, 50);
  }

  function atualizarGrupos() {
    timerGrupos = 0;
    if (!listaSucesso || !listaPendente) return;
    var texto = area ? area.value : "";
    var resultado = classificarTexto(texto);
    pedidosRevisao = resultado.ok;
    listaSucesso.innerHTML = desenharGrupo(resultado.ok, true);
    listaPendente.innerHTML = desenharGrupo(resultado.pendentes, false);
    if (confirmar) confirmar.disabled = !resultado.ok.length;
    if (texto.trim() && !indiceProdutos().length && tentativasCatalogo < 8) {
      tentativasCatalogo += 1;
      timerGrupos = setTimeout(atualizarGrupos, 400);
    }
  }

  function confirmarOrcamento() {
    if (!pedidosRevisao.length) return;
    var pedidos = pedidosRevisao.slice();
    pedidos.forEach(injetarProduto);
    limparRevisao();
    limparTranscricao();
    pararEscuta();
    if (gravador) gravador.hidden = true;
    var documento = document.querySelector('.cliente-form input[name="documento"]');
    if (documento) documento.focus();
    else focarPrimeiroCampo();
  }

  function avancarOrcamento() {
    if (!temPalavra()) return;
    var texto = area.value;
    pararEscuta();
    var pedidos = interpretarPedido(texto);
    if (!pedidos.length) {
      if (statusEl) statusEl.textContent = "Não encontrei esses produtos no catálogo. Ajuste o texto e tente de novo.";
      return;
    }
    mostrarRevisao(pedidos);
  }

  function iniciar() {
    if (!document.body || !document.body.classList.contains("home")) return;
    if (document.querySelector(".gv-backdrop")) return;
    garantirRetorno();
    raiz = criarTela();
    document.body.appendChild(raiz);
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
