(function () {
  var WHATSAPP = "5527998021221";
  var CHAVE_PEDIDO = "gigaeletro-orcamento";

  var catalogo = [];
  var selecionados = carregarPedido();
  var busca = "";

  var listaEl = document.querySelector("[data-catalogo]");
  var metaEl = document.querySelector("[data-catalogo-meta]");
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
  var status = document.querySelector("[data-cart-status]");
  var sugestaoAtiva = -1;

  if (buscaEl) {
    buscaEl.addEventListener("input", function () {
      busca = buscaEl.value;
      sugestaoAtiva = -1;
      renderSugestoes();
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
      escolherSugestao();
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

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (sugestoesEl && !sugestoesEl.hidden) {
      fecharSugestoes();
      return;
    }
    setRestrita(false);
  });

  if (enviar) enviar.addEventListener("click", enviarWhatsApp);

  renderCatalogo();
  renderResumo();
  carregarPublicado();

  function adicionar(codigo) {
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
    var campo = acharQuantidade(codigo);
    if (campo) {
      campo.focus();
      campo.select();
    }
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

  function renderCatalogo() {
    if (!listaEl) return;
    if (metaEl) {
      var total = catalogo.length;
      metaEl.textContent = "Exibindo " + total + " produto" + (total === 1 ? "" : "s") + " cadastrado" + (total === 1 ? "" : "s");
    }
    if (!catalogo.length) {
      listaEl.innerHTML = '<p class="resumo-vazio">Catálogo vazio.</p>';
      return;
    }
    listaEl.innerHTML = catalogo.map(function (item) {
      var estoque = item.estoque === undefined || item.estoque === null || String(item.estoque).trim() === ""
        ? "—"
        : String(item.estoque);
      var codigo = escapar(item.codigo);
      var nome = escapar(item.produto);
      return (
        '<article class="catalog-row">' +
          '<div class="catalog-info">' +
            '<h3 class="catalog-nome">' + nome + "</h3>" +
            '<p class="catalog-fine">Código (SKU): ' + codigo + " · Estoque: " + escapar(estoque) + "</p>" +
          "</div>" +
          '<div class="catalog-buy">' +
            '<p class="preco"><strong>' + moeda(item.preco) + "</strong></p>" +
            '<button class="add-mini" type="button" data-add="' + codigo + '" aria-label="Adicionar ' + nome + ' ao orçamento">+ Adicionar</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function renderSugestoes() {
    if (!sugestoesEl || !buscaEl) return;
    var termo = normalizar(busca);
    if (!termo) {
      fecharSugestoes();
      return;
    }
    var visiveis = catalogo.filter(function (item) {
      return normalizar(item.produto).indexOf(termo) >= 0 || normalizar(item.codigo).indexOf(termo) >= 0;
    });
    var limite = visiveis.slice(0, 8);
    if (!limite.length) {
      sugestoesEl.hidden = false;
      buscaEl.setAttribute("aria-expanded", "true");
      sugestoesEl.innerHTML = '<li class="suggest-empty">Nenhum produto encontrado.</li>';
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

  function escolherSugestao() {
    fecharSugestoes();
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
    if (resumoVazio) resumoVazio.hidden = selecionados.length > 0;
    if (!resumoEl) {
      atualizarTotais();
      return;
    }
    resumoEl.innerHTML = selecionados.map(function (item) {
      var codigo = escapar(item.codigo);
      return (
        '<li class="cart-item">' +
          '<p class="cart-sku">Código (SKU): ' + codigo + "</p>" +
          '<p class="cart-nome">' + escapar(item.produto) + "</p>" +
          '<label class="qtd-label">Quantidade desejada' +
            '<input type="number" min="1" step="1" inputmode="numeric" value="' + item.qtd + '" data-qtd="' + codigo + '">' +
          "</label>" +
          '<p class="cart-fact"><span>Preço unitário</span><strong>' + moeda(item.preco) + "</strong></p>" +
          '<p class="cart-fact cart-linha"><span>Total do item</span><strong data-linha-total="' + codigo + '">' + moeda(item.preco * item.qtd) + "</strong></p>" +
          '<button class="remover" type="button" data-acao="remover" data-id="' + codigo + '">Remover</button>' +
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
        if (item) el.textContent = moeda(item.preco * item.qtd);
      });
    }
    if (enviar) enviar.disabled = selecionados.length === 0;
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

  function enviarWhatsApp() {
    if (!selecionados.length) {
      if (avisoEnvio) {
        avisoEnvio.hidden = false;
        avisoEnvio.textContent = "Adicione ao menos um produto ao orçamento.";
      }
      return;
    }
    var linhas = selecionados.map(function (item, indice) {
      var estoque = item.estoque === undefined || item.estoque === null || String(item.estoque).trim() === ""
        ? "não informado"
        : String(item.estoque);
      return (
        (indice + 1) + ". " + item.qtd + "x " + item.produto + "\n" +
        "   Código (SKU): " + item.codigo + "\n" +
        "   Preço unitário: " + moeda(item.preco) + "\n" +
        "   Estoque no site: " + estoque
      );
    });
    var subtotal = selecionados.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    var texto = [
      "Olá! Segue o orçamento que montei na Gigaeletro:",
      "",
      linhas.join("\n\n"),
      "",
      "Subtotal: " + moeda(subtotal),
      "",
      "Peço a confirmação do valor final, do estoque e do frete."
    ].join("\n");
    if (avisoEnvio) avisoEnvio.hidden = true;
    window.open("https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
  }

  function setRestrita(aberto) {
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
      renderCatalogo();
    }).catch(function () {
      catalogo = [];
      renderCatalogo();
    });
  }

  function carregarPedido() {
    try {
      var dados = JSON.parse(sessionStorage.getItem(CHAVE_PEDIDO) || "[]");
      if (!Array.isArray(dados)) return [];
      return dados.filter(function (item) {
        return item && item.codigo && item.produto && isFinite(item.preco) && item.qtd > 0;
      });
    } catch (erro) {
      return [];
    }
  }

  function salvarPedido() {
    sessionStorage.setItem(CHAVE_PEDIDO, JSON.stringify(selecionados));
  }

  function moeda(valor) {
    var partes = Math.abs(Number(valor) || 0).toFixed(2).split(".");
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "R$ " + inteiro + "," + partes[1];
  }

  function normalizar(valor) {
    return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  function escapar(valor) {
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
