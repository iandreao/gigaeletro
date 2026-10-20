(function () {
  "use strict";

  var TEXTO_INICIAL = "Clique no microfone e fale os materiais que você precisa.";
  var TEXTO_OUVINDO = "Ouvindo... Pode ditar seus produtos. Clique novamente para parar.";
  var TEXTO_ERRO = "Acesso ao microfone negado ou não suportado. Por favor, utilize o formulário tradicional ou revise as permissões do seu navegador.";
  var NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100 };

  var raiz = null;
  var retorno = null;
  var gravador = null;
  var captura = null;
  var botaoMic = null;
  var ondas = null;
  var statusEl = null;
  var area = null;
  var avancar = null;
  var painelLista = null;
  var listaEl = null;
  var campoNovo = null;
  var confirmarLista = null;
  var intencoes = [];
  var prefixoFala = "";
  var corteResultado = 0;
  var resultadosVistos = 0;
  var escrevendo = false;
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
    limparIntencoes();
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
      '<div class="gv-captura" data-gv-passo="captura">' +
        '<div class="gv-bloco-mic">' +
          '<div class="gv-waves" data-gv-ondas hidden aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
          '<button class="gv-mic" type="button" data-gv-mic aria-pressed="false" aria-label="Iniciar escuta">' +
            '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"></path>' +
              '<path d="M19 11a7 7 0 0 1-14 0"></path>' +
              '<path d="M12 18v3"></path>' +
            "</svg>" +
          "</button>" +
        "</div>" +
        '<p class="gv-status-text" data-gv-status></p>' +
        '<textarea class="gv-transcript-area" data-gv-transcricao aria-label="Texto falado"></textarea>' +
        '<button class="gv-avancar" type="button" hidden disabled>Avançar para o Orçamento</button>' +
      "</div>" +
      '<div class="gv-intencoes" data-gv-passo="lista" hidden>' +
        '<p class="gv-intencoes-titulo">Lista de intenções</p>' +
        '<ul class="gv-intencoes-lista" data-gv-lista></ul>' +
        '<div class="gv-intencoes-add">' +
          '<input class="gv-intencoes-input" type="text" data-gv-novo aria-label="Novo material" placeholder="Digite um material">' +
          '<button class="gv-intencoes-mais" type="button" data-gv-adicionar aria-label="Adicionar">+</button>' +
        "</div>" +
        '<button class="gv-intencoes-confirmar" type="button" disabled>Confirmar e Enviar Lista</button>' +
      "</div>";
    captura = gravador.querySelector(".gv-captura");
    ondas = gravador.querySelector("[data-gv-ondas]");
    botaoMic = gravador.querySelector("[data-gv-mic]");
    statusEl = gravador.querySelector("[data-gv-status]");
    area = gravador.querySelector(".gv-transcript-area");
    avancar = gravador.querySelector(".gv-avancar");
    painelLista = gravador.querySelector(".gv-intencoes");
    listaEl = gravador.querySelector("[data-gv-lista]");
    campoNovo = gravador.querySelector("[data-gv-novo]");
    confirmarLista = gravador.querySelector(".gv-intencoes-confirmar");
    statusEl.textContent = TEXTO_INICIAL;
    area.value = "";
    botaoMic.addEventListener("click", alternarMicrofone);
    area.addEventListener("input", aoEditarTranscricao);
    avancar.addEventListener("click", avancarLista);
    listaEl.addEventListener("click", aoClicarLista);
    listaEl.addEventListener("focusout", aoSairEditor);
    listaEl.addEventListener("keydown", aoTeclarEditor);
    campoNovo.addEventListener("keydown", function (evento) {
      if (evento.key === "Enter") {
        evento.preventDefault();
        adicionarManual();
      }
    });
    gravador.querySelector("[data-gv-adicionar]").addEventListener("click", adicionarManual);
    confirmarLista.addEventListener("click", confirmarEnvio);
    document.body.appendChild(gravador);
  }

  function abrirGravador() {
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    pararEscuta();
    if (gravador) gravador.remove();
    criarGravador();
    limparIntencoes();
    limparTranscricao();
    mostrarCaptura();
    erroAtivo = false;
    statusEl.textContent = TEXTO_INICIAL;
    gravador.hidden = false;
    garantirRetorno().hidden = false;
    posicionarRetorno();
    botaoMic.focus();
  }

  function mostrarCaptura() {
    if (captura) captura.hidden = false;
    if (painelLista) painelLista.hidden = true;
    var titulo = gravador && gravador.querySelector(".gv-recorder-titulo");
    if (titulo) titulo.textContent = "Comando de voz";
  }

  function mostrarLista() {
    if (captura) captura.hidden = true;
    if (painelLista) painelLista.hidden = false;
    var titulo = gravador && gravador.querySelector(".gv-recorder-titulo");
    if (titulo) titulo.textContent = "Revise sua lista";
    desenharLista();
    if (listaEl && listaEl.firstElementChild) {
      var editar = listaEl.querySelector(".gv-intencao-editar");
      if (editar) editar.focus();
    }
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
    if (!erroAtivo && statusEl && captura && !captura.hidden) statusEl.textContent = TEXTO_INICIAL;
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
    prefixoFala = "";
    corteResultado = 0;
    resultadosVistos = 0;
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

  function interpretarItem(trecho) {
    var texto = String(trecho || "").replace(/\s+/g, " ").trim();
    if (!texto) return null;
    var digitos = texto.match(/^(\d+)\s*(?:x\s+)?(.+)$/i);
    if (digitos) {
      var qtd = parseInt(digitos[1], 10);
      var resto = digitos[2].replace(/\s+/g, " ").trim();
      if (qtd >= 1 && resto) return { qtd: qtd, texto: resto };
    }
    var partes = texto.split(/\s+/);
    var nomeNumero = semAcento(partes[0]);
    if (NUMEROS[nomeNumero] && partes.length > 1) {
      return { qtd: NUMEROS[nomeNumero], texto: partes.slice(1).join(" ") };
    }
    return { qtd: null, texto: texto };
  }

  function separarIntencoes(texto) {
    var preparado = String(texto || "").replace(/\r\n/g, "\n").replace(/\s+e\s+/gi, "\n");
    var partes = preparado.split(/\s*(?:,|\n)\s*/);
    var itens = [];
    partes.forEach(function (parte) {
      var item = interpretarItem(parte);
      if (item) itens.push(item);
    });
    return itens;
  }

  function rotulo(item) {
    if (!item) return "";
    if (item.qtd) return item.qtd + " x " + item.texto;
    return item.texto;
  }

  function limparIntencoes() {
    intencoes = [];
    if (listaEl) listaEl.innerHTML = "";
    if (campoNovo) campoNovo.value = "";
    if (confirmarLista) confirmarLista.disabled = true;
    if (gravador) {
      delete gravador.dataset.gvTexto;
      delete gravador.dataset.gvItens;
    }
  }

  function desenharLista() {
    if (!listaEl) return;
    listaEl.innerHTML = "";
    intencoes.forEach(function (item, indice) {
      var li = document.createElement("li");
      li.className = "gv-intencao";
      li.setAttribute("data-gv-indice", String(indice));
      var corpo = document.createElement("div");
      corpo.className = "gv-intencao-corpo";
      var texto = document.createElement("span");
      texto.className = "gv-intencao-texto";
      texto.textContent = rotulo(item);
      var editor = document.createElement("input");
      editor.className = "gv-intencao-editor";
      editor.type = "text";
      editor.hidden = true;
      editor.setAttribute("aria-label", "Editar material");
      editor.value = rotulo(item);
      corpo.appendChild(texto);
      corpo.appendChild(editor);
      var acoes = document.createElement("div");
      acoes.className = "gv-intencao-acoes";
      var editar = document.createElement("button");
      editar.className = "gv-intencao-editar";
      editar.type = "button";
      editar.setAttribute("aria-label", "Editar");
      editar.textContent = "✏️";
      var salvar = document.createElement("button");
      salvar.className = "gv-intencao-salvar";
      salvar.type = "button";
      salvar.hidden = true;
      salvar.textContent = "Salvar";
      var excluir = document.createElement("button");
      excluir.className = "gv-intencao-excluir";
      excluir.type = "button";
      excluir.setAttribute("aria-label", "Excluir");
      excluir.textContent = "🗑️";
      acoes.appendChild(editar);
      acoes.appendChild(salvar);
      acoes.appendChild(excluir);
      li.appendChild(corpo);
      li.appendChild(acoes);
      listaEl.appendChild(li);
    });
    if (confirmarLista) confirmarLista.disabled = !intencoes.length;
  }

  function iniciarEdicao(li) {
    if (!li || li.classList.contains("gv-editando")) return;
    var editor = li.querySelector(".gv-intencao-editor");
    var texto = li.querySelector(".gv-intencao-texto");
    var editar = li.querySelector(".gv-intencao-editar");
    var salvar = li.querySelector(".gv-intencao-salvar");
    li.classList.add("gv-editando");
    texto.hidden = true;
    editar.hidden = true;
    editor.hidden = false;
    salvar.hidden = false;
    editor.value = texto.textContent;
    editor.focus();
    editor.select();
  }

  function concluirEdicao(li) {
    if (!li || !li.classList.contains("gv-editando") || li.dataset.gvFechando === "1") return;
    li.dataset.gvFechando = "1";
    var indice = parseInt(li.getAttribute("data-gv-indice"), 10);
    var editor = li.querySelector(".gv-intencao-editor");
    var texto = li.querySelector(".gv-intencao-texto");
    var editar = li.querySelector(".gv-intencao-editar");
    var salvar = li.querySelector(".gv-intencao-salvar");
    var valor = editor.value.replace(/\s+/g, " ").trim();
    if (valor && intencoes[indice]) intencoes[indice] = interpretarItem(valor);
    texto.textContent = rotulo(intencoes[indice]);
    texto.hidden = false;
    editor.hidden = true;
    salvar.hidden = true;
    editar.hidden = false;
    li.classList.remove("gv-editando");
    delete li.dataset.gvFechando;
  }

  function excluirItem(li) {
    var indice = parseInt(li.getAttribute("data-gv-indice"), 10);
    if (!isFinite(indice)) return;
    intencoes.splice(indice, 1);
    desenharLista();
  }

  function aoClicarLista(evento) {
    var li = evento.target.closest(".gv-intencao");
    if (!li) return;
    if (evento.target.closest(".gv-intencao-editar")) iniciarEdicao(li);
    if (evento.target.closest(".gv-intencao-salvar")) concluirEdicao(li);
    if (evento.target.closest(".gv-intencao-excluir")) excluirItem(li);
  }

  function aoSairEditor(evento) {
    var editor = evento.target.closest && evento.target.closest(".gv-intencao-editor");
    if (!editor) return;
    var destino = evento.relatedTarget;
    if (destino && destino.closest && destino.closest(".gv-intencao-salvar")) return;
    concluirEdicao(editor.closest(".gv-intencao"));
  }

  function aoTeclarEditor(evento) {
    if (!evento.target.classList || !evento.target.classList.contains("gv-intencao-editor")) return;
    if (evento.key === "Enter") {
      evento.preventDefault();
      concluirEdicao(evento.target.closest(".gv-intencao"));
    }
  }

  function adicionarManual() {
    if (!campoNovo) return;
    var novos = separarIntencoes(campoNovo.value);
    if (!novos.length) return;
    intencoes = intencoes.concat(novos);
    campoNovo.value = "";
    desenharLista();
    campoNovo.focus();
  }

  function avancarLista() {
    if (!temPalavra()) return;
    pararEscuta();
    intencoes = separarIntencoes(area.value);
    mostrarLista();
  }

  function focarDocumento() {
    var documento = document.querySelector('.cliente-form input[name="documento"]');
    if (documento) {
      documento.focus();
      return;
    }
    var form = document.querySelector(".cliente-form");
    var campo = form && form.querySelector("input[required]");
    if (campo) campo.focus();
  }

  function confirmarEnvio() {
    if (!intencoes.length || !gravador) return;
    var pacote = intencoes.map(function (item) {
      return { qtd: item.qtd, texto: item.texto };
    });
    var bloco = intencoes.map(rotulo).join("\n");
    gravador.dataset.gvTexto = bloco;
    gravador.dataset.gvItens = JSON.stringify(pacote);
    try {
      sessionStorage.setItem("gv-intencoes", JSON.stringify({ itens: pacote, texto: bloco }));
    } catch (erro) { /* o navegador pode bloquear o armazenamento */ }
    pararEscuta();
    gravador.hidden = true;
    focarDocumento();
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
