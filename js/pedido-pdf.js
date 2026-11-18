/* Gerador oficial do PDF "PEDIDO DE ORÇAMENTO" (compartilhado entre site e Área Restrita). */
(function (root) {
  var logoPdf = new Image();
  logoPdf.src = "assets/logo-gigaeletro.jpg";

  function itemVoz(item) {
    return String((item && item.codigo) || "").indexOf("voz-") === 0;
  }

  function numero(valor) {
    var partes = Math.abs(Number(valor) || 0).toFixed(2).split(".");
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return inteiro + "," + partes[1];
  }

  function moeda(valor) {
    return "R$ " + numero(valor);
  }

  function dataValidade(base) {
    var criacao = base instanceof Date ? base : new Date(base || Date.now());
    if (isNaN(criacao.getTime())) criacao = new Date();
    var validade = new Date(criacao.getFullYear(), criacao.getMonth(), criacao.getDate(), 12);
    validade.setDate(validade.getDate() + 15);
    var dia = String(validade.getDate()).padStart(2, "0");
    var mes = String(validade.getMonth() + 1).padStart(2, "0");
    return dia + "/" + mes + "/" + validade.getFullYear();
  }

  function textoAvisoPdf(itens, base) {
    var porVoz = (itens || []).some(itemVoz);
    if (porVoz) {
      return "Nota: Este orçamento foi gerado por comando de voz, o preço dos itens listados, o estoque e o frete, serão informados no WhatsApp ou no E-mail.";
    }
    return "Nota: O preço dos itens listados vale até " + dataValidade(base) + ". O estoque e o frete serão informados no WhatsApp ou no E-mail.";
  }

  function normalizarItens(itens) {
    return (Array.isArray(itens) ? itens : []).map(function (item) {
      var qtd = Number(item && item.qtd);
      var preco = Number(item && item.preco);
      if (!(qtd > 0)) qtd = 1;
      if (!isFinite(preco)) {
        var total = Number(item && item.valor);
        preco = qtd > 0 && isFinite(total) ? total / qtd : 0;
      }
      return {
        codigo: String((item && item.codigo) || ""),
        produto: String((item && item.produto) || ""),
        qtd: qtd,
        preco: preco
      };
    }).filter(function (item) {
      return item.produto || item.codigo;
    });
  }

  function gerar(opcoes) {
    if (!root.jspdf || !root.jspdf.jsPDF) throw new Error("jspdf");
    var cfg = opcoes || {};
    var cliente = cfg.cliente || {};
    var itensDocumento = normalizarItens(cfg.itens);
    if (!itensDocumento.length) {
      itensDocumento = [{ codigo: "", produto: "—", qtd: 1, preco: 0 }];
    }
    var subtotal = cfg.subtotal != null && isFinite(Number(cfg.subtotal))
      ? Number(cfg.subtotal)
      : itensDocumento.reduce(function (soma, item) { return soma + item.preco * item.qtd; }, 0);
    var dataCriacao = cfg.dataCriacao instanceof Date ? cfg.dataCriacao : new Date(cfg.dataCriacao || Date.now());
    if (isNaN(dataCriacao.getTime())) dataCriacao = new Date();

    var doc = new root.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var margem = 12;
    var largura = doc.internal.pageSize.getWidth();
    var altura = doc.internal.pageSize.getHeight();
    var util = largura - margem * 2;
    var alturaRodape = 24;
    var yRodape = altura - margem - alturaRodape;
    var alturaCabeca = 8;
    var alturaLinha = 8;
    var colunas = [
      { titulo: "Itens", largura: 9, alinhamento: "center" },
      { titulo: "Código", largura: 14, alinhamento: "center" },
      { titulo: "Nome", largura: 0, alinhamento: "left" },
      { titulo: "Qte", largura: 16, alinhamento: "center" },
      { titulo: "Pr.Unitário", largura: 20.8, alinhamento: "right" },
      { titulo: "Total", largura: 25.2, alinhamento: "right" }
    ];
    colunas[2].largura = util - colunas.reduce(function (soma, coluna) { return soma + coluna.largura; }, 0);

    function traco() {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.setTextColor(0, 0, 0);
    }

    function textoCelula(x, y, w, h, rotulo, valor) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      var prefixo = rotulo + " ";
      var larguraRotulo = doc.getTextWidth(prefixo);
      doc.setFont("helvetica", "normal");
      var linhas = doc.splitTextToSize(String(valor || ""), Math.max(8, w - larguraRotulo - 3.2));
      if (!linhas.length) linhas = [""];
      linhas = linhas.slice(0, 2);
      var base = y + (h - linhas.length * 3.4) / 2 + 2.8;
      doc.setFont("helvetica", "bold");
      doc.text(prefixo, x + 1.6, base);
      doc.setFont("helvetica", "normal");
      doc.text(linhas, x + 1.6 + larguraRotulo, base);
    }

    function desenharCliente(y) {
      var alturas = [11, 11, 11, 11];
      var linhas = [
        [["Nome:", cliente.nome, 0.5], ["CPF/CNPJ:", cliente.documento, 0.5]],
        [["End:", cliente.endereco, 0.72], ["Nr:", cliente.numero, 0.28]],
        [
          ["Cidade:", cliente.cidade, 0.34],
          ["Bairro:", cliente.bairro, 0.34],
          ["UF:", cliente.uf, 0.12],
          ["CEP:", cliente.cep, 0.2]
        ],
        [["Telefone / Celular:", cliente.celular, 0.5], ["e-mail:", cliente.email, 0.5]]
      ];
      var alturaGrade = alturas.reduce(function (soma, atual) { return soma + atual; }, 0);
      traco();
      doc.rect(margem, y, util, alturaGrade);
      var yLinha = y;
      linhas.forEach(function (campos, indice) {
        if (indice > 0) doc.line(margem, yLinha, margem + util, yLinha);
        var x = margem;
        campos.forEach(function (campo, posicao) {
          var w = util * campo[2];
          if (posicao > 0) doc.line(x, yLinha, x, yLinha + alturas[indice]);
          textoCelula(x, yLinha, w, alturas[indice], campo[0], campo[1]);
          x += w;
        });
        yLinha += alturas[indice];
      });
      return yLinha;
    }

    function desenharTabela(y, h, itens, inicio) {
      traco();
      doc.setFillColor(255, 255, 255);
      doc.rect(margem, y, util, h, "S");
      doc.line(margem, y + alturaCabeca, margem + util, y + alturaCabeca);
      var x = margem;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      colunas.forEach(function (coluna, indice) {
        if (indice > 0) doc.line(x, y, x, y + h);
        var tamanhoCabeca = 8;
        doc.setFontSize(tamanhoCabeca);
        while (tamanhoCabeca > 6 && doc.getTextWidth(coluna.titulo) > coluna.largura - 1.2) {
          tamanhoCabeca -= 0.5;
          doc.setFontSize(tamanhoCabeca);
        }
        doc.text(coluna.titulo, x + coluna.largura / 2, y + 5.2, { align: "center" });
        x += coluna.largura;
      });
      doc.setFont("helvetica", "normal");
      itens.forEach(function (item, indice) {
        var codigoCelula = itemVoz(item) ? "" : String(item.codigo || "").replace(/^voz-.*$/i, "");
        var nomeCelula = String(item.produto || "").replace(/^voz-[a-z0-9]+-\d+\s*-\s*/i, "");
        if (itemVoz(item)) nomeCelula = nomeCelula.replace(/^\d+\s*-\s*/, "");
        nomeCelula = nomeCelula.trim();
        var valores = [
          String(inicio + indice + 1),
          codigoCelula,
          nomeCelula,
          String(item.qtd),
          numero(item.preco),
          numero(item.preco * item.qtd)
        ];
        var yTexto = y + alturaCabeca + indice * alturaLinha + 5.2;
        x = margem;
        valores.forEach(function (valor, posicao) {
          var coluna = colunas[posicao];
          var texto = valor;
          var tamanho = 8;
          if (posicao === 2) {
            var limite = Math.max(12, coluna.largura - 3);
            tamanho = 8;
            while (tamanho > 6.5) {
              doc.setFontSize(tamanho);
              if (doc.getTextWidth(valor) <= limite) break;
              tamanho -= 0.5;
            }
            doc.setFontSize(tamanho);
            if (doc.getTextWidth(valor) > limite) {
              texto = doc.splitTextToSize(valor, limite);
            }
          }
          var tx = x + 1.5;
          if (coluna.alinhamento === "center") tx = x + coluna.largura / 2;
          if (coluna.alinhamento === "right") tx = x + coluna.largura - 1.5;
          var base = Array.isArray(texto) ? yTexto - 1.6 : yTexto;
          doc.setFontSize(posicao === 2 ? tamanho : 8);
          doc.text(texto, tx, base, { align: coluna.alinhamento });
          x += coluna.largura;
        });
      });
    }

    function desenharRodape() {
      var larguraTotal = 58;
      var xTotal = margem + util - larguraTotal;
      var nota = textoAvisoPdf(itensDocumento, dataCriacao);
      traco();
      doc.rect(margem, yRodape, util - larguraTotal, alturaRodape);
      doc.rect(xTotal, yRodape, larguraTotal, alturaRodape);
      doc.line(xTotal, yRodape + alturaRodape / 2, xTotal + larguraTotal, yRodape + alturaRodape / 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      var linhas = doc.splitTextToSize(nota, util - larguraTotal - 6);
      var baseNota = yRodape + (alturaRodape - linhas.length * 3.5) / 2 + 3;
      doc.text(linhas, margem + 3, baseNota);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Valor Total", xTotal + larguraTotal / 2, yRodape + 7.2, { align: "center" });
      doc.setFontSize(12);
      doc.text(moeda(subtotal), xTotal + larguraTotal / 2, yRodape + alturaRodape / 2 + 7.4, { align: "center" });
    }

    var inicioItem = 0;
    var primeira = true;
    var acabou = false;
    while (!acabou) {
      if (!primeira) doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(0, 0, 0);
      var alturaLogo = 12;
      var larguraLogo = alturaLogo * 366 / 184;
      if (logoPdf.complete && logoPdf.naturalWidth) {
        doc.addImage(logoPdf, "JPEG", margem, 16 - 2.2 - alturaLogo / 2, larguraLogo, alturaLogo);
      }
      doc.text("PEDIDO DE ORÇAMENTO", largura / 2, 16, { align: "center" });
      var yTabela = primeira ? desenharCliente(22) + 6 : 24;
      var lote = itensDocumento.slice(inicioItem, inicioItem + Math.max(1, Math.floor((yRodape - 4 - yTabela - alturaCabeca) / alturaLinha)));
      desenharTabela(yTabela, yRodape - 4 - yTabela, lote, inicioItem);
      inicioItem += lote.length;
      acabou = inicioItem >= itensDocumento.length;
      if (acabou) desenharRodape();
      primeira = false;
    }
    return doc.output("blob");
  }

  root.GigaeletroPedidoPdf = {
    gerar: gerar,
    pronto: function () { return !!(root.jspdf && root.jspdf.jsPDF); }
  };
})(window);
