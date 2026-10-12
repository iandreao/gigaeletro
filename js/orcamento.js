(function () {
  var WHATSAPP = "5527999821221";
  var CHAVE_PEDIDO = "gigaeletro-orcamento";
  var CHAVE_RECENTES = "gigaeletro-orcamentos-recentes";
  var SITE_PDF = "https://gigaeletro.vercel.app";

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
  var formCliente = document.querySelector("[data-cliente]");
  var consultaCnpj = 0;
  var consultaCep = 0;
  var cepPedido = "";
  var envioEmCurso = false;
  var sugestaoAtiva = -1;

  if (buscaEl) {
    buscaEl.addEventListener("input", function () {
      busca = buscaEl.value;
      sugestaoAtiva = -1;
      renderSugestoes();
      renderCatalogo();
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
      if (alvo && (alvo.name === "documento" || alvo.name === "cep" || alvo.name === "email")) {
        if (!valorInvalido(alvo)) limparAvisoCampo(alvo);
      }
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
      if (event.target && event.target.name === "tipo") limparCamposCliente();
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
      if (destino && destino.closest && destino.closest(".tipo-pessoa")) return;
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
    if (event.target.closest && event.target.closest(".tipo-pessoa")) return;
    event.preventDefault();
    mostrarDadoInvalido(ativo);
    ativo.focus();
  }, true);

  document.addEventListener("click", function (event) {
    var ativo = document.activeElement;
    if (!campoMonitorado(ativo) || !valorInvalido(ativo)) return;
    if (event.target.closest && event.target.closest(".tipo-pessoa")) return;
    if (ativo.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    mostrarDadoInvalido(ativo);
    ativo.focus();
  }, true);

  if (enviar) {
    enviar.textContent = "Enviar Orçamento";
    enviar.addEventListener("click", enviarWhatsApp);
  }

  var inicio = document.querySelector('.nav a[href="#inicio"]');
  if (inicio) {
    inicio.addEventListener("click", function () {
      limparDepoisDoEnvio();
    });
  }

  function setHistorico(aberto) {
    var modal = document.querySelector("[data-historico]");
    var fundo = document.querySelector("[data-historico-overlay]");
    if (modal) modal.hidden = !aberto;
    if (fundo) fundo.hidden = !aberto;
    if (aberto) renderRecentes();
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

  var recentesLista = document.querySelector("[data-recentes-lista]");
  if (recentesLista) {
    recentesLista.addEventListener("click", function (event) {
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
    liberarEnvio();
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

  function setCatalogo(aberto) {
    var modal = document.querySelector("[data-catalogo-modal]");
    var fundo = document.querySelector("[data-catalogo-overlay]");
    if (modal) modal.hidden = !aberto;
    if (fundo) fundo.hidden = !aberto;
    document.body.classList.toggle("catalogo-aberto", aberto);
    if (aberto && buscaEl) buscaEl.focus();
    if (!aberto) fecharSugestoes();
  }

  function produtosVisiveis() {
    var termo = normalizar(busca);
    if (!termo) return catalogo;
    return catalogo.filter(function (item) {
      return normalizar(item.produto).indexOf(termo) >= 0 || normalizar(item.codigo).indexOf(termo) >= 0;
    });
  }

  function renderCatalogo() {
    if (!listaEl) return;
    var visiveis = produtosVisiveis();
    if (metaEl) {
      var total = visiveis.length;
      metaEl.textContent = "Exibindo " + total + " produto" + (total === 1 ? "" : "s") + (busca ? " encontrado" + (total === 1 ? "" : "s") : " cadastrado" + (total === 1 ? "" : "s"));
    }
    if (!visiveis.length) {
      listaEl.innerHTML = '<p class="resumo-vazio">' + (catalogo.length ? "Nenhum produto encontrado." : "Catálogo vazio.") + "</p>";
      return;
    }
    listaEl.innerHTML = visiveis.map(function (item) {
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

  function enviarWhatsApp() {
    setCatalogo(false);
    if (!selecionados.length) {
      mostrarAviso("Adicione ao menos um produto ao orçamento.");
      return;
    }
    var cliente = lerCliente();
    var erro = validarCliente(cliente);
    if (erro) {
      mostrarAviso(erro);
      return;
    }
    if (envioEmCurso) return;
    var subtotal = selecionados.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    var arquivo;
    try {
      arquivo = new File([gerarPdf(cliente, subtotal)], "Pedido-de-Orcamento-Gigaeletro.pdf", { type: "application/pdf" });
    } catch (falha) {
      mostrarAviso("Não foi possível gerar o PDF do orçamento.");
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
      gravarRecente(idSalvo, subtotal, selecionados, cliente);
      renderRecentes();
      limparDepoisDoEnvio();
      var texto = [
        "Olá, Gigaeletro! Montei meu orçamento no site.",
        "",
        "Segue orçamento no valor de " + moeda(subtotal) + ", cujos itens estão listados no anexo. Aguardamos o retorno. Desde já agradecemos a atenção de sempre.",
        "",
        cliente.nome + " – Contato: " + cliente.celular,
        "",
        "📄 Link para visualizar ou baixar o PDF do meu orçamento completo: " + link
      ].join("\n");
      var textoUrl = encodeURIComponent(texto);
      var noComputador = !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
      window.location.href = noComputador
        ? "whatsapp://send?phone=" + WHATSAPP + "&text=" + textoUrl
        : "https://wa.me/" + WHATSAPP + "?text=" + textoUrl;
    }).catch(function (falha) {
      mostrarAviso(falha && falha.message === "Dado Inválido" ? "Dado Inválido" : "Não consegui publicar o PDF. Tente enviar de novo.");
    }).then(function () {
      envioEmCurso = false;
      liberarEnvio();
    });
  }

  function mostrarAviso(texto) {
    if (!avisoEnvio) return;
    avisoEnvio.hidden = false;
    avisoEnvio.textContent = texto;
  }

  function lerCliente() {
    var dados = formCliente ? new FormData(formCliente) : new FormData();
    return {
      nome: String(dados.get("nome") || "").trim(),
      documento: String(dados.get("documento") || "").trim(),
      celular: String(dados.get("celular") || "").trim(),
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
    return !!(campo && (campo.name === "documento" || campo.name === "cep" || campo.name === "email"));
  }

  function valorInvalido(campo) {
    var valor = String(campo && campo.value || "").trim();
    if (!valor) return false;
    if (campo.name === "email") return !emailValido(valor);
    if (campo.name === "cep") return apenasDigitos(valor).length !== 8;
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

  function limparDepoisDoEnvio() {
    var fisico = formCliente && formCliente.querySelector('input[name="tipo"][value="pf"]');
    if (fisico) fisico.checked = true;
    limparCamposCliente();
    selecionados = [];
    salvarPedido();
    renderResumo();
    if (enviar) enviar.textContent = "Enviar Orçamento";
  }

  function preencherCliente(cliente) {
    if (!formCliente || !cliente) return;
    var tipo = cliente.tipo === "pj" ? "pj" : "pf";
    var radio = formCliente.querySelector('input[name="tipo"][value="' + tipo + '"]');
    if (radio) radio.checked = true;
    atualizarRotuloDocumento();
    ["documento", "cep", "nome", "endereco", "numero", "bairro", "cidade", "uf", "celular", "email"].forEach(function (nome) {
      var campo = formCliente.elements[nome];
      if (!campo) return;
      campo.value = cliente[nome] || "";
      limparAvisoCampo(campo);
    });
    cepPedido = apenasDigitos(cliente.cep || "");
    consultaCnpj += 1;
    consultaCep += 1;
  }

  function limparCamposCliente() {
    if (!formCliente) return;
    var nomes = ["documento", "cep", "nome", "endereco", "numero", "bairro", "cidade", "uf", "celular", "email"];
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

  function liberarEnvio() {
    if (!enviar || envioEmCurso) return;
    enviar.disabled = selecionados.length === 0 || !formularioPreenchido();
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
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var margem = 14;
    var largura = doc.internal.pageSize.getWidth();
    var larguraUtil = largura - margem * 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(26, 26, 26);
    doc.text("PEDIDO DE ORÇAMENTO", largura / 2, 16, { align: "center" });

    function fatia(partes) {
      var soma = partes.reduce(function (total, parte) { return total + parte.peso; }, 0);
      return partes.map(function (parte) {
        return { rotulo: parte.rotulo, valor: parte.valor, largura: larguraUtil * parte.peso / soma };
      });
    }

    function linhaCliente(y, partes, folga) {
      doc.setFontSize(9);
      doc.setTextColor(26, 26, 26);
      var x = margem;
      var maior = 1;
      var desenhos = partes.map(function (parte) {
        doc.setFont("helvetica", "bold");
        var rotulo = parte.rotulo + " ";
        var rotuloLargura = doc.getTextWidth(rotulo);
        doc.setFont("helvetica", "normal");
        var linhas = doc.splitTextToSize(String(parte.valor || ""), Math.max(12, parte.largura - rotuloLargura - 1.5));
        if (!linhas.length) linhas = [""];
        if (linhas.length > maior) maior = linhas.length;
        var item = { x: x, rotulo: rotulo, rotuloLargura: rotuloLargura, linhas: linhas };
        x += parte.largura;
        return item;
      });
      desenhos.forEach(function (item) {
        doc.setFont("helvetica", "bold");
        doc.text(item.rotulo, item.x, y);
        doc.setFont("helvetica", "normal");
        doc.text(item.linhas, item.x + item.rotuloLargura, y);
      });
      var yLinha = y + (maior - 1) * 4.2 + 2.2;
      doc.setDrawColor(188, 188, 188);
      doc.setLineWidth(0.2);
      doc.line(margem, yLinha, margem + larguraUtil, yLinha);
      return yLinha + (folga == null ? 7 : folga);
    }

    var y = linhaCliente(24, fatia([
      { rotulo: "Nome:", valor: cliente.nome, peso: 68 },
      { rotulo: "CPF/CNPJ:", valor: cliente.documento, peso: 32 }
    ]));
    y = linhaCliente(y, fatia([
      { rotulo: "End:", valor: cliente.endereco, peso: 82 },
      { rotulo: "Nr:", valor: cliente.numero, peso: 18 }
    ]));
    y = linhaCliente(y, fatia([
      { rotulo: "Cidade:", valor: cliente.cidade, peso: 38 },
      { rotulo: "Bairro:", valor: cliente.bairro, peso: 32 },
      { rotulo: "UF:", valor: cliente.uf, peso: 10 },
      { rotulo: "CEP:", valor: cliente.cep, peso: 20 }
    ]));
    y = linhaCliente(y, fatia([
      { rotulo: "Telefone / Celular:", valor: cliente.celular, peso: 1 },
      { rotulo: "e-mail:", valor: cliente.email, peso: 1 }
    ]), 3.5);

    var wItens = 14.1;
    var wCodigo = 17.1;
    var wQte = 12.1;
    var wUnitario = 21;
    var wValor = 22.4;
    var wNome = larguraUtil - (wItens + wCodigo + wQte + wUnitario + wValor);
    doc.autoTable({
      startY: y + 3,
      margin: { left: margem, right: margem },
      tableWidth: larguraUtil,
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 8,
        textColor: [26, 26, 26],
        fillColor: [255, 255, 255],
        lineColor: [210, 210, 210],
        lineWidth: 0.15,
        cellPadding: 1.6,
        overflow: "linebreak",
        valign: "middle"
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [26, 26, 26],
        fontStyle: "bold",
        lineWidth: { bottom: 0.3 }
      },
      bodyStyles: { fillColor: [255, 255, 255] },
      head: [["Itens", "Código", "Nome", "Qte", "Pr.Unitário", "Valor"]],
      body: selecionados.map(function (item, indice) {
        return [
          String(indice + 1),
          String(item.codigo),
          String(item.produto),
          String(item.qtd),
          moeda(item.preco),
          moeda(item.preco * item.qtd)
        ];
      }),
      columnStyles: {
        0: { cellWidth: wItens, halign: "center" },
        1: { cellWidth: wCodigo },
        2: { cellWidth: wNome },
        3: { cellWidth: wQte, halign: "right" },
        4: { cellWidth: wUnitario, halign: "right" },
        5: { cellWidth: wValor, halign: "right" }
      }
    });

    y = doc.lastAutoTable.finalY + 10;
    var caixa = 48;
    var xCaixa = largura - margem - caixa;
    if (y > 268) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(26, 26, 26);
    doc.text(
      "Obs: O PRAZO DE VALIDADE DESTE ORÇAMENTO É DE 15 (QUINZE) DIAS A CONTAR DA DATA DO SEU ENVIO.",
      margem,
      y + 6,
      { maxWidth: xCaixa - margem - 6 }
    );
    doc.setDrawColor(26, 26, 26);
    doc.setLineWidth(0.3);
    doc.rect(xCaixa, y, caixa, 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Valor Total", xCaixa + caixa / 2, y + 6, { align: "center" });
    doc.setFontSize(11);
    doc.text(moeda(subtotal), xCaixa + caixa / 2, y + 12, { align: "center" });
    return doc.output("blob");
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

  function lerRecentes() {
    try {
      var dados = JSON.parse(localStorage.getItem(CHAVE_RECENTES) || "[]");
      if (!Array.isArray(dados)) return [];
      return dados.filter(function (item) {
        return item && item.id && item.data;
      }).sort(function (a, b) {
        return new Date(b.data).getTime() - new Date(a.data).getTime();
      });
    } catch (erro) {
      return [];
    }
  }

  function copiarCliente(cliente) {
    var origem = cliente || {};
    return {
      tipo: origem.tipo === "pj" ? "pj" : "pf",
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

  function gravarRecente(id, total, itens, cliente) {
    if (!id) return;
    var lista = lerRecentes().filter(function (item) { return item.id !== id; });
    lista.unshift({
      data: new Date().toISOString(),
      id: String(id),
      total: Number(total) || 0,
      itens: copiarItens(itens),
      cliente: copiarCliente(cliente)
    });
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista.slice(0, 12)));
  }

  function editarRecente(id) {
    var registro = lerRecentes().find(function (item) { return item.id === id; });
    var itens = registro ? copiarItens(registro.itens) : [];
    if (!itens.length) {
      mostrarAviso("Este orçamento não tem itens salvos para editar. Use Abrir PDF.");
      return;
    }
    selecionados = itens;
    salvarPedido();
    renderResumo();
    if (registro.cliente) preencherCliente(registro.cliente);
    if (enviar) enviar.textContent = "Enviar Orçamento";
    liberarEnvio();
    if (avisoEnvio) avisoEnvio.hidden = true;
    if (resumoEl) resumoEl.scrollTop = 0;
  }

  function formatarEnvio(iso) {
    var data = new Date(iso);
    if (isNaN(data.getTime())) return "";
    function dois(numero) { return String(numero).padStart(2, "0"); }
    return dois(data.getDate()) + "/" + dois(data.getMonth() + 1) + "/" + data.getFullYear() + " " + dois(data.getHours()) + ":" + dois(data.getMinutes());
  }

  function renderRecentes() {
    var lista = document.querySelector("[data-recentes-lista]");
    var vazio = document.querySelector("[data-historico-vazio]");
    if (!lista) return;
    var itens = lerRecentes();
    lista.textContent = "";
    if (vazio) vazio.hidden = itens.length > 0;
    itens.forEach(function (item) {
      var linha = document.createElement("li");
      var quando = document.createElement("span");
      quando.textContent = formatarEnvio(item.data) + " · " + moeda(item.total);
      var acoes = document.createElement("span");
      acoes.className = "historico-acoes";
      var abrir = document.createElement("a");
      abrir.href = SITE_PDF + "/api/ver-pdf?id=" + encodeURIComponent(item.id);
      abrir.target = "_blank";
      abrir.rel = "noopener noreferrer";
      abrir.textContent = "Visualizar";
      var editar = document.createElement("button");
      editar.type = "button";
      editar.setAttribute("data-editar-orcamento", item.id);
      editar.textContent = "Alterar";
      acoes.appendChild(abrir);
      acoes.appendChild(editar);
      linha.appendChild(quando);
      linha.appendChild(acoes);
      lista.appendChild(linha);
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
