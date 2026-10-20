(function () {
  "use strict";

  var raiz = null;
  var retorno = null;

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
    if (nome === "catalogo" || nome === "voz") fecharBoasVindas();
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
