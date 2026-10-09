(function () {
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
