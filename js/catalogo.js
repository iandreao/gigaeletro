(function () {
  const root = document.querySelector("[data-catalogo]");
  if (!root) return;

  const produtos = (Array.isArray(window.GIGAELETRO_PRODUTOS) ? window.GIGAELETRO_PRODUTOS : [])
    .map(normalizar)
    .filter((item) => item.nome)
    .sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );

  const tools = document.querySelector("[data-catalogo-tools]");
  const busca = document.querySelector("[data-busca]");
  const chips = document.querySelector("[data-chips]");
  const status = document.querySelector("[data-status]");
  const vazio = document.querySelector("[data-vazio]");
  if (!produtos.length || !tools || !busca || !chips || !status || !vazio) return;

  const categorias = [...new Set(produtos.map((item) => item.categoria))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  let categoriaAtiva = "*";
  const pedida = new URLSearchParams(location.search).get("categoria");
  if (pedida) {
    const encontrada = categorias.find((categoria) => slug(categoria) === slug(pedida));
    if (encontrada) categoriaAtiva = encontrada;
  }

  chips.innerHTML = [
    { id: "*", label: "Todas" },
    ...categorias.map((categoria) => ({ id: categoria, label: categoria })),
  ]
    .map(
      (item) =>
        `<button type="button" class="chip" data-cat="${esc(item.id)}">${esc(item.label)}</button>`
    )
    .join("");

  chips.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cat]");
    if (!button) return;
    categoriaAtiva = button.dataset.cat;
    render();
  });

  busca.addEventListener("input", render);
  tools.hidden = false;
  render();

  function render() {
    const termo = busca.value.trim().toLocaleLowerCase("pt-BR");
    const visiveis = produtos.filter((item) => {
      if (categoriaAtiva !== "*" && item.categoria !== categoriaAtiva) return false;
      if (!termo) return true;
      return [item.nome, item.categoria, item.marca, item.codigo, item.descricao, item.unidade]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(termo);
    });

    status.textContent =
      visiveis.length === 1 ? "1 produto" : `${visiveis.length} produtos`;
    vazio.hidden = visiveis.length !== 0;
    root.innerHTML = visiveis.map(card).join("");

    chips.querySelectorAll("[data-cat]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.cat === categoriaAtiva));
    });
  }

  function card(item) {
    const meta = [
      item.codigo ? `Cód. ${item.codigo}` : "",
      item.marca,
      item.unidade,
    ].filter(Boolean);
    const preco = formatPreco(item.preco);
    const foto = imagemSegura(item.imagem);

    return `<article class="produto">
      <p class="produto-cat">${esc(item.categoria)}</p>
      ${foto ? `<img class="produto-img" src="${esc(foto)}" alt="">` : ""}
      <h2>${esc(item.nome)}</h2>
      ${meta.length ? `<p class="produto-meta">${esc(meta.join(" · "))}</p>` : ""}
      ${item.descricao ? `<p class="produto-desc">${esc(item.descricao)}</p>` : ""}
      <p class="produto-preco">${esc(preco || "Sob consulta")}</p>
      <a class="btn btn-small" href="tel:+552835462723">Consultar no balcão</a>
    </article>`;
  }

  function normalizar(item) {
    if (!item || typeof item !== "object") return { nome: "" };
    const categoria = texto(pick(item, ["categoria", "grupo", "departamento", "linha", "secao", "seção"]));
    return {
      nome: texto(pick(item, ["nome", "produto", "item"])),
      categoria: categoria || "Outros",
      marca: texto(pick(item, ["marca", "fabricante"])),
      codigo: texto(pick(item, ["codigo", "código", "cod", "sku", "referencia", "referência"])),
      unidade: texto(pick(item, ["unidade", "un", "und"])),
      preco: pick(item, ["preco", "preço", "valor", "preco_venda", "preço_venda"]),
      descricao: texto(pick(item, ["descricao", "descrição", "detalhes", "observacao", "observação"])),
      imagem: texto(pick(item, ["imagem", "foto", "image", "url_imagem"])),
    };
  }

  function pick(obj, keys) {
    const mapa = {};
    Object.entries(obj).forEach(([chave, valor]) => {
      mapa[chave.toLocaleLowerCase("pt-BR")] = valor;
    });
    for (const key of keys) {
      const valor = mapa[key.toLocaleLowerCase("pt-BR")];
      if (valor != null && String(valor).trim() !== "") return valor;
    }
    return "";
  }

  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function formatPreco(valor) {
    if (valor == null || valor === "") return null;
    if (typeof valor === "number") return Number.isFinite(valor) ? moeda(valor) : null;
    const bruto = String(valor).trim();
    if (!bruto || /^sob consulta$/i.test(bruto)) return null;
    let limpo = bruto.replace(/\s/g, "").replace(/^R\$/i, "");
    if (limpo.includes(",")) limpo = limpo.replace(/\./g, "").replace(",", ".");
    const numero = Number(limpo);
    return Number.isFinite(numero) ? moeda(numero) : bruto;
  }

  function moeda(numero) {
    return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function imagemSegura(src) {
    if (!src || /^(javascript|data):/i.test(src)) return "";
    return src;
  }

  function slug(valor) {
    return String(valor)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function esc(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
