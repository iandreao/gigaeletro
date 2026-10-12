(function () {
  var painel = document.querySelector("[data-catalogo-modal]");
  if (painel) {
    var arrastando = false;
    var origemX = 0;
    var origemY = 0;
    var baseX = 0;
    var baseY = 0;

    function podeArrastar(alvo) {
      return !alvo.closest("button, a, input, textarea, select, label, .catalog-list, .suggest");
    }

    function soltar() {
      arrastando = false;
      painel.classList.remove("is-arrastando");
    }

    painel.addEventListener("pointerdown", function (evento) {
      if (evento.button !== 0 || !podeArrastar(evento.target)) return;
      arrastando = true;
      painel.classList.add("is-arrastando");
      var caixa = painel.getBoundingClientRect();
      origemX = evento.clientX;
      origemY = evento.clientY;
      baseX = caixa.left;
      baseY = caixa.top;
      try {
        if (painel.setPointerCapture) painel.setPointerCapture(evento.pointerId);
      } catch (erro) {}
      evento.preventDefault();
    });

    painel.addEventListener("pointermove", function (evento) {
      if (!arrastando) return;
      var largura = painel.offsetWidth;
      var altura = painel.offsetHeight;
      var x = baseX + (evento.clientX - origemX);
      var y = baseY + (evento.clientY - origemY);
      var maxX = Math.max(8, window.innerWidth - largura - 8);
      var maxY = Math.max(8, window.innerHeight - altura - 8);
      x = Math.min(Math.max(8, x), maxX);
      y = Math.min(Math.max(8, y), maxY);
      painel.style.left = x + "px";
      painel.style.top = y + "px";
      painel.style.right = "auto";
      painel.style.bottom = "auto";
    });

    painel.addEventListener("pointerup", soltar);
    painel.addEventListener("pointercancel", soltar);
  }

  var numero = "5527998021221";

  document.querySelectorAll("[data-wa]").forEach(function (el) {
    var texto = el.getAttribute("data-wa") || "";
    el.href = "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto);
  });

  document.querySelectorAll("[data-ano]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var toggle = document.querySelector(".nav-toggle");
  var menu = document.querySelector("#menu");
  var header = document.querySelector(".site-header");
  if (!toggle || !menu || !header) return;

  var label = toggle.querySelector(".sr-only");

  function setOpen(open) {
    menu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (label) label.textContent = open ? "Fechar menu" : "Abrir menu";
  }

  toggle.addEventListener("click", function () {
    setOpen(!menu.classList.contains("is-open"));
  });

  menu.querySelectorAll("a, button").forEach(function (link) {
    link.addEventListener("click", function () {
      setOpen(false);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setOpen(false);
  });

  document.addEventListener("click", function (event) {
    if (!header.contains(event.target)) setOpen(false);
  });
})();
