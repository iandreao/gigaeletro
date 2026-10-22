(function () {
  "use strict";

  var TEXTO_INICIAL = "Clique no microfone e fale os materiais que você precisa.";
  var TEXTO_OUVINDO = "Ouvindo... Pode ditar seus produtos. Clique novamente para parar.";
  var TEXTO_ERRO = "Acesso ao microfone negado ou não suportado. Por favor, utilize o formulário tradicional ou revise as permissões do seu navegador.";
  var NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100 };

  var raiz = null;
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
  var modoIntencoes = false;
  var catalogoTravado = false;

  function criarTela() {
    var fundo = document.createElement("div");
    fundo.className = "gv-backdrop";
    fundo.innerHTML =
      '<div class="gv-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="gv-titulo">' +
        '<div class="gv-etapa" data-gv-etapa="escolha">' +
          '<h2 class="gv-titulo" id="gv-titulo">Olá, seja muito bem-vindo! É um grande prazer atendê-lo — escolha o Tipo de Orçamento que preferir.</h2>' +
          '<div class="gv-cards">' +
            '<button class="gv-card" type="button" data-gv-acao="catalogo">' +
              '<span class="gv-card-selo">Tradicional</span>' +
              '<span class="gv-card-titulo">Consulta Catálogo de Produtos</span>' +
            "</button>" +
            '<button class="gv-card" type="button" data-gv-acao="voz">' +
              '<span class="gv-card-selo">Comando de voz</span>' +
              '<span class="gv-card-titulo">Fale os Produtos que Deseja</span>' +
            "</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    fundo.addEventListener("click", aoClicar);
    return fundo;
  }

  function botoesCatalogo() {
    var hero = document.getElementById("btnVerCatalogo") || document.querySelector(".hero-acao [data-abrir-catalogo]");
    var menu = document.getElementById("btnProdutos");
    return [hero, menu].filter(Boolean);
  }

  function definirCatalogo(ativo) {
    /* Produtos fica travado somente enquanto o Comando de Voz é o modelo ativo. */
    if (catalogoTravado) ativo = false;
    botoesCatalogo().forEach(function (botao) {
      botao.disabled = !ativo;
      if (ativo) botao.removeAttribute("disabled");
      else botao.setAttribute("disabled", "disabled");
      botao.setAttribute("aria-disabled", ativo ? "false" : "true");
    });
  }

  function travarCatalogo() {
    catalogoTravado = true;
    document.body.dataset.gvCatalogoTravado = "1";
    definirCatalogo(false);
  }

  function liberarCatalogo() {
    catalogoTravado = false;
    if (document.body.dataset.gvCatalogoTravado) delete document.body.dataset.gvCatalogoTravado;
    definirCatalogo(true);
  }

  function reabrirBoasVindas() {
    pararEscuta();
    /* A escolha ainda não é voz: o catálogo tradicional volta. */
    liberarCatalogo();
    limparTranscricao();
    limparIntencoes();
    if (gravador) gravador.hidden = true;
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    modoIntencoes = false;
    raiz = criarTela();
    document.body.appendChild(raiz);
    alinharEscolha();
    refletirTipoOrcamento();
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  function modoGigaVozAberto() {
    if (modoIntencoes) return true;
    if (raiz && document.body.contains(raiz)) return true;
    return !!(gravador && !gravador.hidden);
  }

  function refletirTipoOrcamento() {
    var botao = document.getElementById("btnTipoOrcamento");
    if (!botao) return;
    botao.setAttribute("aria-pressed", modoGigaVozAberto() ? "true" : "false");
  }

  function desligarModoGigaVoz() {
    pararEscuta();
    /* Tradicional ativo: o orçamento permanece e Produtos volta na hora. */
    modoIntencoes = false;
    liberarCatalogo();
    limparTranscricao();
    limparIntencoes();
    if (gravador) gravador.hidden = true;
    if (raiz) {
      raiz.remove();
      raiz = null;
    }
    refletirTipoOrcamento();
  }

  function alternarTipoOrcamento(evento) {
    if (evento) evento.preventDefault();
    /* A troca de modelo não apaga selecionados. A limpeza ocorre só ao inserir o modelo oposto. */
    if (modoGigaVozAberto()) desligarModoGigaVoz();
    else reabrirBoasVindas();
  }

  function fecharBoasVindas() {
    if (!raiz) return;
    modoIntencoes = false;
    liberarCatalogo();
    raiz.remove();
    raiz = null;
    refletirTipoOrcamento();
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
        '<p class="gv-intencoes-titulo">Lista de Produtos Solicitados</p>' +
        '<ul class="gv-intencoes-lista" data-gv-lista></ul>' +
        '<div class="gv-intencoes-add">' +
          '<input class="gv-intencoes-input" type="text" data-gv-novo aria-label="Novo material" placeholder="Digite um material">' +
          '<button class="gv-intencoes-mais" type="button" data-gv-adicionar aria-label="Adicionar">+</button>' +
        "</div>" +
        '<div class="gv-intencoes-espaco"></div>' +
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
    modoIntencoes = true;
    travarCatalogo();
    refletirTipoOrcamento();
    botaoMic.focus();
  }

  function mostrarCaptura() {
    if (captura) captura.hidden = false;
    if (painelLista) painelLista.hidden = true;
    var titulo = gravador && gravador.querySelector(".gv-recorder-titulo");
    if (titulo) {
      titulo.hidden = false;
      titulo.textContent = "Comando de voz";
    }
    alinharComEnvio();
  }

  function medirColunaCentral() {
    var formulario = document.querySelector(".hero-centro .cliente-form") || document.querySelector(".cliente-form");
    if (!formulario) return null;
    var formRect = formulario.getBoundingClientRect();
    if (formRect.width < 1) return null;
    var tipo = formulario.querySelector(".form-tipo") || formulario.querySelector(".tipo-pessoa");
    var catalogo = document.getElementById("btnVerCatalogo");
    var tipoRect = tipo ? tipo.getBoundingClientRect() : null;
    var catRect = catalogo ? catalogo.getBoundingClientRect() : null;
    /* Começa sob Tipo de Pessoa, com o respiro de 12px, e desce até a borda do catálogo. */
    var topo = tipoRect ? tipoRect.bottom + 12 : formRect.top;
    var base = catRect && catRect.top > topo + 120 ? catRect.top : formRect.bottom;
    return {
      left: formRect.left,
      width: formRect.width,
      top: topo,
      height: Math.max(160, base - topo)
    };
  }

  function publicarColuna(medida) {
    if (!medida) return;
    var raizCss = document.documentElement;
    /* Largura e coluna do formulário, compartilhadas pela escolha e pelo microfone. */
    raizCss.style.setProperty("--gv-escolha-largura", medida.width + "px");
    raizCss.style.setProperty("--gv-escolha-esq", medida.left + "px");
    raizCss.style.setProperty("--gv-escolha-topo", medida.top + "px");
    raizCss.style.setProperty("--gv-escolha-altura", medida.height + "px");
  }

  function alinharEscolha() {
    var modal = document.querySelector(".gv-welcome-modal");
    var medida = medirColunaCentral();
    if (!medida) return;
    publicarColuna(medida);
    if (!modal) return;
  }

  function centralizarModalHome(modal) {
    if (!modal || modal.hidden || modal.dataset.arrastado === "1" || modal.classList.contains("is-arrastando")) return;
    var foto = document.querySelector(".hero-foto");
    var fotoDir = foto ? foto.getBoundingClientRect().right : 0;
    var largura = Math.min(360, Math.max(240, window.innerWidth - 24));
    var esquerda = Math.round((window.innerWidth - largura) / 2);
    var limite = Math.round(fotoDir + 16);
    if (esquerda < limite) esquerda = limite;
    var maximo = window.innerWidth - 12 - largura;
    if (esquerda > maximo) esquerda = Math.max(12, maximo);
    modal.style.left = esquerda + "px";
    modal.style.right = "auto";
    modal.style.top = "50%";
    modal.style.transform = "translateY(-50%)";
    modal.style.width = largura + "px";
    modal.style.maxWidth = largura + "px";
  }

  function centralizarModaisAbertos() {
    centralizarModalHome(document.querySelector("[data-catalogo-modal]"));
    centralizarModalHome(document.querySelector("[data-historico]"));
  }

  function observarModaisHome() {
    ["[data-catalogo-modal]", "[data-historico]"].forEach(function (seletor) {
      var modal = document.querySelector(seletor);
      if (!modal || modal.dataset.gvCentro) return;
      modal.dataset.gvCentro = "1";
      new MutationObserver(function () {
        window.requestAnimationFrame(function () { centralizarModalHome(modal); });
      }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    });
  }
  function posicionarGravador() {
    if (!gravador || gravador.hidden) return;
    var medida = medirColunaCentral();
    if (!medida) return;
    publicarColuna(medida);
    gravador.style.left = medida.left + "px";
    gravador.style.width = medida.width + "px";
    gravador.style.maxWidth = medida.width + "px";
    gravador.style.right = "auto";
    gravador.style.transform = "none";
  }

  function alinharComEnvio() {
    if (!gravador) return;
    posicionarGravador();
    var medida = medirColunaCentral();
    if (!medida) return;
    /* Mesma faixa da escolha: sob Tipo de Pessoa e rente a Ver Catálogo. */
    gravador.style.marginTop = "0";
    gravador.style.top = medida.top + "px";
    gravador.style.height = medida.height + "px";
    gravador.style.maxHeight = medida.height + "px";
  }

  function mostrarLista() {
    if (captura) captura.hidden = true;
    if (painelLista) painelLista.hidden = false;
    var titulo = gravador && gravador.querySelector(".gv-recorder-titulo");
    if (titulo) titulo.hidden = true;
    desenharLista();
    alinharComEnvio();
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

  var ESPECS = { mm: 1, cm: 1, km: 1, pol: 1, polegada: 1, polegadas: 1, amp: 1, amper: 1, ampere: 1, amperes: 1, v: 1, volt: 1, volts: 1, w: 1, watt: 1, watts: 1, awg: 1, kva: 1, va: 1, kv: 1 };
  var MEDIDAS = { m: 1, mt: 1, mts: 1, metro: 1, metros: 1 };

  function lerNumero(valor) {
    var qtd = parseFloat(String(valor || "").replace(",", "."));
    return isFinite(qtd) && qtd > 0 ? qtd : null;
  }

  function unidadeDepois(texto, fim) {
    var resto = String(texto || "").slice(fim);
    var solto = resto.match(/^\s*([A-Za-zÀ-ÿ]+)/);
    return solto ? semAcento(solto[1]) : "";
  }

  function quebrarPorQuantidade(texto) {
    var fonte = String(texto || "").replace(/\s+/g, " ").trim();
    if (!fonte) return [];
    var re = /\b(\d+(?:[.,]\d+)?|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|vinte|trinta|quarenta|cinquenta|cem)\b/gi;
    var pedacos = [];
    var achado;
    var inicio = 0;
    while ((achado = re.exec(fonte))) {
      if (achado.index <= inicio) continue;
      var antes = fonte.slice(inicio, achado.index).trim();
      if (!antes) {
        inicio = achado.index;
        continue;
      }
      var unidade = unidadeDepois(fonte, achado.index + achado[0].length);
      var depois = fonte.slice(achado.index + achado[0].length).trim();
      if (ESPECS[unidade] || !depois) continue;
      pedacos.push(antes);
      inicio = achado.index;
    }
    var resto = fonte.slice(inicio).trim();
    if (resto) pedacos.push(resto);
    return pedacos;
  }

  function interpretarItem(trecho) {
    var texto = String(trecho || "").replace(/\s+/g, " ").trim();
    if (!texto) return null;
    var medida = texto.match(/^(\d+(?:[.,]\d+)?)\s+(m|mt|mts|metro|metros)\b\s+(.+)$/i);
    if (medida && MEDIDAS[semAcento(medida[2])] && medida[3].trim()) {
      return { qtd: lerNumero(medida[1]), texto: texto, medida: true, fala: texto };
    }
    var digitos = texto.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s+)?(.+)$/i);
    if (digitos) {
      var qtd = lerNumero(digitos[1]);
      var descricao = digitos[2].replace(/\s+/g, " ").trim();
      if (qtd && descricao) return { qtd: qtd, texto: descricao, fala: texto };
    }
    var partes = texto.split(/\s+/);
    var nomeNumero = semAcento(partes[0]);
    if (NUMEROS[nomeNumero] && partes.length > 1) {
      return { qtd: NUMEROS[nomeNumero], texto: partes.slice(1).join(" "), extenso: true, fala: texto };
    }
    return { qtd: null, texto: texto, fala: texto };
  }

  function separarIntencoes(texto) {
    var protegido = String(texto || "").replace(/\r\n/g, "\n").replace(/(\d)\s*,\s*(\d)/g, "$1§$2");
    protegido = protegido.replace(/\s+e\s+/gi, "\n");
    var partes = protegido.split(/\s*(?:,|\n|;)\s*/);
    var itens = [];
    partes.forEach(function (parte) {
      var limpa = parte.replace(/§/g, ",").trim();
      quebrarPorQuantidade(limpa).forEach(function (fatia) {
        var item = interpretarItem(fatia);
        if (item) itens.push(item);
      });
    });
    return itens;
  }

  function rotulo(item) {
    if (!item) return "";
    if (item.medida || item.extenso) return item.fala || item.texto;
    /* Separador visual da linha: "10 - lâmpadas comuns". */
    if (item.qtd) return item.qtd + " - " + item.texto;
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

  function formularioAmareloPronto() {
    var form = document.querySelector(".cliente-form") || document.querySelector("form");
    if (!form) return false;
    var nomes = ["documento", "cep", "nome", "endereco", "numero", "bairro", "cidade", "uf", "celular", "email"];
    var i;
    for (i = 0; i < nomes.length; i += 1) {
      var campo = form.elements[nomes[i]];
      if (!campo || !String(campo.value || "").trim()) return false;
    }
    return true;
  }

  function gvValidarEForçarEnvio(adiado) {
    var quadro = document.querySelector(".quote-side") || document.querySelector("#carrinho");
    var lista = window.listaIntencoesVoz || window.gvIntencoes;
    var temLista = Array.isArray(lista) && lista.length >= 1;
    var temMarcador = quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1;
    if (quadro && (temLista || temMarcador)) {
      var nos = quadro.querySelectorAll("*");
      Array.prototype.forEach.call(nos, function (elemento) {
        var texto = String(elemento.textContent || "");
        if (texto.indexOf("Adicione ao menos um produto") === -1) return;
        if (texto.indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1) return;
        elemento.style.display = "none";
        elemento.hidden = true;
      });
      if (temLista) {
        var botao = quadro.querySelector("[data-enviar]");
        if (!botao) {
          var botoes = document.querySelectorAll("button");
          var i;
          for (i = 0; i < botoes.length; i += 1) {
            if (String(botoes[i].textContent || "").indexOf("Enviar Orçamento") !== -1) {
              botao = botoes[i];
              break;
            }
          }
        }
        if (botao) {
          botao.disabled = false;
          botao.removeAttribute("disabled");
        }
      }
    }
    if (adiado === true) return;
    window.setTimeout(function () { gvValidarEForçarEnvio(true); }, 0);
  }

  function publicarNoOrcamento(pacote, bloco) {
    window.listaIntencoesVoz = pacote.map(function (item) {
      return { qtd: item.qtd, texto: item.texto, rotulo: item.rotulo };
    });
    window.gvIntencoes = window.listaIntencoesVoz;
    var form = document.querySelector(".cliente-form");
    if (form) {
      var oculto = form.querySelector('input[name="gv-intencoes"]');
      if (!oculto) {
        oculto = document.createElement("input");
        oculto.type = "hidden";
        oculto.name = "gv-intencoes";
        oculto.className = "gv-intencoes-campo";
        form.appendChild(oculto);
      }
      oculto.value = JSON.stringify(window.listaIntencoesVoz);
    }
    var quadro = document.querySelector(".quote-side");
    if (quadro) {
      var aviso = quadro.querySelector("[data-gv-voz-resumo]");
      if (!aviso) {
        aviso = document.createElement("p");
        aviso.className = "gv-voz-resumo";
        aviso.setAttribute("data-gv-voz-resumo", "");
        aviso.style.margin = "0 0 8px";
        aviso.style.padding = "8px 10px";
        aviso.style.border = "1px solid rgba(0, 0, 0, 0.18)";
        aviso.style.borderRadius = "0.55rem";
        aviso.style.background = "#ffffff";
        aviso.style.color = "#1a1a1a";
        aviso.style.fontSize = "0.92rem";
        aviso.style.fontWeight = "700";
        aviso.style.lineHeight = "1.35";
        aviso.style.textAlign = "left";
        var pe = quadro.querySelector(".drawer-foot");
        if (pe) quadro.insertBefore(aviso, pe);
        else quadro.appendChild(aviso);
      }
      aviso.textContent = "📋 [Lista de Itens via Comando de Voz Inclusa]";
      aviso.hidden = false;
      var vazio = quadro.querySelector("[data-resumo-vazio]");
      if (vazio && !quadro.querySelector(".cart-list [data-qtd]")) vazio.hidden = true;
    }
    var erroEnvio = document.querySelector("[data-envio-aviso]");
    if (erroEnvio && String(erroEnvio.textContent || "").indexOf("Adicione ao menos um produto") !== -1) {
      erroEnvio.hidden = true;
      erroEnvio.textContent = "";
    }
    try {
      sessionStorage.setItem("gv-intencoes", JSON.stringify({ itens: window.listaIntencoesVoz, texto: bloco }));
    } catch (erro) { /* o navegador pode bloquear o armazenamento */ }
    protegerBotaoEnvio();
  }

  function protegerBotaoEnvio() {
    if (protegerBotaoEnvio.ligado) return;
    protegerBotaoEnvio.ligado = true;
    function manter() {
      var lista = window.listaIntencoesVoz || window.gvIntencoes;
      var quadro = document.querySelector(".quote-side");
      var visual = quadro && String(quadro.textContent || "").indexOf("[Lista de Itens via Comando de Voz Inclusa]") !== -1;
      if ((!lista || !lista.length) && !visual) return;
      var erro = document.querySelector("[data-envio-aviso]");
      if (erro && String(erro.textContent || "").indexOf("Adicione ao menos um produto") !== -1) {
        erro.style.display = "none";
        erro.hidden = true;
        erro.textContent = "";
      }
      if (!lista || lista.length < 1) return;
      var botao = document.querySelector("[data-enviar]");
      if (!botao) return;
      botao.disabled = false;
      botao.removeAttribute("disabled");
    }
    document.addEventListener("input", manter, false);
    document.addEventListener("keyup", manter, false);
    document.addEventListener("change", manter, false);
  }

  function lerFormularioAmarelo() {
    var form = document.querySelector(".cliente-form");
    var dados = form ? new FormData(form) : new FormData();
    var tipo = "pf";
    var marcado = form && form.querySelector('input[name="tipo"]:checked');
    if (marcado && marcado.value) tipo = String(marcado.value).toLowerCase();
    var nome = String(dados.get("nome") || "").trim();
    var celular = String(dados.get("celular") || "").trim();
    return {
      tipo: tipo === "pj" ? "pj" : "pf",
      nome: nome,
      documento: String(dados.get("documento") || "").trim(),
      telefone: celular,
      celular: celular,
      email: String(dados.get("email") || "").trim(),
      cep: String(dados.get("cep") || "").trim(),
      endereco: String(dados.get("endereco") || "").trim(),
      numero: String(dados.get("numero") || "").trim(),
      bairro: String(dados.get("bairro") || "").trim(),
      cidade: String(dados.get("cidade") || "").trim(),
      uf: String(dados.get("uf") || "").trim().toUpperCase()
    };
  }

  function descartarListaPublicada() {
    window.listaIntencoesVoz = [];
    window.gvIntencoes = [];
    var campo = document.querySelector('input[name="gv-intencoes"]');
    if (campo) campo.value = "";
    try { sessionStorage.removeItem("gv-intencoes"); } catch (erro) { /* o navegador pode bloquear o armazenamento */ }
    var marcador = document.querySelector("[data-gv-voz-resumo]");
    if (marcador) marcador.remove();
  }

  function abrirWhatsApp(texto) {
    var digitos = "5527998021221";
    var url = "https://wa.me/" + digitos + "?text=" + encodeURIComponent(texto);
    var aba = null;
    try { aba = window.open(url, "whatsapp-gigaeletro"); } catch (erro) { aba = null; }
    if (aba) return;
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function soltarConfirmar() {
    if (!confirmarLista) return;
    delete confirmarLista.dataset.gvEnviando;
    confirmarLista.textContent = "Confirmar e Enviar Lista";
    confirmarLista.disabled = !intencoes.length;
  }

  function confirmarEnvio() {
    if (!intencoes.length || !gravador || !confirmarLista) return;
    if (confirmarLista.dataset.gvEnviando === "1") return;
    var cliente = lerFormularioAmarelo();
    var pacote = intencoes.map(function (item) {
      return { qtd: item.qtd || 1, texto: item.texto, rotulo: rotulo(item) };
    }).filter(function (item) { return item.rotulo; });
    if (!pacote.length) return;
    confirmarLista.dataset.gvEnviando = "1";
    confirmarLista.disabled = true;
    confirmarLista.textContent = "Enviando...";
    /* O quadro da direita recebe os itens na hora; o PDF de intenções segue em paralelo. */
    document.dispatchEvent(new CustomEvent("gv-itens-orcamento", { detail: pacote }));
    fetch("/api/orcamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "intencoes",
        nome: cliente.nome,
        documento: cliente.documento,
        telefone: cliente.telefone,
        cliente: cliente,
        textos: pacote.map(function (item) { return item.rotulo; }),
        itens: pacote.map(function (item) {
          return { codigo: "", produto: item.rotulo, qtd: item.qtd || 1, preco: 0 };
        })
      })
    }).catch(function () { /* o orçamento da direita permanece mesmo se o PDF de intenções falhar */ });
    pararEscuta();
    limparIntencoes();
    gravador.hidden = true;
    /* A lista já entrou no orçamento: Produtos continua bloqueado. */
    modoIntencoes = true;
    travarCatalogo();
    refletirTipoOrcamento();
  }

  function concluirFluxoOrcamento() {
    pararEscuta();
    limparTranscricao();
    limparIntencoes();
    modoIntencoes = false;
    if (gravador) gravador.hidden = true;
    if (raiz && document.body.contains(raiz)) {
      raiz.remove();
      raiz = null;
    }
    liberarCatalogo();
    refletirTipoOrcamento();
  }

  function iniciar() {
    if (!document.body || !document.body.classList.contains("home")) return;
    if (document.querySelector(".gv-backdrop")) return;
    window.addEventListener("resize", function () {
      alinharComEnvio();
      alinharEscolha();
      centralizarModaisAbertos();
    });
    document.addEventListener("gv-orcamento-enviado", concluirFluxoOrcamento);
    var formulario = document.querySelector("form");
    if (formulario && !formulario.dataset.gvForcaEnvio) {
      formulario.dataset.gvForcaEnvio = "1";
      formulario.addEventListener("input", gvValidarEForçarEnvio);
    }
    raiz = criarTela();
    document.body.appendChild(raiz);
    alinharEscolha();
    var tipo = document.getElementById("btnTipoOrcamento");
    if (tipo && !tipo.dataset.gvTipo) {
      tipo.dataset.gvTipo = "1";
      tipo.addEventListener("click", alternarTipoOrcamento);
    }
    refletirTipoOrcamento();
    observarModaisHome();
    var primeiro = raiz.querySelector('[data-gv-acao="catalogo"]');
    if (primeiro) primeiro.focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
