// Blog no navegador: a lista (blog.html) e o post (blog-post.html).
//
// A borda (functions/blog/) já entrega o HTML pronto. Aqui entra o que depende
// de QUEM está lendo:
//   - lista: filtros sem recarregar, "carregar mais" e o botão do editor;
//   - post: preço na moeda de quem lê, Tenho/Quero, preview da carta,
//     compartilhar, índice que acompanha a leitura e "editar este post";
//   - idiomas (2026-10-06): a lista na língua de quem lê, o "Leia em" que
//     troca a bandeirinha e o aviso quando o post não tem a versão dela. Ir
//     pra versão certa ao abrir é do src/theme.js, antes da primeira pintura.
// Sem a borda (dev local; Supabase fora na hora em que a Function rodou), a
// página vem vazia e isto busca e desenha sozinho, com o MESMO
// src/blog-render.js — o resultado é o mesmo HTML.
(function () {
  "use strict";
  const shared = window.TCGShared;
  const B = window.SleevuBlog;
  if (!shared || !B) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  // As mesmas do functions/blog/_comum.js (versoes/traducoes: migração 20261006a).
  const COLUNAS_LISTA = "slug,title,subtitle,excerpt,cover_url,cover_alt,game,category,tags,lang,featured,author_name,reading_min,published_at,updated_at,versoes";
  const COLUNAS_POST = "id," + COLUNAS_LISTA + ",body_md,seo_title,seo_desc,card_refs,traducoes";
  const POR_PAGINA = 36;
  const idioma = () => { const l = shared.getLanguage ? shared.getLanguage() : "pt"; return B.ROTULOS[l] ? l : "pt"; };
  // A mesma chave do idioma do site que o shared.js e o theme.js leem.
  const CHAVE_IDIOMA = "tcg-collector-ui-lang-v1";

  // Leitura ANÔNIMA (sem o token de quem está logado): a RLS de editor
  // entregaria rascunho junto, e a página pública mostra só o publicado.
  // [] = a tabela ainda não existe (migração pendente) — a página diz
  // "nenhum post" em vez de erro.
  async function leituraPublica(caminho) {
    const r = await fetch(B.SUPABASE_URL + caminho, { headers: { apikey: B.SUPABASE_KEY } });
    if (r.status === 404) return [];
    // Sem a migração 20261006a (colunas das traduções), o mesmo de novo sem
    // elas — igual ao supabase() do functions/blog/_comum.js.
    if (r.status === 400) {
      const semElas = caminho.replace(/,(?:versoes|traducoes)\b/g, "");
      if (semElas !== caminho) return leituraPublica(semElas);
    }
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }

  function lerJson(el) {
    const texto = el && el.textContent.trim();
    if (!texto) return null;
    try { return JSON.parse(texto); } catch (e) { return null; }
  }

  // "Sou editor do blog?" — só com sessão, e a resposta fica na sessão do
  // navegador pra não perguntar a cada página. A RPC (migração 20260930b)
  // devolve null pra quem não é editor; sem a migração, 404 = não.
  async function souEditor() {
    const s = shared.getSession && shared.getSession();
    if (!s || !s.user || !shared.authedFetch) return false;
    const chave = "tcg-blog-editor-" + s.user.id;
    try {
      const guardado = sessionStorage.getItem(chave);
      if (guardado === "1" || guardado === "0") return guardado === "1";
    } catch (e) { /* sem sessionStorage: pergunta */ }
    let sim = false;
    try {
      const r = await shared.authedFetch("/rest/v1/rpc/blog_me", { method: "POST", body: "{}" });
      sim = !!(r && r.ok && (await r.json()));
    } catch (e) { sim = false; }
    try { sessionStorage.setItem(chave, sim ? "1" : "0"); } catch (e) { /* ignora */ }
    return sim;
  }

  // ── Lista ────────────────────────────────────────────────────────────────
  function iniciaLista() {
    const lista = document.getElementById("blogList");
    const filtrosEl = document.getElementById("blogFilters");
    const catsEl = document.getElementById("blogCats");
    const jogoEl = document.getElementById("blogGame");
    const tagEl = document.getElementById("blogTag");
    const mais = document.getElementById("blogMore");

    const q = new URLSearchParams(location.search);
    const f = {
      cat: B.CATEGORIAS[q.get("cat")] ? q.get("cat") : "",
      jogo: B.GAMES[q.get("jogo")] ? q.get("jogo") : "",
      tag: (q.get("tag") || "").trim().slice(0, 40)
    };
    let posts = [];
    let temMais = false;

    // A mesma regra do aplicaFiltros da borda (functions/blog/index.js).
    const visiveis = () => {
      const tag = f.tag.toLowerCase();
      return posts.filter((p) => (!f.cat || p.category === f.cat) && (!f.jogo || p.game === f.jogo)
        && (!tag || (p.tags || []).some((x) => String(x).toLowerCase() === tag)));
    };
    function desenhaLista() {
      const v = visiveis();
      lista.innerHTML = v.length ? B.listaHtml(v, idioma())
        : `<p class="empty-state">${escapeHtml(t(posts.length ? "blog.emptyFilter" : "blog.empty"))}</p>`;
      mais.hidden = !temMais;
    }
    function desenhaFiltros() {
      if (!posts.length) { filtrosEl.hidden = true; tagEl.hidden = true; return; }
      // Só categoria/jogo que TEM post: pílula que leva a lista vazia é ruído.
      const cats = Object.keys(B.CATEGORIAS).filter((c) => posts.some((p) => p.category === c));
      const jogos = Object.keys(B.GAMES).filter((g) => posts.some((p) => p.game === g));
      filtrosEl.hidden = false;
      catsEl.innerHTML = [["", t("blog.allCats")]].concat(cats.map((c) => [c, B.nomeCategoria(c, idioma())]))
        .map(([c, nome]) => `<button type="button" class="blog-chip" data-cat="${escapeAttribute(c)}" aria-pressed="${f.cat === c ? "true" : "false"}">${escapeHtml(nome)}</button>`)
        .join("");
      jogoEl.innerHTML = `<option value="">${escapeHtml(t("blog.allGames"))}</option>`
        + jogos.map((g) => `<option value="${g}"${f.jogo === g ? " selected" : ""}>${escapeHtml(B.GAMES[g][0])}</option>`).join("");
      // Um jogo só no blog inteiro: o seletor não escolhe nada.
      jogoEl.closest(".blog-game-filter").hidden = jogos.length < 2 && !f.jogo;
      tagEl.hidden = !f.tag;
      if (f.tag) {
        tagEl.innerHTML = `<span>${escapeHtml(t("blog.tagActive", { tag: f.tag }))}</span>`
          + `<button type="button" class="lst-mini" data-limpa-tag>${escapeHtml(t("blog.clearFilter"))}</button>`;
      }
    }
    function sincronizaUrl() {
      const p = new URLSearchParams();
      if (f.cat) p.set("cat", f.cat);
      if (f.jogo) p.set("jogo", f.jogo);
      if (f.tag) p.set("tag", f.tag);
      try { history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "")); } catch (e) { /* ignora */ }
    }
    function mudou() { sincronizaUrl(); desenhaFiltros(); desenhaLista(); }

    catsEl.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-cat]");
      if (!b) return;
      f.cat = b.dataset.cat;
      mudou();
    });
    jogoEl.addEventListener("change", () => { f.jogo = B.GAMES[jogoEl.value] ? jogoEl.value : ""; mudou(); });
    tagEl.addEventListener("click", (ev) => { if (ev.target.closest("[data-limpa-tag]")) { f.tag = ""; mudou(); } });
    mais.addEventListener("click", async () => {
      mais.disabled = true;
      try {
        const novos = await leituraPublica(`/rest/v1/posts?select=${COLUNAS_LISTA}&status=eq.published&order=published_at.desc&offset=${posts.length}&limit=${POR_PAGINA + 1}`);
        temMais = novos.length > POR_PAGINA;
        posts = posts.concat(novos.slice(0, POR_PAGINA));
        desenhaFiltros();
        desenhaLista();
      } catch (e) {
        mais.textContent = t("blog.loadError");
      } finally { mais.disabled = false; }
    });

    const daBorda = lerJson(document.getElementById("blogData"));
    if (daBorda && Array.isArray(daBorda.posts)) {
      // A borda já desenhou a lista (com os filtros da URL): só os controles.
      posts = daBorda.posts;
      temMais = !!daBorda.temMais;
      desenhaFiltros();
      mais.hidden = !temMais;
      // A borda desenha cada post na versão original (ela não sabe quem lê):
      // quem lê em outra língua ganha a lista de novo, nas versões dela.
      if (posts.some((p) => p.lang !== idioma())) desenhaLista();
    } else {
      leituraPublica(`/rest/v1/posts?select=${COLUNAS_LISTA}&status=eq.published&order=published_at.desc&limit=${POR_PAGINA + 1}`)
        .then((linhas) => {
          temMais = linhas.length > POR_PAGINA;
          posts = linhas.slice(0, POR_PAGINA);
          desenhaFiltros();
          desenhaLista();
        })
        .catch(() => { lista.innerHTML = `<p class="empty-state">${escapeHtml(t("blog.loadError"))}</p>`; });
    }

    souEditor().then((sim) => {
      const botao = document.querySelector("[data-blog-manage]");
      if (sim && botao) botao.hidden = false;
    });
  }

  // ── Post ─────────────────────────────────────────────────────────────────
  const ICONE_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICONE_MAIS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const ICONE_CORACAO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7l1.1 1.1L12 22l7.7-7.6 1.1-1.1a5.4 5.4 0 0 0 0-7.7z"/></svg>';

  // { slug, lang }: /blog/<slug>, /blog/<idioma>/<slug> ou, sem a borda (dev
  // local), blog-post?slug=…&lang=…. lang "" = sem idioma no endereço.
  function enderecoDaUrl() {
    const m = /^\/blog\/(?:(pt|en|es)\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(location.pathname);
    if (m) return { slug: m[2], lang: m[1] || "" };
    const q = new URLSearchParams(location.search);
    const s = q.get("slug") || "";
    const l = q.get("lang") || "";
    return { slug: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) ? s : "", lang: B.ROTULOS[l] ? l : "" };
  }

  // Cartas citadas → Map "jogo/id" → carta do catálogo (com .game). Vem da
  // borda (/api/collection) ou, sem ela, dos chunks — é a mesma carga que o
  // Explorar usa pra "mais vistas".
  async function carregaCartas(refs, stores) {
    const porRef = new Map();
    const idsByGame = {};
    (refs || []).forEach((ref) => {
      const barra = ref.indexOf("/");
      const game = ref.slice(0, barra);
      if (barra < 1 || !(shared.GAME_SLUGS || []).includes(game)) return;
      (idsByGame[game] = idsByGame[game] || []).push(ref.slice(barra + 1));
    });
    if (!Object.keys(idsByGame).length) return porRef;
    const catalogo = await shared.loadOwnedAcrossGames(idsByGame);
    (catalogo && catalogo.cards || []).forEach((card) => {
      if (!card || !card.game) return;
      stores.cardGameMap.set(card.id, card.game);
      porRef.set(card.game + "/" + card.id, card);
    });
    return porRef;
  }

  function naoAchou(raiz) {
    raiz.innerHTML = `<div class="blog-notfound"><p class="empty-state">${escapeHtml(t("blog.notFound"))}</p>`
      + `<a class="cta" href="/blog">${escapeHtml(t("blog.back"))}</a></div>`;
  }

  async function iniciaPost() {
    const raiz = document.getElementById("blogPost");
    const stores = shared.createCrossGameStores();
    let dados = lerJson(document.getElementById("blogPostData"));
    let porRef = null;

    if (!dados) {
      // Sem a borda: busca o post e desenha aqui, com o mesmo renderizador.
      const { slug, lang: pedido } = enderecoDaUrl();
      if (!slug) { naoAchou(raiz); return; }
      let post = null;
      try {
        const linhas = await leituraPublica(`/rest/v1/posts?slug=eq.${slug}&status=eq.published&select=${COLUNAS_POST}&limit=1`);
        post = linhas && linhas[0];
      } catch (e) {
        raiz.innerHTML = `<p class="empty-state">${escapeHtml(t("blog.loadError"))}</p>`;
        return;
      }
      if (!post) { naoAchou(raiz); return; }
      try { porRef = await carregaCartas(post.card_refs, stores); } catch (e) { porRef = new Map(); }
      // A versão do endereço; sem idioma nele, a da bandeirinha (se existir).
      const v = B.versao(post, pedido || idioma());
      const card = (ref) => {
        const c = porRef.get(ref);
        return c ? { name: c.name, set: c.set, setId: c.setId, number: c.number, image: c.image, price: "" } : null;
      };
      const r = B.render(v.body_md, { lang: v.lang, card, ancora: v.caminho });
      raiz.innerHTML = B.paginaDoPostHtml(v, r, { card });
      document.title = (v.seo_title || v.title || "Blog") + " | Sleevu";
      dados = { id: post.id, slug: post.slug, lang: v.lang, original: v.original, caminhos: v.caminhos, game: post.game || "", refs: r.refs };
    }

    acordaCompartilhar(raiz);
    acordaIndice(raiz);
    acordaVersoes(raiz, dados);
    const cta = raiz.querySelector("[data-blog-cta]");
    if (cta && shared.getSession && shared.getSession()) cta.hidden = true;
    souEditor().then((sim) => {
      const botao = document.querySelector("[data-blog-manage]");
      if (!sim || !botao) return;
      botao.href = "blog-editor?id=" + encodeURIComponent(dados.id) + (dados.original && dados.lang !== dados.original ? "&versao=" + dados.lang : "");
      botao.hidden = false;
    });

    if (!(dados.refs || []).length) return;
    try {
      if (!porRef) porRef = await carregaCartas(dados.refs, stores);
    } catch (e) { return; } // sem catálogo: fica o preço de referência que a borda escreveu
    acordaCartas(raiz, porRef, stores);
  }

  // Preço na moeda de quem lê (a borda escreveu US$ de referência), Tenho/Quero
  // pra quem tem conta, e o preview da carta no clique.
  function acordaCartas(raiz, porRef, stores) {
    const logado = !!(shared.getSession && shared.getSession());
    const variante = (card) => shared.defaultVariant(card);

    function pintaPrecos() {
      raiz.querySelectorAll("[data-card-ref]").forEach((el) => {
        const card = porRef.get(el.getAttribute("data-card-ref"));
        const alvo = el.querySelector("[data-card-price]");
        if (!card || !alvo) return;
        const v = shared.cardValue(card, variante(card), stores.prices, shared.DEFAULT_CONDITION);
        if (v && v.value > 0) alvo.textContent = (v.estimated ? "≈ " : "") + shared.formatMoney(v.currency, v.value);
      });
    }
    function pintaAcoes() {
      if (!logado) return;
      raiz.querySelectorAll("[data-card-ref]").forEach((el) => {
        const slot = el.querySelector("[data-card-actions]");
        const card = porRef.get(el.getAttribute("data-card-ref"));
        if (!slot || !card) return;
        const qtd = stores.owned.totalForCard(card.id);
        const quer = stores.wishlist.hasCard(card.id);
        slot.innerHTML =
          `<button type="button" class="blog-act${qtd ? " is-on" : ""}" data-act="have" aria-label="${escapeAttribute(t("blog.haveAdd", { card: card.name }))}">`
          + (qtd ? ICONE_CHECK : ICONE_MAIS) + `<span>${escapeHtml(qtd ? t("blog.haveN", { n: qtd }) : t("blog.have"))}</span></button>`
          + `<button type="button" class="blog-act${quer ? " is-on" : ""}" data-act="want" aria-pressed="${quer ? "true" : "false"}" aria-label="${escapeAttribute(t("blog.wantToggle", { card: card.name }))}"`
          + (quer ? ` title="${escapeAttribute(t("blog.wantOn"))}"` : "") + `>` + ICONE_CORACAO + `<span>${escapeHtml(t("blog.want"))}</span></button>`;
      });
    }

    const preview = shared.createCardPreview({
      getCard: (id) => {
        for (const card of porRef.values()) if (card.id === id) return card;
        return null;
      },
      store: stores.owned,
      prices: stores.prices,
      wishlist: stores.wishlist,
      onOwnedChange: () => pintaAcoes()
    });

    raiz.addEventListener("click", (ev) => {
      const acao = ev.target.closest("[data-act]");
      if (acao) {
        const el = acao.closest("[data-card-ref]");
        const card = el && porRef.get(el.getAttribute("data-card-ref"));
        if (!card) return;
        // "Tenho" soma uma cópia (NM, versão padrão) a cada toque — como o "+"
        // das grades; quantidade e versão se ajustam no preview da carta.
        if (acao.dataset.act === "have") stores.owned.add(card.id, variante(card), shared.DEFAULT_CONDITION, 1);
        else stores.wishlist.toggle(card.id, variante(card));
        pintaAcoes();
        return;
      }
      const link = ev.target.closest("[data-blog-card]");
      if (!link || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0) return;
      const card = porRef.get(link.getAttribute("data-blog-card"));
      if (!card) return; // sem a carta carregada, o link segue pra página do set
      ev.preventDefault();
      preview.open(card.id, variante(card));
    });

    pintaAcoes();
    shared.loadFxRates().catch(() => null).then(pintaPrecos);
    document.addEventListener("sleevu:fx-updated", pintaPrecos);
  }

  // "Leia em": escolher outra versão troca o idioma do SITE (o post acompanha
  // a bandeirinha; sem trocar, o theme.js da página de destino mandaria de
  // volta). Post sem a versão de quem lê ganha um aviso, no idioma de quem lê.
  function acordaVersoes(raiz, dados) {
    raiz.addEventListener("click", (ev) => {
      const a = ev.target.closest("a[data-idioma]");
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0) return;
      try { localStorage.setItem(CHAVE_IDIOMA, a.dataset.idioma); } catch (e) { /* sem storage: só navega */ }
    });
    const quer = idioma();
    const tem = Object.keys(dados.caminhos || {});
    if (quer === dados.lang || tem.indexOf(quer) >= 0) return;
    const cabeca = raiz.querySelector(".blog-article-head");
    if (!cabeca) return;
    const aviso = document.createElement("p");
    aviso.className = "blog-aviso-idioma";
    aviso.setAttribute("lang", document.documentElement.lang || "");
    aviso.textContent = t("blog.noVersion");
    cabeca.insertBefore(aviso, cabeca.querySelector(".blog-title"));
  }

  function acordaCompartilhar(raiz) {
    const box = raiz.querySelector("[data-blog-share]");
    if (!box) return;
    const url = box.getAttribute("data-url");
    const titulo = box.getAttribute("data-title") || document.title;
    const nativo = box.querySelector("[data-share-native]");
    if (nativo && navigator.share) {
      nativo.hidden = false;
      nativo.addEventListener("click", () => { navigator.share({ title: titulo, url }).catch(() => { /* cancelou */ }); });
    }
    const copiar = box.querySelector("[data-share-copy]");
    if (copiar) {
      copiar.addEventListener("click", async () => {
        const foi = await shared.copiaTexto(url);
        if (!foi) return;
        const rotulo = copiar.querySelector("span");
        const antes = rotulo.textContent;
        rotulo.textContent = t("blog.copied");
        copiar.classList.add("is-on");
        setTimeout(() => { rotulo.textContent = antes; copiar.classList.remove("is-on"); }, 2000);
      });
    }
  }

  // Índice lateral: marca a seção em leitura. Um observador só pra todos os
  // títulos; a faixa de "leitura" é o terço de cima da tela.
  function acordaIndice(raiz) {
    const links = Array.from(raiz.querySelectorAll(".blog-toc [data-toc]"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    const porId = new Map(links.map((a) => [a.getAttribute("data-toc"), a]));
    const titulos = Array.from(porId.keys()).map((id) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("data-toc") === e.target.id));
      });
    }, { rootMargin: "0px 0px -66% 0px" });
    titulos.forEach((h) => obs.observe(h));
    // O <details> do celular fecha depois de escolher a seção.
    raiz.addEventListener("click", (ev) => {
      const det = ev.target.closest(".blog-toc-mobile");
      if (det && ev.target.closest("a")) det.open = false;
    });
  }

  if (document.getElementById("blogPost")) {
    iniciaPost();
  } else if (document.getElementById("blogList")) {
    iniciaLista();
  }
})();
