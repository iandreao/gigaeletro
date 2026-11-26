/* Atualização automática após deploy: compara /versao.json com localStorage e recarrega 1x. */
(function () {
  var CHAVE = "giga_app_versao";
  var TRAVA = "giga_app_reload";
  function checarVersaoApp() {
    fetch("/versao.json?t=" + Date.now(), { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (!resposta.ok) return null;
      return resposta.json().catch(function () { return null; });
    }).then(function (dados) {
      var atual = String(dados && dados.versao || "").trim();
      if (!atual) return;
      var local = "";
      try { local = String(localStorage.getItem(CHAVE) || ""); } catch (erro) { local = ""; }
      if (local === atual) {
        try { sessionStorage.removeItem(TRAVA); } catch (erroLimpa) {}
        return;
      }
      try { localStorage.setItem(CHAVE, atual); } catch (erroGrava) {}
      if (!local) return;
      try {
        if (sessionStorage.getItem(TRAVA) === atual) return;
        sessionStorage.setItem(TRAVA, atual);
      } catch (erroTrava) {}
      window.location.reload();
    }).catch(function () {});
  }
  checarVersaoApp();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checarVersaoApp();
  });
})();

(function () {
  var SESSAO = "gigaeletro-admin";
  var OPERADOR = "gigaeletro_operador";
  var ultimaAbaLog = "";

  var formSenha = document.querySelector("[data-admin-senha]");
  var painel = document.querySelector("[data-admin-arquivo]");
  var erro = document.querySelector("[data-admin-erro]");
  var status = document.querySelector("[data-admin-status]");
  var auditoria = document.querySelector("[data-auditoria]");
  var nomeArquivo = document.querySelector("[data-admin-arquivo-nome]");
  var processar = document.querySelector("[data-processar]");
  var input = document.querySelector("#planilha");
  var planilhaEscolhida = null;
  var loginAdmin = document.querySelector("[data-login-admin]");
  var erroLogin = document.querySelector("[data-login-erro]");
  var campoSenha = loginAdmin ? loginAdmin.elements.senha : null;
  var campoFuncionario = document.getElementById("admin-funcionario-select");
  var botaoEntrar = loginAdmin ? loginAdmin.querySelector("[data-entrar]") : null;
  var operadorEl = document.querySelector("[data-gestor-operador]");

  function dispositivoPainel() {
    var toque = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    return toque && window.innerWidth < 1024 ? "Mobile" : "Desktop";
  }

  function lerOperador() {
    try { return String(sessionStorage.getItem(OPERADOR) || "").trim(); } catch (erro) { return ""; }
  }

  function gravarOperador(nome) {
    try {
      if (nome) sessionStorage.setItem(OPERADOR, nome);
      else sessionStorage.removeItem(OPERADOR);
    } catch (erro) {}
  }

  function exibirOperador() {
    var nome = lerOperador();
    if (!operadorEl) return;
    if (!nome) {
      operadorEl.hidden = true;
      operadorEl.textContent = "";
      return;
    }
    operadorEl.hidden = false;
    operadorEl.innerHTML = "Operador: <strong>" + escapar(nome) + '</strong> | <button type="button" data-trocar-operador>Trocar</button>';
  }

  function registrarAcaoEquipe(acao) {
    var nome = lerOperador();
    var texto = String(acao || "").trim();
    if (!nome || !texto) return;
    fetch("/api/equipe/log", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funcionario: nome, acao: texto, dispositivo: dispositivoPainel() })
    }).catch(function () {});
  }

  function atualizarEntrar() {
    var temSenha = !!(campoSenha && campoSenha.value.length > 0);
    var temFuncionario = !!(campoFuncionario && campoFuncionario.value);
    if (botaoEntrar) botaoEntrar.disabled = !(temSenha && temFuncionario);
  }

  function limparCampoSenha() {
    if (campoSenha) campoSenha.value = "";
    atualizarEntrar();
  }

  function popularSelectFuncionarios(nomes) {
    if (!campoFuncionario) return;
    var atual = campoFuncionario.value;
    var lista = [];
    (Array.isArray(nomes) ? nomes : []).forEach(function (item) {
      var nome = typeof item === "string" ? item : (item && item.nome ? item.nome : "");
      nome = String(nome || "").trim();
      if (!nome) return;
      if (item && typeof item === "object" && item.ativo === false) return;
      if (lista.indexOf(nome) < 0) lista.push(nome);
    });
    if (!lista.length) lista = ["Administrador"];
    if (lista.indexOf("Administrador") < 0) lista.unshift("Administrador");
    campoFuncionario.innerHTML = '<option value="">Selecione</option>' + lista.map(function (nome) {
      return '<option value="' + escapar(nome) + '">' + escapar(nome) + "</option>";
    }).join("");
    if (atual && lista.indexOf(atual) >= 0) campoFuncionario.value = atual;
    atualizarEntrar();
  }

  function carregarFuncionariosLogin() {
    fetch("/api/equipe/funcionarios", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      popularSelectFuncionarios(corpo && corpo.funcionarios ? corpo.funcionarios : ["Administrador"]);
    }).catch(function () {
      popularSelectFuncionarios(["Administrador"]);
    });
  }

  /* O dispositivo é compartilhado: a senha nunca pode aparecer preenchida pelo navegador. */
  limparCampoSenha();
  carregarFuncionariosLogin();
  document.addEventListener("DOMContentLoaded", limparCampoSenha);
  window.addEventListener("load", limparCampoSenha);
  /* Voltar/avançar no histórico restaura a página do cache com o campo preenchido. */
  window.addEventListener("pageshow", limparCampoSenha);
  if (campoSenha) {
    campoSenha.addEventListener("focus", limparCampoSenha);
    campoSenha.addEventListener("input", atualizarEntrar);
    campoSenha.addEventListener("input", function () {
      if (erroLogin && campoSenha.value.length > 0) erroLogin.hidden = true;
    });
  }
  if (campoFuncionario) {
    campoFuncionario.addEventListener("change", atualizarEntrar);
  }

  function avisoLogin(texto) {
    if (!erroLogin) return;
    erroLogin.textContent = texto || "Senha Inválida";
    erroLogin.hidden = false;
  }

  function ocultarModaisPainel() {
    if (typeof liberarPdfDetalhe === "function") liberarPdfDetalhe();
    document.querySelectorAll("[data-detalhe], .overlay[data-fechar-detalhe], [data-equipe-acoes-modal], .equipe-acoes-overlay, [data-equipe-acoes-tooltip]").forEach(function (el) {
      el.hidden = true;
      el.style.removeProperty("display");
    });
    var corpoDetalhe = document.querySelector("[data-detalhe-corpo]");
    if (corpoDetalhe) corpoDetalhe.innerHTML = "";
    var corpoEquipe = document.querySelector("[data-equipe-acoes-corpo]");
    if (corpoEquipe) corpoEquipe.innerHTML = "";
    var botaoImprimir = document.querySelector("[data-detalhe-imprimir]");
    if (botaoImprimir) botaoImprimir.hidden = true;
  }

  ocultarModaisPainel();

  function mostrarLogin() {
    ocultarModaisPainel();
    document.querySelectorAll("[data-area-restrita]").forEach(function (area) { area.hidden = true; });
    limparCampoSenha();
    carregarFuncionariosLogin();
    if (loginAdmin) loginAdmin.hidden = false;
    if (campoFuncionario) campoFuncionario.focus();
    else if (campoSenha) campoSenha.focus();
  }

  var fecharLogin = document.querySelector("[data-fechar-login]");
  if (fecharLogin) {
    fecharLogin.addEventListener("click", function () {
      limparCampoSenha();
      window.location.replace("/");
    });
  }

  fetch("/api/sessao", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
    return resposta.json();
  }).then(function (corpo) {
    if (!corpo || !corpo.ok) {
      mostrarLogin();
      return;
    }
    if (!lerOperador()) {
      mostrarLogin();
      return;
    }
    if (loginAdmin) loginAdmin.hidden = true;
    mostrarPainel();
  }).catch(function () {
    mostrarLogin();
  });

  if (loginAdmin) {
    loginAdmin.addEventListener("submit", function (event) {
      event.preventDefault();
      var dadosLogin = new FormData(loginAdmin);
      var senha = String(dadosLogin.get("senha") || "").trim();
      var funcionario = String(dadosLogin.get("funcionario") || "").trim();
      limparCampoSenha();
      if (erroLogin) erroLogin.hidden = true;
      if (!funcionario) {
        avisoLogin("Selecione quem está acessando.");
        return;
      }
      fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senha, funcionario: funcionario, dispositivo: dispositivoPainel() })
      }).then(function (resposta) {
        return resposta.json().catch(function () { return null; }).then(function (corpo) {
          return { status: resposta.status, corpo: corpo };
        });
      }).then(function (resultado) {
        var corpo = resultado.corpo;
        if (!corpo || !corpo.ok) {
          limparCampoSenha();
          /* 503 é falta de configuração no servidor, não senha errada. */
          avisoLogin(resultado.status === 503 && corpo && corpo.erro ? corpo.erro : (corpo && corpo.erro ? corpo.erro : "Senha Inválida"));
          if (campoSenha) campoSenha.focus();
          return;
        }
        gravarOperador(corpo.funcionario || funcionario);
        loginAdmin.hidden = true;
        mostrarPainel();
      }).catch(function () {
        limparCampoSenha();
        avisoLogin("Sem conexão com o servidor. Tente novamente.");
        if (campoSenha) campoSenha.focus();
      });
    });
  }

  var sair = document.querySelector("[data-sair]");
  if (sair) {
    sair.addEventListener("click", function () {
      limparAuditoria();
      sessionStorage.removeItem(SESSAO);
      sessionStorage.removeItem("gigaeletro-auditoria");
      gravarOperador("");
      fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
        window.location.replace("/");
      });
    });
  }

  document.addEventListener("click", function (evento) {
    if (!evento.target.closest("[data-trocar-operador]")) return;
    gravarOperador("");
    fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
      mostrarLogin();
    });
  });

  var TEXTO_PROCESSAR = "Processar e Atualizar Estoque no Site";
  /* A Vercel recusa corpo acima de 4,5 MB antes de chegar ao servidor, com uma página que não é JSON. */
  var LIMITE_PLANILHA = 4 * 1024 * 1024;
  var PRAZO_PLANILHA = 90000;
  var processandoPlanilha = false;
  var syncVazio = document.querySelector("[data-sync-vazio]");
  var syncMeta = document.querySelector("[data-sync-meta]");
  var syncOrigem = document.querySelector("[data-sync-origem]");
  var syncAudit = document.querySelector("[data-sync-audit]");
  var syncGrid = document.querySelector("[data-sync-grid]");
  var syncItens = document.querySelector("[data-sync-itens]");
  var syncPreco = document.querySelector("[data-sync-preco]");
  var syncEstoque = document.querySelector("[data-sync-estoque]");
  var syncAtualizar = document.querySelector("[data-sync-atualizar]");

  function avisoEstoque(texto, tipo) {
    if (!status) return;
    status.textContent = texto || "";
    status.hidden = !texto;
    status.classList.toggle("aviso-ok", tipo === "ok");
    status.classList.toggle("aviso-erro", tipo === "erro");
  }

  function falhaHttpEstoque(codigo) {
    if (codigo === 413) return "A planilha é grande demais para o envio (limite ~4 MB). Exporte do Uniplus em .xls/.xlsx/.csv e tente de novo.";
    if (codigo === 504) return "O servidor demorou demais para processar a planilha. O catálogo anterior foi mantido; tente novamente.";
    return "O servidor não conseguiu processar a planilha (erro " + codigo + "). O catálogo anterior foi mantido.";
  }

  function formatarNumeroBR(valor, casas) {
    var n = Number(valor);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas
    });
  }

  function formatarMoedaBR(valor) {
    var n = Number(valor);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function renderStatusSync(statusSync) {
    if (!statusSync) {
      if (syncVazio) {
        syncVazio.hidden = false;
        syncVazio.textContent = "Nenhuma sincronização registrada ainda.";
      }
      if (syncMeta) syncMeta.hidden = true;
      if (syncOrigem) syncOrigem.hidden = true;
      if (syncAudit) syncAudit.hidden = true;
      if (syncGrid) syncGrid.hidden = true;
      return;
    }
    if (syncVazio) syncVazio.hidden = true;
    if (syncMeta) {
      syncMeta.hidden = false;
      syncMeta.textContent = (statusSync.dataHora || "—") +
        (statusSync.arquivo ? " · Arquivo: " + statusSync.arquivo : "") +
        (statusSync.usuario ? " · Por: " + statusSync.usuario : "");
    }
    if (syncOrigem) {
      syncOrigem.hidden = false;
      syncOrigem.textContent = statusSync.origem || "—";
      syncOrigem.classList.toggle("sync-badge-robo", /rob[oô]/i.test(String(statusSync.origem || "")));
      syncOrigem.classList.toggle("sync-badge-manual", /manual/i.test(String(statusSync.origem || "")));
    }
    if (syncAudit) {
      syncAudit.hidden = !statusSync.auditoriaOk;
      syncAudit.textContent = statusSync.auditoriaOk ? "Auditado 0.00" : "Auditoria pendente";
    }
    if (syncGrid) syncGrid.hidden = false;
    if (syncItens) syncItens.textContent = formatarNumeroBR(statusSync.itensAtivos, 0);
    if (syncPreco) syncPreco.textContent = formatarMoedaBR(statusSync.somaPreco);
    if (syncEstoque) syncEstoque.textContent = formatarNumeroBR(statusSync.somaEstoque, 2);
  }

  function carregarStatusSync() {
    if (syncVazio) {
      syncVazio.hidden = false;
      syncVazio.textContent = "Carregando status…";
    }
    return fetch("/api/catalogo/status-sync", {
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (resposta) {
      return resposta.json().then(function (corpo) {
        if (resposta.status === 401) {
          mostrarLogin();
          throw new Error("Sessão expirada.");
        }
        if (!corpo || !corpo.ok) throw new Error((corpo && corpo.erro) || "Falha ao ler status.");
        renderStatusSync(corpo.encontrado ? corpo.status : null);
        return corpo;
      });
    }).catch(function () {
      if (syncVazio) {
        syncVazio.hidden = false;
        syncVazio.textContent = "Não foi possível carregar o status da sincronização.";
      }
    });
  }

  if (syncAtualizar) {
    syncAtualizar.addEventListener("click", function () {
      carregarStatusSync();
    });
  }

  prepararDrop(document.querySelector("[data-drop-admin]"), input, function (file) {
    if (processandoPlanilha) return;
    planilhaEscolhida = file;
    if (nomeArquivo) {
      nomeArquivo.hidden = !file;
      nomeArquivo.textContent = file ? "Arquivo selecionado: " + file.name : "";
    }
    if (processar) processar.disabled = !file;
    avisoEstoque("");
  });

  if (processar) {
    processar.addEventListener("click", function () {
      if (processandoPlanilha) return;
      if (!planilhaEscolhida) {
        avisoEstoque("Selecione a planilha Uniplus (.xls, .xlsx ou .csv) antes de processar.", "erro");
        return;
      }
      if (planilhaEscolhida.size > LIMITE_PLANILHA) {
        avisoEstoque("A planilha tem " + (planilhaEscolhida.size / 1048576).toFixed(1).replace(".", ",") + " MB e o limite de envio é 4 MB.", "erro");
        return;
      }
      processandoPlanilha = true;
      processar.disabled = true;
      processar.textContent = "Processando e auditando…";
      limparAuditoria();
      avisoEstoque("Enviando e auditando " + planilhaEscolhida.name + " (3 pontas)…");
      var dados = new FormData();
      dados.append("arquivo", planilhaEscolhida, planilhaEscolhida.name);
      dados.append("usuario", lerOperador() || "Administrador");
      dados.append("dispositivo", dispositivoPainel());
      var controle = window.AbortController ? new AbortController() : null;
      var prazo = controle ? window.setTimeout(function () { controle.abort(); }, PRAZO_PLANILHA) : 0;
      fetch("/api/catalogo/upload-manual", {
        method: "POST",
        credentials: "same-origin",
        body: dados,
        signal: controle ? controle.signal : undefined
      }).then(function (resposta) {
        /* Páginas de erro da plataforma (413, 504) não são JSON: o aviso sai do código HTTP. */
        return resposta.text().then(function (texto) {
          var corpo = null;
          try { corpo = JSON.parse(texto); } catch (semJson) { corpo = null; }
          if (resposta.status === 401) {
            mostrarLogin();
            throw new Error("Sessão do painel expirada. Entre novamente na Área Restrita.");
          }
          if (!corpo || typeof corpo !== "object") throw new Error(falhaHttpEstoque(resposta.status));
          if (!resposta.ok || !corpo.ok) {
            var detalhe = corpo.erro || falhaHttpEstoque(resposta.status);
            if (corpo.origem || corpo.processado || corpo.blob) mostrarAuditoria(corpo);
            throw new Error(detalhe);
          }
          return corpo;
        });
      }, function (falha) {
        throw new Error(falha && falha.name === "AbortError"
          ? "O servidor não respondeu em 90 segundos. Confira se o catálogo foi atualizado antes de tentar de novo."
          : "Sem conexão com o servidor. Confira a internet e tente novamente. O catálogo anterior foi mantido.");
      }).then(function (corpo) {
        mostrarAuditoria(corpo);
        if (corpo.ultima_sync) renderStatusSync(corpo.ultima_sync);
        else carregarStatusSync();
        avisoEstoque(
          "Estoque atualizado e auditado: " + (corpo.itens_ativos || corpo.inseridos || 0) +
          " itens ativos · diferença 0.00.",
          "ok"
        );
        limparPlanilhaEscolhida();
      }).catch(function (falha) {
        /* A planilha continua escolhida para tentar de novo. */
        avisoEstoque(falha && falha.message ? falha.message : "A leitura falhou e o catálogo anterior foi mantido.", "erro");
      }).then(function () {
        window.clearTimeout(prazo);
        processandoPlanilha = false;
        processar.textContent = TEXTO_PROCESSAR;
        processar.disabled = !planilhaEscolhida;
      });
    });
  }

  function limparPlanilhaEscolhida() {
    planilhaEscolhida = null;
    if (nomeArquivo) {
      nomeArquivo.hidden = true;
      nomeArquivo.textContent = "";
    }
    if (input) input.value = "";
    if (processar) processar.disabled = true;
  }

  /* Navegador que entra no painel passa a contar como acesso interno no rastreamento do site.
     Um nome já marcado por ?equipe= é mais específico e fica mantido. */
  function marcarInterno() {
    try {
      var operador = lerOperador() || "Admin";
      if (!window.localStorage.getItem("gigaeletro_interno")) window.localStorage.setItem("gigaeletro_interno", operador);
    } catch (semArmazenamento) {}
  }

  var ACOES_ABA = {
    estoque: "Abriu Atualizar Estoque",
    orcamentos: "Abriu Orçamentos Recebidos",
    dashboard: "Abriu Painel Comercial",
    trafego: "Abriu Rastreamento de Tráfego",
    equipe: "Abriu Acessos Equipe"
  };

  function mostrarPainel() {
    marcarInterno();
    exibirOperador();
    if (formSenha) formSenha.hidden = true;
    document.querySelectorAll("[data-area-restrita]").forEach(function (area) { area.hidden = false; });
    mostrarAba("orcamentos", true);
    limparAuditoria();
    preencherDataHoje();
    carregarOrcamentos();
    carregarDashboard();
  }

  function mostrarAba(nome, silencioso) {
    document.querySelectorAll("[data-visao]").forEach(function (painelVisao) {
      painelVisao.hidden = painelVisao.getAttribute("data-visao") !== nome;
    });
    document.querySelectorAll("[data-aba]").forEach(function (botao) {
      botao.setAttribute("aria-selected", botao.getAttribute("data-aba") === nome ? "true" : "false");
    });
    if (!silencioso && ACOES_ABA[nome] && ultimaAbaLog !== nome) {
      ultimaAbaLog = nome;
      registrarAcaoEquipe(ACOES_ABA[nome]);
    }
  }

  function fecharMenuGestor() {
    var botao = document.querySelector(".nav-toggle");
    var abas = document.querySelector(".gestor-abas");
    if (botao) botao.setAttribute("aria-expanded", "false");
    if (abas) abas.classList.remove("is-open");
  }

  document.querySelectorAll("[data-aba]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var aba = botao.getAttribute("data-aba");
      mostrarAba(aba);
      fecharMenuGestor();
      if (aba === "estoque") carregarStatusSync();
      if (aba === "dashboard") carregarDashboard();
      if (aba === "trafego") carregarTrafego();
      if (aba === "equipe") carregarAcessosEquipe();
    });
  });

  var menuGestor = document.querySelector(".nav-toggle");
  if (menuGestor) {
    menuGestor.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var abas = document.querySelector(".gestor-abas");
      var aberto = menuGestor.getAttribute("aria-expanded") === "true";
      if (aberto || !abas) {
        fecharMenuGestor();
        return;
      }
      menuGestor.setAttribute("aria-expanded", "true");
      abas.classList.add("is-open");
    });
    document.addEventListener("click", function (event) {
      if (menuGestor.getAttribute("aria-expanded") !== "true") return;
      if (event.target.closest(".nav-toggle") || event.target.closest(".gestor-abas")) return;
      fecharMenuGestor();
    });
  }

  function limparAuditoria() {
    if (!auditoria) return;
    [
      "data-audit-origem-qtd", "data-audit-proc-qtd", "data-audit-blob-qtd",
      "data-audit-origem-preco", "data-audit-proc-preco", "data-audit-blob-preco",
      "data-audit-origem-estoque", "data-audit-proc-estoque", "data-audit-blob-estoque",
      "data-audit-descartados", "data-audit-arquivo", "data-audit-quando"
    ].forEach(function (attr) {
      var el = auditoria.querySelector("[" + attr + "]");
      if (el) el.textContent = "—";
    });
    var dif = auditoria.querySelector("[data-audit-diferenca]");
    if (dif) {
      dif.textContent = "—";
      var linha = dif.closest("tr");
      if (linha) linha.classList.remove("is-erro");
    }
    auditoria.hidden = true;
  }

  function preencherPonta(prefixo, ponta) {
    if (!ponta) return;
    var qtd = auditoria.querySelector("[data-audit-" + prefixo + "-qtd]");
    var preco = auditoria.querySelector("[data-audit-" + prefixo + "-preco]");
    var estoque = auditoria.querySelector("[data-audit-" + prefixo + "-estoque]");
    if (qtd) qtd.textContent = formatarNumeroBR(ponta.qtd_itens, 0);
    if (preco) preco.textContent = formatarMoedaBR(ponta.soma_preco);
    if (estoque) estoque.textContent = formatarNumeroBR(ponta.soma_estoque, 2);
  }

  function mostrarAuditoria(corpo) {
    if (!auditoria || !corpo) return;
    preencherPonta("origem", corpo.origem);
    preencherPonta("proc", corpo.processado);
    preencherPonta("blob", corpo.blob);
    var descartados = auditoria.querySelector("[data-audit-descartados]");
    var arquivo = auditoria.querySelector("[data-audit-arquivo]");
    var quando = auditoria.querySelector("[data-audit-quando]");
    if (descartados) descartados.textContent = String(corpo.itens_descartados != null ? corpo.itens_descartados : 0);
    if (arquivo) arquivo.textContent = corpo.arquivo || (corpo.ultima_sync && corpo.ultima_sync.arquivo) || "—";
    if (quando) quando.textContent = corpo.atualizado_em || (corpo.ultima_sync && corpo.ultima_sync.dataHora) || "—";
    var dif = auditoria.querySelector("[data-audit-diferenca]");
    var ok = !!corpo.ok && corpo.auditoria_ok !== false && !(corpo.diferenca && (
      Number(corpo.diferenca.qtd_itens) !== 0 ||
      Number(corpo.diferenca.soma_preco) !== 0 ||
      Number(corpo.diferenca.soma_estoque) !== 0
    ));
    if (dif) {
      dif.textContent = ok
        ? "0.00 (Auditado com Sucesso)"
        : (corpo.erro || "Divergência detectada na auditoria");
      var linha = dif.closest("tr");
      if (linha) linha.classList.toggle("is-erro", !ok);
    }
    auditoria.hidden = false;
  }

  function escapar(valor) {
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function campoPorId(id, seletor) {
    return document.getElementById(id) || document.querySelector(seletor);
  }

  var campoDataInicio = campoPorId("filtro-data-inicio", "[data-gestor-data-inicio]");
  var campoDataFim = campoPorId("filtro-data-fim", "[data-gestor-data-fim]");
  var campoDocumento = campoPorId("filtro-cpf-cnpj", "[data-gestor-documento]");
  var listaGestor = document.querySelector("[data-gestor-lista]");
  var vazioGestor = document.querySelector("[data-gestor-vazio]");
  var avisoBusca = document.querySelector("[data-gestor-busca-aviso]");
  var detalhe = document.querySelector("[data-detalhe]");
  var detalheCorpo = document.querySelector("[data-detalhe-corpo]");
  var orcamentosAtuais = [];
  var orcamentosCarregados = [];
  var cargaConcluida = false;
  var campoFiltroStatus = campoPorId("filtro-status", "[data-gestor-status]");
  var campoFiltroVendedor = campoPorId("filtro-vendedor", "[data-gestor-vendedor]");

  [campoDataInicio, campoDataFim, campoDocumento, campoFiltroStatus, campoFiltroVendedor].forEach(function (campo) {
    if (!campo) return;
    campo.readOnly = false;
    campo.disabled = false;
    campo.removeAttribute("readonly");
    campo.removeAttribute("disabled");
  });

  function mostrarAvisoBusca(texto) {
    if (texto) console.log("[orcamentos]", texto);
    if (!avisoBusca) return;
    avisoBusca.hidden = !texto;
    avisoBusca.textContent = texto || "";
  }

  function lerFiltrosBusca() {
    var inicio = document.getElementById("filtro-data-inicio");
    var fim = document.getElementById("filtro-data-fim");
    var documento = document.getElementById("filtro-cpf-cnpj");
    var status = document.getElementById("filtro-status");
    var vendedor = document.getElementById("filtro-vendedor");
    return {
      dataInicio: dataParaConsulta(inicio ? inicio.value : ""),
      dataFim: dataParaConsulta(fim ? fim.value : ""),
      cpf_cnpj: String(documento ? documento.value : "").replace(/\D/g, "").slice(0, 14),
      status: status ? status.value : "",
      vendedor: vendedor ? vendedor.value : ""
    };
  }

  function digitosDocumento(valor) {
    return String(valor || "").replace(/\D/g, "").slice(0, 14);
  }

  function moedaPainel(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function documentoVisivel(digitos) {
    if (digitos.length === 11) {
      return digitos.slice(0, 3) + "." + digitos.slice(3, 6) + "." + digitos.slice(6, 9) + "-" + digitos.slice(9);
    }
    if (digitos.length === 14) {
      return digitos.slice(0, 2) + "." + digitos.slice(2, 5) + "." + digitos.slice(5, 8) + "/" + digitos.slice(8, 12) + "-" + digitos.slice(12);
    }
    return digitos;
  }

  function dataVisivel(iso) {
    var normal = dataParaConsulta(iso);
    var partes = String(normal || iso || "").split("-");
    if (partes.length !== 3) return iso || "";
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function dataParaConsulta(valor) {
    var texto = String(valor || "").trim();
    var br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return br[3] + "-" + br[2] + "-" + br[1];
    var iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    return "";
  }

  function dataHojeIso() {
    var formato = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return dataParaConsulta(formato.format(new Date()));
  }

  function preencherDataHoje() {
    var hoje = dataHojeIso();
    if (campoDataInicio && !campoDataInicio.value) campoDataInicio.value = hoje;
    if (campoDataFim && !campoDataFim.value) campoDataFim.value = hoje;
  }

  function iconeAcao(tipo) {
    var comum = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (tipo === "olho") {
      return '<svg ' + comum + '><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    if (tipo === "lixeira") {
      return '<svg ' + comum + '><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
    }
    if (tipo === "desfazer") {
      return '<svg ' + comum + '><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';
    }
    return '<svg ' + comum + '><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';
  }

  function acharOrcamento(id) {
    var fontes = [orcamentosCarregados, orcamentosAtuais];
    var i;
    for (i = 0; i < fontes.length; i += 1) {
      var achado = (fontes[i] || []).find(function (item) { return String(item.id) === String(id); });
      if (achado) return achado;
    }
    return null;
  }

  var pdfDetalheUrl = "";
  var pdfDetalheRevogar = false;
  var botaoDetalheImprimir = document.querySelector("[data-detalhe-imprimir]");

  function liberarPdfDetalhe() {
    if (pdfDetalheRevogar && pdfDetalheUrl) {
      try { URL.revokeObjectURL(pdfDetalheUrl); } catch (erro) {}
    }
    pdfDetalheUrl = "";
    pdfDetalheRevogar = false;
    if (detalhe) detalhe.removeAttribute("data-pdf-url");
    if (botaoDetalheImprimir) botaoDetalheImprimir.hidden = true;
  }

  function cepPedido(valor) {
    var digitos = String(valor || "").replace(/\D/g, "").slice(0, 8);
    if (digitos.length === 8) return digitos.slice(0, 5) + "-" + digitos.slice(5);
    return String(valor || "").trim();
  }

  function clientePdfOrcamento(item) {
    var origem = item && item.cliente && typeof item.cliente === "object" ? item.cliente : {};
    var documento = item.documento || origem.documento || "";
    return {
      nome: item.nome || origem.nome || "",
      documento: documentoVisivel(String(documento)) || String(documento || ""),
      endereco: origem.endereco || item.endereco || "",
      numero: origem.numero || item.numero || "",
      bairro: origem.bairro || item.bairro || "",
      cidade: origem.cidade || item.cidade || "",
      uf: String(origem.uf || item.uf || "").toUpperCase(),
      cep: cepPedido(origem.cep || item.cep || ""),
      celular: item.telefone || origem.celular || origem.telefone || "",
      email: origem.email || item.email || ""
    };
  }

  function itensPdfOrcamento(item) {
    return (Array.isArray(item.itens) ? item.itens : []).map(function (produto) {
      var qtd = Number(produto && produto.qtd) || 0;
      var preco = Number(produto && produto.preco);
      if (!isFinite(preco)) {
        var total = Number(produto && produto.valor);
        preco = qtd > 0 && isFinite(total) ? total / qtd : 0;
      }
      return {
        codigo: String((produto && produto.codigo) || ""),
        produto: String((produto && produto.produto) || ""),
        qtd: qtd || 1,
        preco: preco
      };
    });
  }

  function urlPdfSalvo(item) {
    var id = String((item && item.pdfId) || "").trim();
    if (!id) return "";
    return "/api/ver-pdf?id=" + encodeURIComponent(id) + "&arquivo=pdf";
  }

  function obterPdfOrcamento(item) {
    var salvo = urlPdfSalvo(item);
    if (salvo) {
      return Promise.resolve({ url: salvo, revogar: false });
    }
    if (!window.GigaeletroPedidoPdf || !window.GigaeletroPedidoPdf.gerar) {
      return Promise.reject(new Error("Gerador de PDF indisponível."));
    }
    try {
      var blob = window.GigaeletroPedidoPdf.gerar({
        cliente: clientePdfOrcamento(item),
        itens: itensPdfOrcamento(item),
        subtotal: item.total,
        dataCriacao: item.data ? new Date(item.data) : new Date()
      });
      var url = URL.createObjectURL(blob);
      return Promise.resolve({ url: url, revogar: true });
    } catch (erro) {
      return Promise.reject(erro);
    }
  }

  function mostrarPdfNoModal(url) {
    if (!detalheCorpo) return;
    detalheCorpo.innerHTML =
      '<iframe class="pedido-pdf-frame" title="Pedido de Orçamento" src="' + escapar(url) + '"></iframe>';
    if (detalhe) detalhe.setAttribute("data-pdf-url", url);
    if (botaoDetalheImprimir) botaoDetalheImprimir.hidden = false;
  }

  function abrirDetalhe(item) {
    if (!detalhe || !detalheCorpo || !item) return;
    liberarPdfDetalhe();
    detalheCorpo.innerHTML = '<p class="pedido-pdf-status">Carregando PDF oficial...</p>';
    detalhe.hidden = false;
    detalhe.style.removeProperty("display");
    var fundo = document.querySelector(".overlay[data-fechar-detalhe]");
    if (fundo) {
      fundo.hidden = false;
      fundo.style.removeProperty("display");
    }
    obterPdfOrcamento(item).then(function (resultado) {
      pdfDetalheUrl = resultado.url;
      pdfDetalheRevogar = !!resultado.revogar;
      mostrarPdfNoModal(resultado.url);
    }).catch(function () {
      detalheCorpo.innerHTML = '<p class="pedido-pdf-status pedido-pdf-erro">Não foi possível abrir o PDF oficial deste orçamento.</p>';
      if (botaoDetalheImprimir) botaoDetalheImprimir.hidden = true;
    });
  }

  function fecharDetalhe() {
    liberarPdfDetalhe();
    if (detalhe) {
      detalhe.hidden = true;
      detalhe.style.removeProperty("display");
    }
    if (detalheCorpo) detalheCorpo.innerHTML = "";
    var fundo = document.querySelector(".overlay[data-fechar-detalhe]");
    if (fundo) {
      fundo.hidden = true;
      fundo.style.removeProperty("display");
    }
  }

  function abrirPdfExterno(url) {
    if (!url) return;
    var janela = window.open(url, "_blank", "noopener,noreferrer");
    if (janela) janela.focus();
  }

  function imprimirOrcamento(item) {
    if (!item) return;
    obterPdfOrcamento(item).then(function (resultado) {
      abrirPdfExterno(resultado.url);
      if (resultado.revogar) {
        window.setTimeout(function () {
          try { URL.revokeObjectURL(resultado.url); } catch (erro) {}
        }, 60000);
      }
    }).catch(function () {
      window.alert("Não foi possível gerar ou abrir o PDF oficial deste orçamento.");
    });
  }

  if (botaoDetalheImprimir) {
    botaoDetalheImprimir.addEventListener("click", function () {
      var url = (detalhe && detalhe.getAttribute("data-pdf-url")) || pdfDetalheUrl;
      abrirPdfExterno(url);
    });
  }

  var STATUS_ORCAMENTO = ["Recebido", "Analisado", "Respondido"];
  var VENDEDORES = ["Bruno", "Summer", "Júlio", "Aceliani"];

  function itemExcluido(item) {
    var valor = item && item.excluido;
    if (valor === true || valor === 1) return true;
    if (valor === false || valor == null) return false;
    var texto = String(valor).trim().toLowerCase();
    return texto === "1" || texto === "true" || texto === "sim" || texto === "yes";
  }

  function statusAtendimento(item) {
    var texto = String((item && item.status) || "").trim();
    if (texto === "A Enviar") {
      /* Legado rebaixado: PDF oficial ou canal final = Recebido (paridade com status_envio_de). */
      var meio = String((item && item.meio_envio) || "").trim();
      var pdfId = String((item && item.pdfId) || "").trim();
      if (meio === "WhatsApp" || meio === "E-mail" || meio === "Comando de Voz" || pdfId) return "Recebido";
      return "A Enviar";
    }
    /* Vazio/None/Pendente/Enviado/Em aberto/Novo/Recebido = status inicial Recebido. */
    if (!texto || texto === "None" || texto === "null" || texto === "Enviado" || texto === "Pendente" || texto === "Recebido" || texto === "Em aberto" || texto === "Novo") {
      return "Recebido";
    }
    return STATUS_ORCAMENTO.indexOf(texto) >= 0 ? texto : "Recebido";
  }

  function filtroStatusEhExcluido(valor) {
    return String(valor || "").normalize("NFC").trim().toLowerCase() === "excluído";
  }

  function statusAtual(item) {
    /* Coluna Status: excluídos mostram "Excluído"; o atendimento original fica no campo status. */
    if (itemExcluido(item)) return "Excluído";
    return statusAtendimento(item);
  }

  function vendedorAtual(item) {
    return VENDEDORES.indexOf(item && item.vendedor) >= 0 ? item.vendedor : "";
  }

  function classeStatus(valor) {
    if (valor === "Analisado") return "analisado";
    if (valor === "Respondido") return "respondido";
    if (valor === "Excluído") return "excluido";
    return "recebido";
  }

  function opcoesSelect(valores, atual, rotuloVazio) {
    var html = "";
    if (rotuloVazio) {
      html += '<option value="">' + escapar(rotuloVazio) + "</option>";
    }
    valores.forEach(function (nome) {
      html += '<option value="' + escapar(nome) + '"' + (nome === atual ? " selected" : "") + ">" + escapar(nome) + "</option>";
    });
    return html;
  }

  function pintarStatus(select) {
    if (!select) return;
    select.className = "gestor-status gestor-status-" + classeStatus(select.value);
  }

  function gravarCampoLocal(id, campo, valor) {
    orcamentosCarregados.forEach(function (item) {
      if (String(item.id) === String(id)) item[campo] = valor;
    });
    renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), true);
  }

  function salvarAtendimento(select) {
    var id = select.getAttribute("data-id");
    var campo = select.hasAttribute("data-status") ? "status" : "vendedor";
    var valor = select.value;
    var anterior = select.dataset.anterior;
    var corpo = { id: id, atendimento: true };
    corpo[campo] = valor;
    if (campo === "status") pintarStatus(select);
    gravarCampoLocal(id, campo, valor);
    fetch("/api/orcamentos", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; }).then(function (publicado) {
        if (!resposta.ok || !publicado || !publicado.ok) throw new Error("gravar");
        if (campo === "status") registrarAcaoEquipe("Alterou Status do Orçamento");
        return publicado;
      });
    }).catch(function () {
      gravarCampoLocal(id, campo, anterior == null ? "" : anterior);
      window.alert("Não foi possível salvar o atendimento.");
    });
  }

  function meioEnvio(item) {
    var meio = String((item && item.meio_envio) || "");
    return meio === "WhatsApp" || meio === "E-mail" || meio === "Comando de Voz" ? meio : "-";
  }

  function infoExclusao(item) {
    var texto = "Excluído";
    if (item.excluidoEm) texto += " em " + dataVisivel(item.excluidoEm);
    if (item.excluidoPor === "cliente") texto += " pelo cliente";
    if (item.excluidoPor === "gestor") texto += " pelo gestor";
    return texto;
  }

  function linhaLixeira(item) {
    var id = escapar(item.id);
    var atendimento = statusAtendimento(item);
    return '<tr class="gestor-excluido">' +
      "<td>" + escapar(dataVisivel(item.data)) + "</td>" +
      "<td>" + escapar(item.nome) + "</td>" +
      "<td>" + escapar(documentoVisivel(String(item.documento || ""))) + "</td>" +
      "<td>" + escapar(item.telefone) + "</td>" +
      '<td class="num">' + moedaPainel(item.total) + "</td>" +
      '<td class="meio">' + escapar(meioEnvio(item)) + "</td>" +
      '<td class="status">' +
        '<span class="gestor-status-badge gestor-status-excluido" title="Atendimento: ' + escapar(atendimento) + '">Excluído</span>' +
      "</td>" +
      '<td class="vendedor excluido-info">' + escapar(vendedorAtual(item) || "-") + "</td>" +
      '<td class="acoes"><div class="gestor-acoes">' +
        '<button type="button" data-ver-orcamento="' + id + '" aria-label="Visualizar" title="Visualizar">' + iconeAcao("olho") + "</button>" +
        '<button type="button" data-restaurar-orcamento="' + id + '" title="' + escapar(infoExclusao(item)) + '">' + iconeAcao("desfazer") + "Restaurar</button>" +
      "</div></td>" +
    "</tr>";
  }

  function renderOrcamentos(lista, concluida) {
    if (!listaGestor) return;
    orcamentosAtuais = lista;
    if (vazioGestor) vazioGestor.hidden = !concluida || lista.length > 0;
    listaGestor.innerHTML = lista.map(function (item) {
      if (modoLixeira) return linhaLixeira(item);
      var id = escapar(item.id);
      return "<tr>" +
        "<td>" + escapar(dataVisivel(item.data)) + "</td>" +
        "<td>" + escapar(item.nome) + "</td>" +
        "<td>" + escapar(documentoVisivel(String(item.documento || ""))) + "</td>" +
        "<td>" + escapar(item.telefone) + "</td>" +
        '<td class="num">' + moedaPainel(item.total) + "</td>" +
        '<td class="meio">' + escapar(meioEnvio(item)) + "</td>" +
        '<td class="status"><select class="gestor-status gestor-status-' + classeStatus(statusAtual(item)) + '" data-status data-id="' + id + '" data-anterior="' + escapar(statusAtual(item)) + '" aria-label="Status">' +
          opcoesSelect(STATUS_ORCAMENTO, statusAtual(item)) +
        "</select></td>" +
        '<td class="vendedor"><select class="gestor-vendedor" data-vendedor data-id="' + id + '" data-anterior="' + escapar(vendedorAtual(item)) + '" aria-label="Vendedor">' +
          opcoesSelect(VENDEDORES, vendedorAtual(item), "Selecione...") +
        "</select></td>" +
        '<td class="acoes"><div class="gestor-acoes">' +
          '<button type="button" data-ver-orcamento="' + id + '" aria-label="Visualizar" title="Visualizar">' + iconeAcao("olho") + "</button>" +
          '<button type="button" data-imprimir-orcamento="' + id + '" aria-label="Imprimir" title="Imprimir">' + iconeAcao("impressora") + "</button>" +
          '<button type="button" data-excluir-orcamento="' + id + '" aria-label="Excluir" title="Excluir">' + iconeAcao("lixeira") + "</button>" +
        "</div></td>" +
      "</tr>";
    }).join("");
  }

  var consultaPainel = 0;
  var modoLixeira = false;
  var idsExcluidos = {};
  var idsRestaurados = {};
  var tituloOrcamentos = document.querySelector("[data-titulo-orcamentos]");

  function idsOcultos() {
    return modoLixeira ? idsRestaurados : idsExcluidos;
  }

  function atualizarTituloOrcamentos() {
    if (tituloOrcamentos) tituloOrcamentos.textContent = "Orçamentos Recebidos";
  }

  function sincronizarModoLixeiraDoFiltro() {
    /* Excluídos só via filtro Status — sem botão de atalho para a lixeira. */
    var querLixeira = !!(campoFiltroStatus && filtroStatusEhExcluido(campoFiltroStatus.value));
    var mudou = querLixeira !== modoLixeira;
    modoLixeira = querLixeira;
    if (mudou) {
      idsExcluidos = {};
      idsRestaurados = {};
    }
    atualizarTituloOrcamentos();
    return mudou;
  }

  function aplicarFiltrosLocais(lista) {
    var filtros = lerFiltrosBusca();
    var status = filtros.status;
    var vendedor = filtros.vendedor;
    var ocultos = idsOcultos();
    var filtrarStatus = !modoLixeira && status && !filtroStatusEhExcluido(status);
    return (lista || []).filter(function (item) {
      if (ocultos[String(item.id)]) return false;
      if (filtrarStatus && statusAtendimento(item) !== status) return false;
      if (vendedor && vendedorAtual(item) !== vendedor) return false;
      return true;
    });
  }

  function carregarOrcamentos() {
    if (!listaGestor) return;
    if (vazioGestor) vazioGestor.hidden = true;
    sincronizarModoLixeiraDoFiltro();
    var pedido = ++consultaPainel;
    var filtros = lerFiltrosBusca();
    /* Status=Excluído consulta a lixeira; demais filtros (data/CPF/vendedor) continuam valendo. */
    var url = "/api/orcamentos?dataInicio=" + encodeURIComponent(filtros.dataInicio) +
      "&dataFim=" + encodeURIComponent(filtros.dataFim) +
      "&cpf_cnpj=" + encodeURIComponent(filtros.cpf_cnpj) +
      (modoLixeira ? "&lixeira=1&excluidos=1" : "");
    console.log("[orcamentos] busca", filtros, { modoLixeira: modoLixeira }, url);
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        mostrarAvisoBusca("Sessão expirada. Entre novamente na área restrita.");
        console.log("[orcamentos] erro", 401);
        window.location.replace("/");
        return null;
      }
      return resposta.json().then(function (corpo) {
        return { status: resposta.status, ok: resposta.ok, corpo: corpo };
      }).catch(function () {
        return { status: resposta.status, ok: false, corpo: null };
      });
    }).then(function (resultado) {
      if (!resultado || pedido !== consultaPainel) return;
      var corpo = resultado.corpo;
      console.log("[orcamentos] resposta", resultado.status, corpo);
      if (!resultado.ok || !corpo || corpo.ok === false) {
        orcamentosCarregados = [];
        cargaConcluida = false;
        renderOrcamentos([], false);
        mostrarAvisoBusca(corpo && corpo.erro ? corpo.erro : "Erro ao consultar os orçamentos.");
        return;
      }
      var lista = Array.isArray(corpo.orcamentos) ? corpo.orcamentos : [];
      var ocultos = idsOcultos();
      lista = lista.filter(function (atual) {
        if (ocultos[String(atual.id)]) return false;
        /* Ativos: só não excluídos e sem A Enviar. Lixeira: API já devolve excluídos. */
        if (modoLixeira) return itemExcluido(atual);
        if (itemExcluido(atual)) return false;
        return statusAtendimento(atual) !== "A Enviar";
      });
      orcamentosCarregados = lista;
      cargaConcluida = true;
      var visiveis = aplicarFiltrosLocais(orcamentosCarregados);
      renderOrcamentos(visiveis, true);
      mostrarAvisoBusca("");
      console.log("[orcamentos] lista", lista.length, "visiveis", visiveis.length);
    }).catch(function (erro) {
      if (pedido !== consultaPainel) return;
      console.log("[orcamentos] erro", erro);
      orcamentosCarregados = [];
      cargaConcluida = false;
      renderOrcamentos([], false);
      mostrarAvisoBusca("Erro ao consultar os orçamentos.");
    });
  }

  var formFiltros = document.querySelector("[data-gestor-filtros]");
  if (formFiltros) {
    formFiltros.addEventListener("submit", function (event) {
      event.preventDefault();
      sincronizarModoLixeiraDoFiltro();
      carregarOrcamentos();
    });
    formFiltros.addEventListener("change", function (event) {
      var alvo = event.target;
      if (!alvo) return;
      if (alvo.hasAttribute("data-gestor-status")) {
        sincronizarModoLixeiraDoFiltro();
        fecharDetalhe();
        orcamentosCarregados = [];
        renderOrcamentos([], false);
        carregarOrcamentos();
        return;
      }
      if (alvo.hasAttribute("data-gestor-vendedor")) {
        renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), cargaConcluida);
        return;
      }
      if (alvo.hasAttribute("data-gestor-data-inicio") || alvo.hasAttribute("data-gestor-data-fim") || alvo.hasAttribute("data-gestor-documento")) {
        carregarOrcamentos();
      }
    });
  }
  if (campoDocumento) {
    var documentoTimer = 0;
    campoDocumento.addEventListener("input", function () {
      campoDocumento.value = digitosDocumento(campoDocumento.value);
      window.clearTimeout(documentoTimer);
      documentoTimer = window.setTimeout(carregarOrcamentos, 250);
    });
  }
  if (listaGestor) {
    listaGestor.addEventListener("focusin", function (event) {
      var select = event.target.closest("select[data-status], select[data-vendedor]");
      if (select) select.dataset.anterior = select.value;
    });
    listaGestor.addEventListener("change", function (event) {
      var select = event.target.closest("select[data-status], select[data-vendedor]");
      if (select) salvarAtendimento(select);
    });
    listaGestor.addEventListener("click", function (event) {
      var ver = event.target.closest("[data-ver-orcamento]");
      if (ver) {
        abrirDetalhe(acharOrcamento(ver.getAttribute("data-ver-orcamento")));
        return;
      }
      var imprimir = event.target.closest("[data-imprimir-orcamento]");
      if (imprimir) {
        imprimirOrcamento(acharOrcamento(imprimir.getAttribute("data-imprimir-orcamento")));
        return;
      }
      var excluir = event.target.closest("[data-excluir-orcamento]");
      if (excluir) {
        excluirOrcamento(acharOrcamento(excluir.getAttribute("data-excluir-orcamento")));
        return;
      }
      var restaurar = event.target.closest("[data-restaurar-orcamento]");
      if (restaurar) restaurarOrcamento(acharOrcamento(restaurar.getAttribute("data-restaurar-orcamento")));
    });
  }

  function alterarOrcamento(item, requisicao, ocultosAqui, ocultosLa, erro) {
    fetch(requisicao.url, {
      method: requisicao.method,
      headers: requisicao.body ? { "Content-Type": "application/json" } : undefined,
      body: requisicao.body,
      cache: "no-store",
      credentials: "same-origin"
    }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; }).then(function (corpo) {
        if (!resposta.ok || !corpo || !corpo.ok) throw new Error(erro);
        return corpo;
      });
    }).then(function (corpo) {
      if (!corpo) return;
      fecharDetalhe();
      ocultosAqui[String(item.id)] = true;
      delete ocultosLa[String(item.id)];
      orcamentosCarregados = orcamentosCarregados.filter(function (atual) {
        return String(atual.id) !== String(item.id);
      });
      renderOrcamentos(aplicarFiltrosLocais(orcamentosCarregados), true);
      carregarOrcamentos();
    }).catch(function () {
      window.alert(erro);
    });
  }

  function excluirOrcamento(item) {
    if (!item || !item.id) return;
    var nome = String(item.nome || "este cliente");
    if (!window.confirm("Mover o orçamento de " + nome + " para a Lixeira?\nEle deixa de contar no Painel Comercial e pode ser restaurado depois.")) return;
    registrarAcaoEquipe("Excluiu Orçamento");
    alterarOrcamento(item, {
      url: "/api/orcamentos?id=" + encodeURIComponent(item.id),
      method: "DELETE"
    }, idsExcluidos, idsRestaurados, "Não foi possível excluir o orçamento.");
  }

  function restaurarOrcamento(item) {
    if (!item || !item.id) return;
    registrarAcaoEquipe("Restaurou Orçamento");
    alterarOrcamento(item, {
      url: "/api/orcamentos",
      method: "POST",
      body: JSON.stringify({ restaurar: true, id: item.id })
    }, idsRestaurados, idsExcluidos, "Não foi possível restaurar o orçamento.");
  }
  var dashDias = 30;
  var dashPedido = 0;
  var trafegoDias = 30;
  var trafegoPedido = 0;
  var trafegoCabecalho = null;
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function diasAtras(dias) {
    var data = new Date(dataHojeIso() + "T12:00:00Z");
    data.setUTCDate(data.getUTCDate() - (dias - 1));
    return data.toISOString().slice(0, 10);
  }

  function rotuloPeriodo(chave, agrupamento) {
    var partes = String(chave).split("-");
    if (agrupamento === "mes") return MESES[Number(partes[1]) - 1] + "/" + partes[0].slice(2);
    return partes[2] + "/" + partes[1];
  }

  function pct(valor) {
    return String(Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })) + "%";
  }

  function htmlDivisao(partes) {
    var barra = partes.map(function (parte) {
      return '<span class="' + parte.classe + '" style="width:' + Number(parte.dado.pct || 0) + '%"></span>';
    }).join("");
    var totalQtd = 0;
    var totalValor = 0;
    var linhas = partes.map(function (parte) {
      var qtd = Number(parte.dado.qtd || 0);
      var valor = Number(parte.dado.valor || 0);
      totalQtd += qtd;
      totalValor += valor;
      return '<tr><th scope="row"><i class="' + parte.classe + '"></i>' +
        '<span class="dash-nome-longo">' + escapar(parte.nome) + '</span>' +
        '<span class="dash-nome-curto">' + escapar(parte.curto) + '</span></th>' +
        '<td>' + qtd + '</td><td>' + moedaPainel(valor) + '</td><td>' + pct(parte.dado.pct) + '</td></tr>';
    }).join("");
    return '<div class="dash-divisao" role="img" aria-label="' + escapar(partes.map(function (parte) {
      return parte.nome + " " + pct(parte.dado.pct);
    }).join(", ")) + '">' + barra + '</div>' +
      '<div class="dash-tabela-caixa"><table class="dash-tabela">' +
      '<thead><tr><th scope="col">Categoria</th><th scope="col">Qtd.</th><th scope="col">Valor (R$)</th><th scope="col">%</th></tr></thead>' +
      '<tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><th scope="row">Total:</th><td>' + totalQtd + '</td><td>' + moedaPainel(totalValor) + '</td>' +
      '<td>' + (totalQtd ? "100%" : "0%") + '</td></tr></tfoot></table></div>';
  }

  function htmlSerie(serie, agrupamento) {
    if (!serie.length) return '<p class="dash-vazio">Sem orçamentos no período.</p>';
    var maior = Math.max.apply(null, serie.map(function (ponto) { return ponto.total; }).concat([1]));
    var passo = Math.max(1, Math.ceil(serie.length / 8));
    return serie.map(function (ponto, indice) {
      var rotulo = rotuloPeriodo(ponto.periodo, agrupamento);
      var mostrar = indice % passo === 0 || indice === serie.length - 1;
      return '<div class="dash-coluna" title="' + escapar(rotulo + ": " + ponto.total + " orçamento(s)") + '">' +
        '<div class="dash-pilha" style="height:' + (ponto.total * 100 / maior) + '%">' +
        '<span class="dash-cor-gigavoz" style="flex-grow:' + ponto.gigavoz + '"></span>' +
        '<span class="dash-cor-tradicional" style="flex-grow:' + ponto.tradicional + '"></span>' +
        '</div><small>' + (mostrar ? escapar(rotulo) : "") + '</small></div>';
    }).join("");
  }

  function renderDashboard(dados) {
    var total = document.querySelector("[data-dash-total]");
    var periodo = document.querySelector("[data-dash-periodo-texto]");
    var serie = document.querySelector("[data-dash-serie]");
    var metodo = document.querySelector("[data-dash-metodo]");
    var pessoa = document.querySelector("[data-dash-pessoa]");
    var nota = document.querySelector("[data-dash-nota]");
    if (total) total.textContent = String(dados.total || 0);
    if (periodo) {
      periodo.textContent = dados.inicio
        ? (dados.inicio === dados.fim ? "em " + dataVisivel(dados.inicio) : "de " + dataVisivel(dados.inicio) + " a " + dataVisivel(dados.fim))
        : "orçamentos";
    }
    if (serie) {
      serie.classList.toggle("is-mensal", dados.agrupamento === "mes");
      serie.innerHTML = htmlSerie(dados.serie || [], dados.agrupamento);
    }
    if (metodo) {
      metodo.innerHTML = htmlDivisao([
        { classe: "dash-cor-tradicional", nome: "Catálogo Tradicional", curto: "Tradicional", dado: dados.metodo.tradicional },
        { classe: "dash-cor-gigavoz", nome: "GigaVoz", curto: "GigaVoz", dado: dados.metodo.gigavoz }
      ]);
    }
    if (pessoa) {
      pessoa.innerHTML = htmlDivisao([
        { classe: "dash-cor-pf", nome: "Pessoa Física (CPF)", curto: "Física (CPF)", dado: dados.pessoa.pf },
        { classe: "dash-cor-pj", nome: "Pessoa Jurídica (CNPJ)", curto: "Jurídica (CNPJ)", dado: dados.pessoa.pj }
      ]);
    }
    if (nota) {
      var semValor = Number(dados.semValor || 0);
      nota.hidden = !semValor;
      nota.textContent = semValor
        ? semValor + " orçamento(s) antigo(s) do período já saíram do painel e não têm valor registrado: entram na quantidade, mas não no Valor."
        : "";
    }
  }

  function avisoDashboard(texto) {
    var aviso = document.querySelector("[data-dash-aviso]");
    if (!aviso) return;
    aviso.hidden = !texto;
    aviso.textContent = texto || "";
  }

  function carregarDashboard() {
    /* Volume/gráficos vêm de /api/dashboard-estatisticas com a mesma regra de
       Orçamentos Recebidos: ignora lixeira, órfãos e status "A Enviar". */
    var grade = document.querySelector("[data-dash-grid]");
    if (!grade) return;
    var pedido = ++dashPedido;
    var url = "/api/dashboard-estatisticas";
    if (dashDias > 0) {
      url += "?dataInicio=" + encodeURIComponent(diasAtras(dashDias)) + "&dataFim=" + encodeURIComponent(dataHojeIso());
    }
    grade.setAttribute("aria-busy", "true");
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      if (pedido !== dashPedido) return;
      grade.setAttribute("aria-busy", "false");
      if (!corpo || !corpo.ok) {
        avisoDashboard(corpo && corpo.erro ? corpo.erro : "Erro ao carregar o painel comercial.");
        return;
      }
      avisoDashboard("");
      renderDashboard(corpo);
    }).catch(function () {
      if (pedido !== dashPedido) return;
      grade.setAttribute("aria-busy", "false");
      avisoDashboard("Erro ao carregar o painel comercial.");
    });
  }

  function horarioAcesso(valor) {
    var partes = String(valor || "").split(" ");
    var data = partes[0].split("-");
    return data.length === 3 ? data[2] + "/" + data[1] + "/" + data[0] + " " + (partes[1] || "") : String(valor || "");
  }

  function digitosTrafego(valor) {
    return String(valor || "").replace(/\D/g, "");
  }

  function formatarTelefoneTrafego(valor) {
    var d = digitosTrafego(valor);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "";
  }

  function formatarCepTrafego(valor) {
    var d = digitosTrafego(valor);
    return d.length === 8 ? d.slice(0, 5) + "-" + d.slice(5) : "";
  }

  function linkWhatsAppTrafego(linha) {
    var d = digitosTrafego(linha.telefone);
    if (d.length < 10) return "";
    if (d.length <= 11) d = "55" + d;
    var nome = String(linha.nome || "").trim() || "cliente";
    var mensagem = "Olá " + nome + ", vimos que você iniciou um orçamento no site da GigaEletro. Podemos ajudar?";
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(mensagem);
  }

  function leadContactado(linha) {
    return linha && (linha.contactado === true || linha.contactado === 1 || linha.contactado === "1" || linha.contactado === "true");
  }

  function diaDoHorarioTrafego(valor) {
    var partes = String(valor || "").trim().split(" ");
    return partes[0] && /^\d{4}-\d{2}-\d{2}$/.test(partes[0]) ? partes[0] : "";
  }

  function htmlBotaoWhatsAppTrafego(linha, whats) {
    if (!whats) return "—";
    var id = String(linha.id_visitante || linha.id_sessao || "").trim();
    var contactado = leadContactado(linha);
    return '<a class="trafego-whatsapp' + (contactado ? " is-contactado" : "") +
      '" href="' + escapar(whats) + '" target="_blank" rel="noopener noreferrer"' +
      ' data-trafego-contactar="' + escapar(id) + '"' +
      ' data-trafego-dia="' + escapar(diaDoHorarioTrafego(linha.data_hora)) + '"' +
      ' data-contactado="' + (contactado ? "1" : "0") + '">' +
      (contactado ? "Já contactado" : "WhatsApp") + "</a>";
  }

  function marcarBotaoContactado(botao) {
    if (!botao) return;
    botao.classList.add("is-contactado");
    botao.setAttribute("data-contactado", "1");
    botao.textContent = "Já contactado";
  }

  function salvarContactadoTrafego(botao) {
    var id = botao && botao.getAttribute("data-trafego-contactar");
    if (!id || botao.getAttribute("data-contactado") === "1") return;
    marcarBotaoContactado(botao);
    registrarAcaoEquipe("Contactou Lead no WhatsApp");
    fetch("/api/admin/metricas-acesso", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acao: "marcar_contactado",
        id: id,
        dia: botao.getAttribute("data-trafego-dia") || ""
      })
    }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).catch(function () {});
  }

  function ligarAcoesTrafego() {
    var lista = document.querySelector("[data-trafego-lista]");
    if (!lista || lista.dataset.trafegoAcao) return;
    lista.dataset.trafegoAcao = "1";
    lista.addEventListener("click", function (evento) {
      var botao = evento.target.closest("[data-trafego-contactar]");
      if (!botao || !lista.contains(botao)) return;
      /* O link abre o WhatsApp; se ainda não estava marcado, grava contactado em segundo plano. */
      if (botao.getAttribute("data-contactado") === "1") return;
      salvarContactadoTrafego(botao);
    });
  }

  function renderTrafego(dados) {
    var lista = document.querySelector("[data-trafego-lista]");
    var vazio = document.querySelector("[data-trafego-vazio]");
    var registros = dados.registros || [];
    var dias = Number(dados.periodoDias || 0);
    var total = Number(dados.totalAcessos || 0);
    var unicosServidor = Number(dados.sessoesUnicas || 0);
    var unicos = Math.min(unicosServidor || registros.length, Math.max(total, registros.length));
    trafegoCabecalho = {
      unicos: String(unicos),
      periodo: dias === 1 ? "hoje" : (dias ? "nos últimos " + dias + " dias" : "em todo o período"),
      desativado: dados.armazenamento === "nenhum",
      cortado: total > registros.length ? registros.length : 0,
      texto: ""
    };
    trafegoCabecalho.texto = trafegoCabecalho.desativado
      ? "Contagem desativada: falta a variável REDIS_URL na Vercel."
      : "contato(s) sem orçamento enviado " + trafegoCabecalho.periodo +
        " · " + total + " registro(s)" +
        (trafegoCabecalho.cortado ? " · mostrando os " + registros.length + " mais recentes" : "");
    if (vazio) vazio.hidden = registros.length > 0;
    if (lista) {
      lista.innerHTML = registros.map(function (linha) {
        var dispositivo = linha.dispositivo === "Mobile" || linha.dispositivo === "Desktop" ? linha.dispositivo : "";
        var nome = String(linha.nome || "").trim();
        var telefone = formatarTelefoneTrafego(linha.telefone);
        var email = String(linha.email || "").trim();
        var cep = formatarCepTrafego(linha.cep);
        var whats = linkWhatsAppTrafego(linha);
        return '<tr data-sessao="' + escapar(linha.id_visitante || linha.id_sessao || "") +
          '" data-dispositivo="' + dispositivo + '">' +
          '<td class="trafego-col-horario">' + escapar(horarioAcesso(linha.data_hora)) + "</td>" +
          '<td class="trafego-col-cliente">' + escapar(nome || "—") + "</td>" +
          '<td class="trafego-col-contato">' + escapar(telefone || "—") + "</td>" +
          '<td class="trafego-col-email">' + escapar(email || "—") + "</td>" +
          '<td class="trafego-col-cep">' + escapar(cep || "—") + "</td>" +
          '<td class="trafego-col-dispositivo">' +
            (dispositivo ? '<span class="trafego-tag trafego-tag-' + dispositivo.toLowerCase() + '">' + dispositivo + "</span>" : "—") +
          "</td>" +
          '<td class="trafego-col-acao trafego-acao">' + htmlBotaoWhatsAppTrafego(linha, whats) + "</td></tr>";
      }).join("");
    }
    ligarAcoesTrafego();
    aplicarFiltroTrafego();
  }

  function valorFiltro(seletor) {
    var campo = document.querySelector(seletor);
    return campo ? campo.value.normalize("NFC") : "";
  }

  function aplicarFiltroTrafego() {
    var resultado = document.querySelector("[data-trafego-filtro-resultado]");
    var vazio = document.querySelector("[data-trafego-vazio]");
    var divisao = document.querySelector("[data-trafego-divisao]");
    var linhas = document.querySelectorAll("[data-trafego-lista] tr");
    var dispositivo = valorFiltro("[data-trafego-dispositivo]");
    var escolhido = dispositivo || "";
    var visiveis = 0;
    var sessoes = {};
    var contagem = { Desktop: 0, Mobile: 0 };
    linhas.forEach(function (linha) {
      var mostrar = !dispositivo || linha.getAttribute("data-dispositivo") === dispositivo;
      linha.hidden = !mostrar;
      if (!mostrar) return;
      visiveis += 1;
      if (linha.getAttribute("data-dispositivo")) contagem[linha.getAttribute("data-dispositivo")] += 1;
      if (linha.getAttribute("data-sessao")) sessoes[linha.getAttribute("data-sessao")] = true;
    });
    if (divisao) {
      divisao.hidden = visiveis === 0;
      divisao.innerHTML = '<span class="trafego-tag trafego-tag-desktop">Desktop: ' + contagem.Desktop + "</span>" +
        '<span class="trafego-tag trafego-tag-mobile">Mobile: ' + contagem.Mobile + "</span>";
    }
    var unicosFiltro = Object.keys(sessoes).length;
    if (vazio) vazio.hidden = visiveis > 0;
    if (resultado) {
      resultado.textContent = escolhido
        ? escolhido + ": " + visiveis + " contato(s) na lista"
        : "";
    }
    var unicos = document.querySelector("[data-trafego-unicos]");
    var resumo = document.querySelector("[data-trafego-resumo]");
    if (!trafegoCabecalho) return;
    var filtrado = escolhido && !trafegoCabecalho.desativado;
    if (unicos) unicos.textContent = filtrado ? String(unicosFiltro) : trafegoCabecalho.unicos;
    if (resumo) {
      resumo.textContent = filtrado
        ? "contato(s) sem orçamento · " + escolhido + " " + trafegoCabecalho.periodo + " · " + visiveis + " registro(s)" +
          (trafegoCabecalho.cortado ? " entre os " + trafegoCabecalho.cortado + " mais recentes" : "")
        : trafegoCabecalho.texto;
    }
  }

  function carregarTrafego() {
    var grade = document.querySelector("[data-trafego]");
    var aviso = document.querySelector("[data-trafego-aviso]");
    if (!grade) return;
    var pedido = ++trafegoPedido;
    grade.setAttribute("aria-busy", "true");
    fetch("/api/admin/metricas-acesso?dias=" + encodeURIComponent(trafegoDias), { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      if (pedido !== trafegoPedido) return;
      grade.setAttribute("aria-busy", "false");
      var erro = !corpo || !corpo.ok;
      if (aviso) {
        aviso.hidden = !erro;
        aviso.textContent = erro ? (corpo && corpo.erro ? corpo.erro : "Erro ao carregar o tráfego do site.") : "";
      }
      if (!erro) renderTrafego(corpo);
    }).catch(function () {
      if (pedido !== trafegoPedido) return;
      grade.setAttribute("aria-busy", "false");
      if (aviso) {
        aviso.hidden = false;
        aviso.textContent = "Erro ao carregar o tráfego do site.";
      }
    });
  }

  document.querySelectorAll("[data-trafego-dispositivo]").forEach(function (filtro) {
    filtro.addEventListener("change", aplicarFiltroTrafego);
  });

  var FALHA_LIMPAR_TRAFEGO = "Não foi possível limpar o histórico de tráfego.";
  function avisoTrafego(texto) {
    var aviso = document.querySelector("[data-trafego-aviso]");
    if (!aviso) return;
    aviso.hidden = !texto;
    aviso.textContent = texto || "";
  }

  var limparTrafego = document.querySelector("[data-trafego-limpar]");
  if (limparTrafego) {
    limparTrafego.addEventListener("click", function () {
      if (!window.confirm("Limpar todo o histórico do Rastreamento de Tráfego?\nTodos os contatos sem orçamento registrados até agora serão apagados. Esta ação não pode ser desfeita.")) return;
      limparTrafego.disabled = true;
      fetch("/api/admin/metricas-acesso", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "limpar_trafego" })
      }).then(function (resposta) {
        if (resposta.status === 401) {
          window.location.replace("/");
          return null;
        }
        return resposta.json().catch(function () { return null; }).then(function (corpo) {
          if (!corpo || !corpo.ok) {
            avisoTrafego(corpo && corpo.erro ? corpo.erro : FALHA_LIMPAR_TRAFEGO);
            return;
          }
          avisoTrafego("");
          registrarAcaoEquipe("Limpou Histórico de Tráfego");
          carregarTrafego();
        });
      }).catch(function () {
        avisoTrafego(FALHA_LIMPAR_TRAFEGO);
      }).finally(function () {
        limparTrafego.disabled = false;
      });
    });
  }

  var equipePedido = 0;
  var equipeDados = { funcionarios: [], resumo: [], logs: [] };
  var equipeSelecionadoId = "";
  var equipeModalNome = "";
  var equipeModalInicio = "";
  var equipeModalFim = "";
  var formEquipe = document.querySelector("[data-equipe-cadastro]");
  var campoEquipeNome = document.querySelector("[data-equipe-nome]");
  var botaoEquipeNovo = document.querySelector("[data-equipe-novo]");
  var botaoEquipeAlterar = document.querySelector("[data-equipe-alterar]");
  var botaoEquipeExcluir = document.querySelector("[data-equipe-excluir]");
  var campoEquipeAcoesInicio = document.querySelector("[data-equipe-acoes-inicio]");
  var campoEquipeAcoesFim = document.querySelector("[data-equipe-acoes-fim]");
  var botaoEquipeAcoesFiltrar = document.querySelector("[data-equipe-acoes-filtrar]");
  var botaoEquipeAcoesLimparFiltro = document.querySelector("[data-equipe-acoes-limpar-filtro]");
  var botaoEquipeAcoesExcluir = document.querySelector("[data-equipe-acoes-excluir-registros]");

  function avisoEquipeCadastro(texto) {
    var aviso = document.querySelector("[data-equipe-cadastro-aviso]");
    if (!aviso) return;
    aviso.hidden = !texto;
    aviso.textContent = texto || "";
  }

  function atualizarBotoesEquipe() {
    var temSelecao = !!equipeSelecionadoId;
    if (botaoEquipeAlterar) botaoEquipeAlterar.disabled = !temSelecao;
    if (botaoEquipeExcluir) botaoEquipeExcluir.disabled = !temSelecao;
  }

  function limparSelecaoEquipe(manterNome) {
    equipeSelecionadoId = "";
    if (campoEquipeNome && !manterNome) campoEquipeNome.value = "";
    document.querySelectorAll("[data-equipe-linha].is-selecionado").forEach(function (linha) {
      linha.classList.remove("is-selecionado");
    });
    atualizarBotoesEquipe();
  }

  function selecionarFuncionarioEquipe(id, nome) {
    equipeSelecionadoId = String(id || "");
    if (campoEquipeNome) {
      campoEquipeNome.value = nome || "";
      campoEquipeNome.focus();
      campoEquipeNome.select();
    }
    document.querySelectorAll("[data-equipe-linha]").forEach(function (linha) {
      linha.classList.toggle("is-selecionado", linha.getAttribute("data-equipe-linha") === equipeSelecionadoId);
    });
    atualizarBotoesEquipe();
    avisoEquipeCadastro("");
  }

  function postEquipeFuncionario(corpo) {
    return fetch("/api/equipe/funcionarios", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo || {})
    }).then(function (resposta) {
      return resposta.json().catch(function () { return null; }).then(function (dados) {
        if (!resposta.ok || !dados || !dados.ok) {
          throw new Error((dados && dados.erro) || "Não foi possível concluir a operação.");
        }
        return dados;
      });
    });
  }

  function renderEquipeCadastro(funcionarios) {
    var lista = document.querySelector("[data-equipe-lista]");
    if (!lista) return;
    var itens = (funcionarios || []).filter(function (item) { return item.id !== "admin"; });
    if (equipeSelecionadoId && !itens.some(function (item) { return item.id === equipeSelecionadoId; })) {
      limparSelecaoEquipe();
    }
    lista.innerHTML = itens.length ? itens.map(function (item) {
      var selecionado = item.id === equipeSelecionadoId ? " is-selecionado" : "";
      return '<tr class="' + selecionado.trim() + '" data-equipe-linha="' + escapar(item.id) + '" data-nome="' + escapar(item.nome) + '">' +
        "<td>" + escapar(item.nome) + "</td>" +
        "<td>" + (item.ativo ? '<span class="trafego-tag trafego-tag-externo">Ativo</span>' : '<span class="trafego-tag">Inativo</span>') + "</td>" +
        '<td class="equipe-cel-acao"><button class="btn btn-line equipe-toggle" type="button" data-equipe-toggle="' + escapar(item.id) + '" data-ativo="' + (item.ativo ? "1" : "0") + '">' +
          (item.ativo ? "Desativar" : "Ativar") + "</button></td></tr>";
    }).join("") : '<tr><td colspan="3">Nenhum funcionário cadastrado além de Administrador.</td></tr>';
    atualizarBotoesEquipe();
  }

  function logsAcoesFuncionario(nome) {
    var alvo = String(nome || "").normalize("NFC");
    return (equipeDados.logs || []).filter(function (item) {
      return String(item.funcionario || "").normalize("NFC") === alvo
        && String(item.acao || "") !== "Acessou a Área Restrita";
    });
  }

  function diaDoHorarioEquipe(horario) {
    var match = String(horario || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return "";
    return match[3] + "-" + match[2] + "-" + match[1];
  }

  function logsAcoesFiltrados(nome, inicio, fim) {
    return logsAcoesFuncionario(nome).filter(function (item) {
      var dia = diaDoHorarioEquipe(item.horario);
      if (inicio && (!dia || dia < inicio)) return false;
      if (fim && (!dia || dia > fim)) return false;
      return true;
    });
  }

  function textoPeriodoEquipe(inicio, fim) {
    function br(iso) {
      var partes = String(iso || "").split("-");
      if (partes.length !== 3) return "";
      return partes[2] + "/" + partes[1] + "/" + partes[0];
    }
    if (inicio && fim) return "de " + br(inicio) + " a " + br(fim);
    if (inicio) return "a partir de " + br(inicio);
    if (fim) return "até " + br(fim);
    return "todo o histórico";
  }

  var tooltipEquipe = document.querySelector("[data-equipe-acoes-tooltip]");
  var modalEquipeAcoes = document.querySelector("[data-equipe-acoes-modal]");
  var modalEquipeTitulo = document.querySelector("[data-equipe-acoes-titulo]");
  var modalEquipeCorpo = document.querySelector("[data-equipe-acoes-corpo]");
  var tooltipEquipeTimer = 0;

  function esconderTooltipEquipe() {
    if (tooltipEquipeTimer) {
      window.clearTimeout(tooltipEquipeTimer);
      tooltipEquipeTimer = 0;
    }
    if (tooltipEquipe) tooltipEquipe.hidden = true;
  }

  function mostrarTooltipEquipe(ancora, nome) {
    if (!tooltipEquipe || !ancora) return;
    var logs = logsAcoesFuncionario(nome).slice(0, 5);
    if (!logs.length) {
      esconderTooltipEquipe();
      return;
    }
    tooltipEquipe.innerHTML = "<strong>Últimas ações</strong><ul>" + logs.map(function (item) {
      return "<li><span>" + escapar(item.horario) + "</span> " + escapar(item.acao) + "</li>";
    }).join("") + "</ul>";
    tooltipEquipe.hidden = false;
    var ret = ancora.getBoundingClientRect();
    var largura = tooltipEquipe.offsetWidth || 280;
    var esquerda = Math.min(window.innerWidth - largura - 12, Math.max(8, ret.left + ret.width / 2 - largura / 2));
    var topo = ret.bottom + 8;
    if (topo + tooltipEquipe.offsetHeight > window.innerHeight - 8) {
      topo = Math.max(8, ret.top - tooltipEquipe.offsetHeight - 8);
    }
    tooltipEquipe.style.left = esquerda + "px";
    tooltipEquipe.style.top = topo + "px";
  }

  function atualizarBotaoExcluirAcoes(quantidade) {
    if (!botaoEquipeAcoesExcluir) return;
    botaoEquipeAcoesExcluir.disabled = !(quantidade > 0);
  }

  function renderModalEquipeAcoes() {
    if (!modalEquipeCorpo) return;
    var logs = logsAcoesFiltrados(equipeModalNome, equipeModalInicio, equipeModalFim);
    atualizarBotaoExcluirAcoes(logs.length);
    modalEquipeCorpo.innerHTML = logs.length
      ? '<div class="equipe-acoes-modal-scroll"><table class="gestor-tabela equipe-tabela equipe-acoes-tabela"><thead><tr><th>Horário Exato</th><th>Opção / Ação Executada</th><th>Dispositivo</th></tr></thead><tbody>' +
        logs.map(function (item) {
          return "<tr><td>" + escapar(item.horario) + "</td><td>" + escapar(item.acao) + "</td><td>" + escapar(item.dispositivo || "—") + "</td></tr>";
        }).join("") +
        "</tbody></table></div>"
      : '<p class="equipe-acoes-vazio">Nenhuma ação encontrada para o período selecionado.</p>';
  }

  function fecharModalEquipeAcoes() {
    esconderTooltipEquipe();
    equipeModalNome = "";
    equipeModalInicio = "";
    equipeModalFim = "";
    if (campoEquipeAcoesInicio) campoEquipeAcoesInicio.value = "";
    if (campoEquipeAcoesFim) campoEquipeAcoesFim.value = "";
    atualizarBotaoExcluirAcoes(0);
    if (modalEquipeAcoes) {
      modalEquipeAcoes.hidden = true;
      modalEquipeAcoes.style.removeProperty("display");
    }
    if (modalEquipeCorpo) modalEquipeCorpo.innerHTML = "";
    document.querySelectorAll(".equipe-acoes-overlay").forEach(function (el) {
      el.hidden = true;
      el.style.removeProperty("display");
    });
  }

  function abrirModalEquipeAcoes(nome) {
    if (!modalEquipeAcoes || !modalEquipeCorpo) return;
    esconderTooltipEquipe();
    equipeModalNome = String(nome || "");
    equipeModalInicio = "";
    equipeModalFim = "";
    if (campoEquipeAcoesInicio) campoEquipeAcoesInicio.value = "";
    if (campoEquipeAcoesFim) campoEquipeAcoesFim.value = "";
    if (modalEquipeTitulo) modalEquipeTitulo.textContent = "Ações Executadas — " + equipeModalNome;
    renderModalEquipeAcoes();
    document.querySelectorAll(".equipe-acoes-overlay").forEach(function (el) {
      el.hidden = false;
      el.style.removeProperty("display");
    });
    modalEquipeAcoes.hidden = false;
    modalEquipeAcoes.style.removeProperty("display");
  }

  function cadastrarFuncionarioNovo() {
    var nome = String((campoEquipeNome && campoEquipeNome.value) || "").trim();
    if (!nome) {
      avisoEquipeCadastro("Informe o nome do funcionário.");
      if (campoEquipeNome) campoEquipeNome.focus();
      return;
    }
    avisoEquipeCadastro("");
    postEquipeFuncionario({ nome: nome }).then(function () {
      limparSelecaoEquipe();
      carregarAcessosEquipe();
      carregarFuncionariosLogin();
    }).catch(function (falha) {
      avisoEquipeCadastro(falha && falha.message ? falha.message : "Não foi possível cadastrar.");
    });
  }

  function acaoBotaoNovoEquipe() {
    if (equipeSelecionadoId) {
      limparSelecaoEquipe();
      avisoEquipeCadastro("");
      if (campoEquipeNome) campoEquipeNome.focus();
      return;
    }
    cadastrarFuncionarioNovo();
  }

  function renderEquipeResumo(resumo) {
    var lista = document.querySelector("[data-equipe-resumo]");
    if (!lista) return;
    lista.innerHTML = (resumo || []).map(function (item) {
      var nunca = item.ultimo_acesso === "Nunca acessou";
      var acoes = Number(item.acoes_executadas || 0);
      var celAcoes = acoes > 0
        ? '<td class="equipe-acoes-cel">' +
            '<button type="button" class="equipe-acoes-badge" data-equipe-acoes-nome="' + escapar(item.nome) + '" title="Ver ações executadas por ' + escapar(item.nome) + '">' +
              '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 3c-3.3 0-6 2.7-7.3 5C2 10.3 4.7 13 8 13s6-2.7 7.3-5C14 5.7 11.3 3 8 3zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>' +
              '<span>' + acoes + "</span></button></td>"
        : "<td>" + acoes + "</td>";
      return "<tr>" +
        "<td>" + escapar(item.nome) + "</td>" +
        "<td>" + escapar(item.status) + "</td>" +
        '<td class="' + (nunca ? "equipe-nunca" : "") + '">' + escapar(item.ultimo_acesso) + "</td>" +
        "<td>" + Number(item.total_acessos || 0) + "</td>" +
        celAcoes + "</tr>";
    }).join("") || '<tr><td colspan="5">Sem dados de engajamento.</td></tr>';
  }

  function carregarAcessosEquipe() {
    var pedido = ++equipePedido;
    fetch("/api/equipe/resumo", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json().catch(function () { return null; });
    }).then(function (corpo) {
      if (pedido !== equipePedido || !corpo || !corpo.ok) return;
      equipeDados = corpo;
      renderEquipeCadastro(corpo.funcionarios || []);
      renderEquipeResumo(corpo.resumo || []);
    }).catch(function () {});
  }

  if (formEquipe) {
    formEquipe.addEventListener("submit", function (evento) {
      evento.preventDefault();
      acaoBotaoNovoEquipe();
    });
  }

  if (botaoEquipeAlterar) {
    botaoEquipeAlterar.addEventListener("click", function () {
      if (!equipeSelecionadoId) return;
      var nome = String((campoEquipeNome && campoEquipeNome.value) || "").trim();
      if (!nome) {
        avisoEquipeCadastro("Informe o novo nome do funcionário.");
        return;
      }
      avisoEquipeCadastro("");
      postEquipeFuncionario({
        acao: "editar_funcionario",
        id: equipeSelecionadoId,
        nome: nome
      }).then(function (corpo) {
        var atualizado = corpo && corpo.funcionario ? corpo.funcionario : null;
        if (atualizado) selecionarFuncionarioEquipe(atualizado.id, atualizado.nome);
        carregarAcessosEquipe();
        carregarFuncionariosLogin();
      }).catch(function (falha) {
        avisoEquipeCadastro(falha && falha.message ? falha.message : "Não foi possível alterar.");
      });
    });
  }

  if (botaoEquipeExcluir) {
    botaoEquipeExcluir.addEventListener("click", function () {
      if (!equipeSelecionadoId) return;
      var nome = String((campoEquipeNome && campoEquipeNome.value) || "este funcionário").trim();
      if (!window.confirm("Excluir definitivamente o cadastro de " + nome + "?")) return;
      avisoEquipeCadastro("");
      postEquipeFuncionario({
        acao: "excluir_funcionario",
        id: equipeSelecionadoId
      }).then(function () {
        limparSelecaoEquipe();
        carregarAcessosEquipe();
        carregarFuncionariosLogin();
      }).catch(function (falha) {
        avisoEquipeCadastro(falha && falha.message ? falha.message : "Não foi possível excluir.");
      });
    });
  }

  if (botaoEquipeAcoesFiltrar) {
    botaoEquipeAcoesFiltrar.addEventListener("click", function () {
      equipeModalInicio = campoEquipeAcoesInicio ? String(campoEquipeAcoesInicio.value || "").trim() : "";
      equipeModalFim = campoEquipeAcoesFim ? String(campoEquipeAcoesFim.value || "").trim() : "";
      if (equipeModalInicio && equipeModalFim && equipeModalInicio > equipeModalFim) {
        window.alert("A data inicial não pode ser maior que a data final.");
        return;
      }
      renderModalEquipeAcoes();
    });
  }

  if (botaoEquipeAcoesLimparFiltro) {
    botaoEquipeAcoesLimparFiltro.addEventListener("click", function () {
      equipeModalInicio = "";
      equipeModalFim = "";
      if (campoEquipeAcoesInicio) campoEquipeAcoesInicio.value = "";
      if (campoEquipeAcoesFim) campoEquipeAcoesFim.value = "";
      renderModalEquipeAcoes();
    });
  }

  if (botaoEquipeAcoesExcluir) {
    botaoEquipeAcoesExcluir.addEventListener("click", function () {
      var logs = logsAcoesFiltrados(equipeModalNome, equipeModalInicio, equipeModalFim);
      if (!logs.length || !equipeModalNome) return;
      var periodo = textoPeriodoEquipe(equipeModalInicio, equipeModalFim);
      var mensagem = "Excluir " + logs.length + " registro(s) de ações de " + equipeModalNome +
        " (" + periodo + ")?\nEsta ação não pode ser desfeita.";
      if (!window.confirm(mensagem)) return;
      botaoEquipeAcoesExcluir.disabled = true;
      fetch("/api/equipe/resumo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "excluir_logs",
          funcionario: equipeModalNome,
          data_inicio: equipeModalInicio,
          data_fim: equipeModalFim
        })
      }).then(function (resposta) {
        return resposta.json().catch(function () { return null; }).then(function (corpo) {
          if (!resposta.ok || !corpo || !corpo.ok) {
            throw new Error((corpo && corpo.erro) || "Não foi possível excluir os registros.");
          }
          return corpo;
        });
      }).then(function (corpo) {
        equipeDados = corpo;
        renderEquipeCadastro(corpo.funcionarios || []);
        renderEquipeResumo(corpo.resumo || []);
        renderModalEquipeAcoes();
      }).catch(function (falha) {
        window.alert(falha && falha.message ? falha.message : "Não foi possível excluir os registros.");
        renderModalEquipeAcoes();
      });
    });
  }

  document.addEventListener("click", function (evento) {
    var badgeAcoes = evento.target.closest("[data-equipe-acoes-nome]");
    if (badgeAcoes) {
      evento.preventDefault();
      abrirModalEquipeAcoes(badgeAcoes.getAttribute("data-equipe-acoes-nome") || "");
      return;
    }
    if (evento.target.closest("[data-equipe-acoes-fechar]")) {
      fecharModalEquipeAcoes();
      return;
    }
    var botao = evento.target.closest("[data-equipe-toggle]");
    if (botao) {
      evento.stopPropagation();
      postEquipeFuncionario({
        acao: "alternar_funcionario",
        id: botao.getAttribute("data-equipe-toggle"),
        ativo: botao.getAttribute("data-ativo") !== "1"
      }).then(function () {
        carregarAcessosEquipe();
        carregarFuncionariosLogin();
      }).catch(function () {});
      return;
    }
    var linha = evento.target.closest("[data-equipe-linha]");
    if (!linha) return;
    selecionarFuncionarioEquipe(linha.getAttribute("data-equipe-linha"), linha.getAttribute("data-nome"));
  });

  document.addEventListener("mouseover", function (evento) {
    var badge = evento.target.closest("[data-equipe-acoes-nome]");
    if (!badge) return;
    if (tooltipEquipeTimer) window.clearTimeout(tooltipEquipeTimer);
    tooltipEquipeTimer = window.setTimeout(function () {
      mostrarTooltipEquipe(badge, badge.getAttribute("data-equipe-acoes-nome") || "");
    }, 120);
  });

  document.addEventListener("mouseout", function (evento) {
    var badge = evento.target.closest("[data-equipe-acoes-nome]");
    if (!badge) return;
    var destino = evento.relatedTarget;
    if (destino && (badge.contains(destino) || (tooltipEquipe && tooltipEquipe.contains(destino)))) return;
    esconderTooltipEquipe();
  });

  if (tooltipEquipe) {
    tooltipEquipe.addEventListener("mouseleave", esconderTooltipEquipe);
  }

  atualizarBotoesEquipe();

  document.querySelectorAll("[data-trafego-dias]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      trafegoDias = Number(botao.getAttribute("data-trafego-dias")) || 0;
      document.querySelectorAll("[data-trafego-dias]").forEach(function (outro) {
        outro.setAttribute("aria-pressed", outro === botao ? "true" : "false");
      });
      carregarTrafego();
    });
  });

  document.querySelectorAll("[data-dash-dias]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      dashDias = Number(botao.getAttribute("data-dash-dias")) || 0;
      document.querySelectorAll("[data-dash-dias]").forEach(function (outro) {
        outro.setAttribute("aria-pressed", outro === botao ? "true" : "false");
      });
      carregarDashboard();
    });
  });

  document.querySelectorAll("[data-fechar-detalhe]").forEach(function (botao) {
    botao.addEventListener("click", fecharDetalhe);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (modalEquipeAcoes && !modalEquipeAcoes.hidden) {
      fecharModalEquipeAcoes();
      return;
    }
    fecharDetalhe();
  });

  function prepararDrop(zona, campo, aoEscolher) {
    if (!zona || !campo) return;
    ["dragenter", "dragover"].forEach(function (tipo) {
      zona.addEventListener(tipo, function (event) {
        event.preventDefault();
        zona.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (tipo) {
      zona.addEventListener(tipo, function (event) {
        event.preventDefault();
        zona.classList.remove("is-over");
      });
    });
    zona.addEventListener("drop", function (event) {
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      var transferencia = new DataTransfer();
      transferencia.items.add(file);
      campo.files = transferencia.files;
      aoEscolher(file);
    });
    campo.addEventListener("change", function () {
      aoEscolher((campo.files && campo.files[0]) || null);
    });
  }
})();
