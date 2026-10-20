(function () {
  "use strict";

  var raiz = null;

  function criarTela() {
    var fundo = document.createElement("div");
    fundo.className = "gv-backdrop";
    fundo.innerHTML =
      '<div class="gv-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="gv-titulo">' +
        '<div class="gv-etapa" data-gv-etapa="escolha">' +
          '<p class="gv-marca">GigaEletro</p>' +
          '<h2 class="gv-titulo" id="gv-titulo">Como deseja solicitar seu orçamento?</h2>' +
          '<p class="gv-texto">Escolha uma das opções abaixo para continuar.</p>' +
          '<div class="gv-cards">' +
            '<button class="gv-card" type="button" data-gv-acao="catalogo">' +
              '<span class="gv-card-selo">Tradicional</span>' +
              '<span class="gv-card-titulo">Consultar Catálogo de Produtos</span>' +
              '<span class="gv-card-texto">Use o formulário e o catálogo que já estão na página.</span>' +
            "</button>" +
            '<button class="gv-card" type="button" data-gv-acao="voz">' +
              '<span class="gv-card-selo">GigaVoz</span>' +
              '<span class="gv-card-titulo">Falar os Produtos que Deseja</span>' +
              '<span class="gv-card-texto">Informe os itens por voz no tradutor GigaVoz.</span>' +
            "</button>" +
          "</div>" +
        "</div>" +
        '<div class="gv-etapa" data-gv-etapa="voz" hidden>' +
          '<p class="gv-marca">GigaVoz</p>' +
          '<h2 class="gv-titulo" id="gv-titulo-voz">Tradutor de voz</h2>' +
          '<p class="gv-texto">Fale os produtos que deseja incluir no orçamento. O microfone entra na próxima etapa.</p>' +
          '<button class="gv-btn" type="button" data-gv-acao="voltar">Voltar</button>' +
        "</div>" +
      "</div>";
    fundo.addEventListener("click", aoClicar);
    return fundo;
  }

  function etapa(nome) {
    return raiz.querySelector('[data-gv-etapa="' + nome + '"]');
  }

  function mostrarEscolha() {
    var dialogo = raiz.querySelector(".gv-welcome-modal");
    etapa("voz").hidden = true;
    etapa("escolha").hidden = false;
    dialogo.setAttribute("aria-labelledby", "gv-titulo");
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  function mostrarVoz() {
    var dialogo = raiz.querySelector(".gv-welcome-modal");
    etapa("escolha").hidden = true;
    etapa("voz").hidden = false;
    dialogo.setAttribute("aria-labelledby", "gv-titulo-voz");
    var voltar = raiz.querySelector('[data-gv-acao="voltar"]');
    if (voltar) voltar.focus();
  }

  function fecharBoasVindas() {
    if (!raiz) return;
    raiz.remove();
    raiz = null;
    var campo = document.querySelector('.cliente-form input[name="documento"]');
    if (campo) campo.focus();
  }

  function aoClicar(evento) {
    var acao = evento.target.closest("[data-gv-acao]");
    if (!acao) return;
    if (acao.getAttribute("data-gv-acao") === "catalogo") fecharBoasVindas();
    if (acao.getAttribute("data-gv-acao") === "voz") mostrarVoz();
    if (acao.getAttribute("data-gv-acao") === "voltar") mostrarEscolha();
  }

  function iniciar() {
    if (!document.body || !document.body.classList.contains("home")) return;
    if (document.querySelector(".gv-backdrop")) return;
    raiz = criarTela();
    document.body.appendChild(raiz);
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
