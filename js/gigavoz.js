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
      '<p class="gv-status-text" data-gv-status></p>' +
      '<textarea class="gv-transcript-area" data-gv-transcricao rows="5" aria-label="Texto falado"></textarea>' +
      '<button class="gv-avancar" type="button" data-gv-avancar hidden disabled>Avançar para o Orçamento</button>';
    botaoMic = gravador.querySelector("[data-gv-mic]");
    ondas = gravador.querySelector("[data-gv-ondas]");
    statusEl = gravador.querySelector("[data-gv-status]");
    area = gravador.querySelector("[data-gv-transcricao]");
    avancar = gravador.querySelector("[data-gv-avancar]");
    statusEl.textContent = TEXTO_INICIAL;
    botaoMic.addEventListener("click", alternarMicrofone);
    area.addEventListener("input", atualizarAvanco);
    document.body.appendChild(gravador);
  }

  function abrirGravador() {
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    pararEscuta();
    if (!gravador) criarGravador();
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
    atualizarAvanco();
  }

  function acrescentarFala(evento) {
    if (!area || !evento || !evento.results) return;
    var trecho = "";
    var inicio = typeof evento.resultIndex === "number" ? evento.resultIndex : 0;
    for (var i = inicio; i < evento.results.length; i++) {
      var resultado = evento.results[i];
      if (!resultado || resultado.isFinal === false) continue;
      var alternativa = resultado[0];
      if (alternativa && alternativa.transcript) trecho += alternativa.transcript;
    }
    trecho = trecho.replace(/\s+/g, " ").trim();
    if (!trecho) return;
    var atual = area.value.replace(/\s+$/, "");
    area.value = atual ? atual + " " + trecho : trecho;
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
    var sessao = new API();
    reconhecimento = sessao;
    sessao.lang = "pt-BR";
    sessao.continuous = true;
    sessao.interimResults = false;
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
