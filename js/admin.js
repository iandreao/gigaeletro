(function () {
  var SENHA_ADMIN = "GigaAdmin2026";
  var SESSAO = "gigaeletro-admin";

  var formSenha = document.querySelector("[data-admin-senha]");
  var painel = document.querySelector("[data-admin-arquivo]");
  var erro = document.querySelector("[data-admin-erro]");
  var status = document.querySelector("[data-admin-status]");
  var auditoria = document.querySelector("[data-auditoria]");
  var nomeArquivo = document.querySelector("[data-admin-arquivo-nome]");
  var processar = document.querySelector("[data-processar]");
  var input = document.querySelector("#planilha");
  var planilhaEscolhida = null;

  fetch("/api/sessao", { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
    return resposta.json();
  }).then(function (corpo) {
    if (!corpo || !corpo.ok) {
      window.location.replace("/");
      return;
    }
    mostrarPainel();
  }).catch(function () {
    window.location.replace("/");
  });

  var sair = document.querySelector("[data-sair]");
  if (sair) {
    sair.addEventListener("click", function () {
      limparAuditoria();
      sessionStorage.removeItem(SESSAO);
      sessionStorage.removeItem("gigaeletro-auditoria");
      fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
        window.location.replace("/");
      });
    });
  }

  prepararDrop(document.querySelector("[data-drop-admin]"), input, function (file) {
    planilhaEscolhida = file;
    if (nomeArquivo) {
      nomeArquivo.hidden = !file;
      nomeArquivo.textContent = file ? "Arquivo selecionado: " + file.name : "";
    }
    if (processar) processar.disabled = !file;
    if (status) status.hidden = true;
  });

  if (processar) {
    processar.addEventListener("click", function () {
      if (!planilhaEscolhida) return;
      processar.disabled = true;
      if (status) {
        status.hidden = false;
        status.textContent = "Limpando o catálogo e lendo a planilha…";
      }
      var dados = new FormData();
      dados.append("senha", SENHA_ADMIN);
      dados.append("arquivo", planilhaEscolhida, planilhaEscolhida.name);
      fetch("/api/catalogo", { method: "POST", body: dados }).then(function (resposta) {
        return resposta.json().then(function (corpo) {
          if (!resposta.ok || !corpo.ok) {
            throw new Error(corpo.erro || "A leitura falhou e o catálogo anterior foi mantido.");
          }
          return corpo;
        });
      }).then(function (corpo) {
        if (status) status.hidden = true;
        mostrarAuditoria(corpo);
        planilhaEscolhida = null;
        if (nomeArquivo) nomeArquivo.hidden = true;
        if (input) input.value = "";
        processar.disabled = true;
      }).catch(function (falha) {
        if (status) {
          status.hidden = false;
          status.textContent = falha && falha.message ? falha.message : "A leitura falhou e o catálogo anterior foi mantido.";
        }
        processar.disabled = !planilhaEscolhida;
      });
    });
  }

  function mostrarPainel() {
    if (formSenha) formSenha.hidden = true;
    if (painel) painel.hidden = false;
    limparAuditoria();
    carregarOrcamentos();
  }

  function limparAuditoria() {
    if (!auditoria) return;
    auditoria.querySelectorAll("strong").forEach(function (campo) {
      campo.textContent = "";
    });
    var lista = auditoria.querySelector("[data-audit-pulados]");
    if (lista) lista.innerHTML = "";
    auditoria.hidden = true;
  }

  function mostrarAuditoria(corpo) {
    if (!auditoria || !corpo) return;
    var linhas = auditoria.querySelector("[data-audit-linhas]");
    var inseridos = auditoria.querySelector("[data-audit-inseridos]");
    var quando = auditoria.querySelector("[data-audit-quando]");
    var lista = auditoria.querySelector("[data-audit-pulados]");
    var catalogo = auditoria.querySelector("[data-audit-catalogo]");
    if (catalogo) catalogo.textContent = String(corpo.catalogo != null ? corpo.catalogo : corpo.inseridos || 0);
    if (linhas) linhas.textContent = corpo.linhas_lidas != null ? String(corpo.linhas_lidas) : "—";
    if (inseridos) inseridos.textContent = corpo.inseridos != null ? String(corpo.inseridos) : "—";
    if (quando) quando.textContent = corpo.atualizado_em || "";
    if (lista) {
      var pulados = Array.isArray(corpo.pulados) ? corpo.pulados : [];
      lista.innerHTML = pulados.length
        ? pulados.map(function (item) { return "<li>" + escapar(item) + "</li>"; }).join("")
        : "<li>Nenhum.</li>";
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

  var campoData = document.querySelector("[data-gestor-data]");
  var campoDocumento = document.querySelector("[data-gestor-documento]");
  var listaGestor = document.querySelector("[data-gestor-lista]");
  var vazioGestor = document.querySelector("[data-gestor-vazio]");

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
    var partes = String(iso || "").split("-");
    if (partes.length !== 3) return iso || "";
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function renderOrcamentos(lista) {
    if (!listaGestor) return;
    if (vazioGestor) vazioGestor.hidden = lista.length > 0;
    listaGestor.innerHTML = lista.map(function (item) {
      var itens = (item.itens || []).map(function (produto) {
        return '<span class="gestor-item">' + escapar(produto.qtd) + " × " + escapar(produto.produto) + " · " + moedaPainel(produto.valor) + "</span>";
      }).join("");
      return "<tr>" +
        "<td>" + escapar(dataVisivel(item.data)) + "</td>" +
        "<td>" + escapar(item.nome) + "</td>" +
        "<td>" + escapar(documentoVisivel(String(item.documento || ""))) + "</td>" +
        "<td>" + escapar(item.telefone) + "</td>" +
        "<td>" + itens + "</td>" +
        '<td class="num">' + moedaPainel(item.total) + "</td>" +
      "</tr>";
    }).join("");
  }

  function carregarOrcamentos() {
    if (!listaGestor) return;
    var data = campoData ? campoData.value : "";
    var documento = digitosDocumento(campoDocumento ? campoDocumento.value : "");
    var url = "/api/orcamentos?data=" + encodeURIComponent(data) + "&documento=" + encodeURIComponent(documento);
    fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (resposta) {
      if (resposta.status === 401) {
        window.location.replace("/");
        return null;
      }
      return resposta.json();
    }).then(function (corpo) {
      if (!corpo) return;
      renderOrcamentos(corpo.ok && Array.isArray(corpo.orcamentos) ? corpo.orcamentos : []);
    }).catch(function () {
      renderOrcamentos([]);
    });
  }

  if (campoDocumento) {
    campoDocumento.addEventListener("input", function () {
      campoDocumento.value = digitosDocumento(campoDocumento.value);
      carregarOrcamentos();
    });
  }
  if (campoData) campoData.addEventListener("change", carregarOrcamentos);

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
