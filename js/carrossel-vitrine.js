(function () {
  "use strict";

  var INTERVALO_MS = 3500;
  var SLIDES = [
    { src: "img/carrossel/cabos.png", titulo: "Cabos e Fios Elétricos" },
    { src: "img/carrossel/lampadas.png", titulo: "Lâmpadas Diversas" },
    { src: "img/carrossel/lustres.png", titulo: "Lustres e Pendentes" },
    { src: "img/carrossel/luminarias.png", titulo: "Luminárias Diversas" },
    { src: "img/carrossel/ferramentas.png", titulo: "Ferramentas Elétricas e Manuais" },
    { src: "img/carrossel/chuveiros.png", titulo: "Chuveiros e Duchas" },
    { src: "img/carrossel/disjuntores.png", titulo: "Disjuntores e Proteção" },
    { src: "img/carrossel/materiais.png", titulo: "Materiais Elétricos em Geral" }
  ];

  var LOGO = "assets/logo-gigaeletro.jpg?v=3";

  function iconeSeta(dir) {
    if (dir === "prev") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>';
  }

  function montarMarkup() {
    var itens = SLIDES.map(function (slide, indice) {
      return (
        '<li class="carrossel-vitrine__slide" data-cv-slide="' + indice + '" aria-hidden="' + (indice === 0 ? "false" : "true") + '">' +
          '<img src="' + slide.src + '" alt="' + slide.titulo + '" loading="' + (indice === 0 ? "eager" : "lazy") + '" decoding="async">' +
          '<p class="carrossel-vitrine__legenda">' + slide.titulo + "</p>" +
        "</li>"
      );
    }).join("");

    var dots = SLIDES.map(function (slide, indice) {
      return (
        '<button type="button" class="carrossel-vitrine__dot" data-cv-dot="' + indice + '"' +
        ' aria-label="Ir para ' + slide.titulo + '"' +
        (indice === 0 ? ' aria-current="true"' : "") +
        "></button>"
      );
    }).join("");

    return (
      '<div class="carrossel-vitrine" data-carrossel-vitrine role="region" aria-roledescription="carrossel" aria-label="Vitrine de categorias GigaEletro">' +
        '<div class="carrossel-vitrine__marca" aria-hidden="true">' +
          '<img src="' + LOGO + '" alt="">' +
        "</div>" +
        '<div class="carrossel-vitrine__viewport">' +
          '<ul class="carrossel-vitrine__trilha" data-cv-trilha>' + itens + "</ul>" +
        "</div>" +
        '<button type="button" class="carrossel-vitrine__seta carrossel-vitrine__seta--prev" data-cv-prev aria-label="Slide anterior">' +
          iconeSeta("prev") +
        "</button>" +
        '<button type="button" class="carrossel-vitrine__seta carrossel-vitrine__seta--next" data-cv-next aria-label="Próximo slide">' +
          iconeSeta("next") +
        "</button>" +
        '<div class="carrossel-vitrine__dots" data-cv-dots>' + dots + "</div>" +
      "</div>"
    );
  }

  function iniciarCarrossel(raiz) {
    var trilha = raiz.querySelector("[data-cv-trilha]");
    var slides = Array.prototype.slice.call(raiz.querySelectorAll("[data-cv-slide]"));
    var dots = Array.prototype.slice.call(raiz.querySelectorAll("[data-cv-dot]"));
    var btnPrev = raiz.querySelector("[data-cv-prev]");
    var btnNext = raiz.querySelector("[data-cv-next]");
    var indice = 0;
    var timer = null;
    var reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function irPara(novo, reiniciar) {
      if (!slides.length) return;
      indice = ((novo % slides.length) + slides.length) % slides.length;
      trilha.style.transform = "translateX(-" + indice * 100 + "%)";
      slides.forEach(function (slide, i) {
        slide.setAttribute("aria-hidden", i === indice ? "false" : "true");
      });
      dots.forEach(function (dot, i) {
        if (i === indice) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      if (reiniciar) reiniciarAuto();
    }

    function proximo() { irPara(indice + 1, true); }
    function anterior() { irPara(indice - 1, true); }

    function pararAuto() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function iniciarAuto() {
      if (reduzirMovimento || slides.length < 2) return;
      pararAuto();
      timer = window.setInterval(function () {
        irPara(indice + 1, false);
      }, INTERVALO_MS);
    }

    function reiniciarAuto() {
      pararAuto();
      iniciarAuto();
    }

    if (btnPrev) btnPrev.addEventListener("click", anterior);
    if (btnNext) btnNext.addEventListener("click", proximo);
    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var alvo = Number(dot.getAttribute("data-cv-dot"));
        if (!isNaN(alvo)) irPara(alvo, true);
      });
    });

    raiz.addEventListener("mouseenter", pararAuto);
    raiz.addEventListener("mouseleave", iniciarAuto);
    raiz.addEventListener("focusin", pararAuto);
    raiz.addEventListener("focusout", function (evento) {
      if (!raiz.contains(evento.relatedTarget)) iniciarAuto();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pararAuto();
      else iniciarAuto();
    });

    irPara(0, false);
    iniciarAuto();
  }

  function montar() {
    if (!document.body || !document.body.classList.contains("home")) return;
    var destino = document.querySelector(".hero-copy");
    if (!destino || destino.querySelector("[data-carrossel-vitrine]")) return;

    var h1 = destino.querySelector("h1");
    if (h1) {
      h1.classList.add("sr-only");
      if (!h1.id) h1.id = "titulo-principal-seo";
    }

    destino.insertAdjacentHTML("beforeend", montarMarkup());
    var painel = destino.querySelector("[data-carrossel-vitrine]");
    if (painel) iniciarCarrossel(painel);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
})();
