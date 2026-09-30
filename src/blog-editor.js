// Editor do blog (blog-editor.html): lista de posts e a tela de escrever, com
// prévia ao vivo, cartas do catálogo, capa e imagens no Storage, SEO, agendar,
// histórico de versões e rascunho guardado no aparelho.
//
// Só quem está em blog_editores (migração 20260930b) — papel PRÓPRIO, sem nada
// a ver com o /admin (pedido do Fernando: dá pra entregar o blog a outra pessoa
// sem abrir o painel de números do site). Quem garante é a RLS do banco; aqui é
// só a porta da tela.
//
// A prévia usa o MESMO src/blog-render.js que a borda usa pra montar o post
// publicado (functions/blog/[slug].js): o que aparece aqui é o que vai pro ar.
//
// Texto em pt fixo — é uma página interna, como o /admin.
(function () {
  "use strict";
  const shared = window.TCGShared;
  const B = window.SleevuBlog;
  const root = document.getElementById("bedRoot");
  if (!shared || !B || !root) return;
  const esc = shared.escapeHtml;
  const attr = shared.escapeAttribute;

  const COLUNAS = "id,slug,status,title,subtitle,excerpt,body_md,cover_url,cover_alt,game,category,tags,lang,featured,seo_title,seo_desc,author_name,reading_min,published_at,created_at,updated_at";
  const COLUNAS_LISTA = "id,slug,status,title,cover_url,game,category,lang,featured,published_at,updated_at";
  // O que o editor manda pro banco. card_refs, reading_min e as datas de
  // controle o trigger calcula (o que viesse daqui seria ignorado).
  const CAMPOS = ["slug", "status", "title", "subtitle", "excerpt", "body_md", "cover_url", "cover_alt", "game", "category",
    "tags", "lang", "featured", "seo_title", "seo_desc", "author_name", "published_at"];
  const BUCKET = "blog-media";
  const LOCAL = (id) => "tcg-blog-rascunho-" + (id || "novo");

  const SVG = (d, extra) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ""}>${d}</svg>`;
  const I = {
    voltar: SVG('<path d="M15 18l-6-6 6-6"/>'),
    mais: SVG('<path d="M12 5v14M5 12h14"/>'),
    menu: SVG('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    h2: SVG('<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 10.5a2.2 2.2 0 1 1 4.2 1c-.6 1.3-4.2 3.5-4.2 5.5h4.5"/>'),
    h3: SVG('<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16.2 9.6a2.2 2.2 0 1 1 2.2 3.1 2.2 2.2 0 1 1-2.3 3.4"/>'),
    b: SVG('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
    i: SVG('<path d="M11 5h7M6 19h7M15 5l-6 14"/>'),
    link: SVG('<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>'),
    ul: SVG('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    ol: SVG('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5l1.5-1v5"/><path d="M3.8 13.8c.3-1 2.4-1.2 2.4.2 0 1-2.4 2-2.4 3h2.6"/>'),
    quote: SVG('<path d="M6 17c-1.5 0-2.5-1.2-2.5-3 0-3 1.8-6 5-7l.5 1.2C7 9 6 10.3 6 11.5c1.6 0 2.6 1.1 2.6 2.7S7.5 17 6 17z"/><path d="M15.5 17c-1.5 0-2.5-1.2-2.5-3 0-3 1.8-6 5-7l.5 1.2c-2 .8-3 2.1-3 3.3 1.6 0 2.6 1.1 2.6 2.7S17 17 15.5 17z"/>'),
    img: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 9"/>'),
    carta: SVG('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>'),
    caixa: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14"/><path d="M11 10h6M11 14h4"/>'),
    tabela: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>'),
    linha: SVG('<path d="M3 12h18"/>'),
    ajuda: SVG('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>'),
    config: SVG('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    olho: SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    check: SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>', ' stroke-width="2.6"')
  };

  // ── Banco ────────────────────────────────────────────────────────────────
  // fetch com a sessão (o authedFetch do shared.js renova o token velho antes).
  // Erro vira exceção com status/code do PostgREST, pro aviso dizer o motivo.
  async function api(caminho, opcoes) {
    const o = opcoes || {};
    const r = await shared.authedFetch(caminho, { method: o.method || "GET", body: o.body, headers: o.headers || {} });
    if (!r) { const e = new Error("sessao"); e.status = 401; throw e; }
    const texto = r.status === 204 ? "" : await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
    if (!r.ok) {
      const e = new Error((json && (json.message || json.error)) || ("http " + r.status));
      e.status = r.status;
      e.code = json && (json.code || json.statusCode);
      throw e;
    }
    return json;
  }

  function mensagemDeErro(e) {
    if (!e) return "Algo deu errado.";
    if (e.code === "23505") return "Esse endereço já é de outro post. Troque o endereço nas configurações.";
    if (e.code === "23514") return "Algum campo passou do limite (endereço, título, resumo ou SEO). Confira nas configurações.";
    if (e.code === "42501" || e.status === 401 || e.status === 403) return "Sem permissão: a sessão expirou ou esta conta não é editora do blog. Entre de novo.";
    if (e.status === 404) return "O banco ainda não tem o blog: aplique a migração 20260930b.";
    if (e.status === 413) return "Arquivo grande demais (o limite é 5 MB).";
    if (e instanceof TypeError || e.message === "Failed to fetch") return "Sem conexão. O texto continua guardado neste aparelho.";
    return "Não deu certo: " + e.message;
  }

  // ── Porta e rotas ────────────────────────────────────────────────────────
  let eu = null;
  let tela = null; // { sujo(): bool } da tela de edição aberta, pra perguntar antes de sair

  function aviso(titulo, texto, botao) {
    root.innerHTML = `<div class="bed-gate"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${botao || ""}</div>`;
  }

  async function inicia() {
    if (!shared.getSession || !shared.getSession()) {
      try { localStorage.setItem("tcg-login-return", location.pathname + location.search); } catch (e) { /* ignora */ }
      location.replace("login");
      return;
    }
    let me = null;
    try {
      const r = await shared.authedFetch("/rest/v1/rpc/blog_me", { method: "POST", body: "{}" });
      if (r && r.status === 404) {
        aviso("Falta aplicar a migração", "O banco ainda não tem o blog. Aplique a supabase/migrations/20260930b_blog.sql no SQL Editor do Supabase e recarregue.");
        return;
      }
      me = r && r.ok ? await r.json() : null;
    } catch (e) {
      aviso("Sem conexão", "Não deu pra falar com o banco agora. Confira a internet e recarregue a página.");
      return;
    }
    if (!me) {
      aviso("Acesso restrito", "Esta conta não está na lista de editores do blog. Peça pra quem administra o site te incluir (é um papel separado do painel de admin).",
        '<a class="lst-mini bed-gate-link" href="/blog">Ir pro blog</a>');
      return;
    }
    eu = me;
    shared.loadFxRates().catch(() => null);
    // Voltar/avançar do navegador entre a lista e um post. Mudança só de #hash
    // (âncora) não é troca de tela; e com alteração não salva a pessoa pode
    // desistir — aí a URL volta pra da tela aberta.
    window.addEventListener("popstate", () => {
      if (location.pathname + location.search === urlAberta) return;
      if (!podeSair()) { history.pushState(null, "", urlAberta); return; }
      roteia();
    });
    window.addEventListener("beforeunload", (ev) => { if (tela && tela.sujo()) { ev.preventDefault(); ev.returnValue = ""; } });
    roteia();
  }

  let urlAberta = "";
  function podeSair() {
    if (!tela || !tela.sujo()) return true;
    return window.confirm("Tem alteração que ainda não foi salva no site. Sair mesmo assim? (O texto fica guardado neste aparelho.)");
  }
  function vaiPara(query) {
    if (!podeSair()) return;
    history.pushState(null, "", location.pathname + query);
    roteia();
  }
  function roteia() {
    const q = new URLSearchParams(location.search);
    if (tela && tela.fim) tela.fim();
    tela = null;
    urlAberta = location.pathname + location.search;
    window.scrollTo(0, 0);
    if (q.get("id")) abreEditor(q.get("id"));
    else if (q.has("novo")) abreEditor(null);
    else abreLista();
  }

  // ── Datas e estado ───────────────────────────────────────────────────────
  const fmtData = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; }
  };
  const hora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  // datetime-local fala em hora LOCAL sem fuso; o banco guarda timestamptz.
  const isoParaLocal = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const localParaIso = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  };
  function estadoDo(p) {
    if (!p || p.status !== "published") return { chave: "rascunho", rotulo: "Rascunho" };
    if (p.published_at && new Date(p.published_at) > new Date()) return { chave: "agendado", rotulo: "Agendado · " + fmtData(p.published_at) };
    return { chave: "publicado", rotulo: "Publicado" };
  }
  const pilula = (p) => { const e = estadoDo(p); return `<span class="bed-pill bed-pill--${e.chave}">${esc(e.rotulo)}</span>`; };

  // ── Lista ────────────────────────────────────────────────────────────────
  async function abreLista() {
    document.title = "Editor do blog - Sleevu";
    root.innerHTML = `
      <div class="bed-list-head">
        <div>
          <h1>Blog · editor</h1>
          <p class="page-head-sub">Assinando como <strong>${esc(eu.nome || "(sem nome)")}</strong>. Só quem está na lista de editores do blog vê esta tela.</p>
        </div>
        <button type="button" class="cta bed-novo" data-novo>${I.mais}<span>Novo post</span></button>
      </div>
      <div class="bed-list-tools">
        <input type="search" class="bed-input bed-busca" placeholder="Buscar por título ou endereço" data-busca aria-label="Buscar posts">
        <select class="lang-select" data-filtro aria-label="Situação">
          <option value="">Todos</option><option value="rascunho">Rascunhos</option>
          <option value="agendado">Agendados</option><option value="publicado">Publicados</option>
        </select>
      </div>
      <div class="bed-list" data-lista><p class="empty-state">Carregando…</p></div>`;
    const alvo = root.querySelector("[data-lista]");
    root.querySelector("[data-novo]").addEventListener("click", () => vaiPara("?novo"));

    let posts = [];
    try {
      posts = (await api(`/rest/v1/posts?select=${COLUNAS_LISTA}&order=updated_at.desc&limit=500`)) || [];
    } catch (e) {
      alvo.innerHTML = `<p class="empty-state">${esc(mensagemDeErro(e))}</p>`;
      return;
    }
    const desenha = () => {
      const termo = root.querySelector("[data-busca]").value.trim().toLowerCase();
      const filtro = root.querySelector("[data-filtro]").value;
      const lista = posts.filter((p) => (!termo || (p.title || "").toLowerCase().includes(termo) || p.slug.includes(termo))
        && (!filtro || estadoDo(p).chave === filtro));
      if (!posts.length) {
        alvo.innerHTML = `<div class="empty-state bed-vazio"><p>Nenhum post ainda.</p><button type="button" class="cta" data-novo2>Escrever o primeiro</button></div>`;
        alvo.querySelector("[data-novo2]").addEventListener("click", () => vaiPara("?novo"));
        return;
      }
      if (!lista.length) { alvo.innerHTML = '<p class="empty-state">Nenhum post com esse filtro.</p>'; return; }
      alvo.innerHTML = lista.map((p) => {
        let local = false;
        try { local = !!localStorage.getItem(LOCAL(p.id)); } catch (e) { /* ignora */ }
        const capa = B.safeImg(p.cover_url);
        return `<a class="bed-row" href="blog-editor?id=${attr(p.id)}" data-id="${attr(p.id)}">
          <span class="bed-row-cover">${capa ? `<img src="${attr(B.imagemPequena(capa))}" alt="" loading="lazy">` : ""}</span>
          <span class="bed-row-main">
            <span class="bed-row-title">${esc(p.title || "(sem título)")}</span>
            <span class="bed-row-slug">/blog/${esc(p.slug)}</span>
          </span>
          <span class="bed-row-tags">${pilula(p)}${B.etiquetaJogo(p.game)}${p.featured ? '<span class="bed-pill">Destaque</span>' : ""}</span>
          <span class="bed-row-date">${local ? '<span class="bed-row-local">alteração não salva neste aparelho</span>' : ""}Editado ${esc(fmtData(p.updated_at))}</span>
        </a>`;
      }).join("");
    };
    root.querySelector("[data-busca]").addEventListener("input", shared.debounce(desenha, 120));
    root.querySelector("[data-filtro]").addEventListener("change", desenha);
    alvo.addEventListener("click", (ev) => {
      const a = ev.target.closest("a.bed-row");
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button > 0) return;
      ev.preventDefault();
      vaiPara("?id=" + encodeURIComponent(a.dataset.id));
    });
    desenha();
  }

  // ── Diálogos (as classes .list-modal do núcleo, como o caixaDeTexto) ─────
  function dialogo({ titulo, corpo, classe, aoAbrir }) {
    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    wrap.innerHTML = `<div class="list-modal-box ${classe || ""}" role="dialog" aria-modal="true" aria-label="${attr(titulo)}">
      <div class="bed-dlg-head"><h2>${esc(titulo)}</h2><button type="button" class="bed-icon-btn" data-fecha aria-label="Fechar">${shared.CLOSE_ICON || "Fechar"}</button></div>
      ${corpo}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");
    const fecha = () => {
      wrap.remove();
      document.body.classList.remove("preview-open");
      document.removeEventListener("keydown", tecla);
    };
    const tecla = (ev) => { if (ev.key === "Escape") fecha(); };
    document.addEventListener("keydown", tecla);
    wrap.addEventListener("click", (ev) => { if (ev.target === wrap || ev.target.closest("[data-fecha]")) fecha(); });
    if (aoAbrir) aoAbrir(wrap.querySelector(".list-modal-box"), fecha);
    return fecha;
  }

  // ── Imagens ──────────────────────────────────────────────────────────────
  // Reduz no aparelho antes de subir: WebP de até 1600 px (capa de ~150-300
  // KB) mais a versão de 640 px pro celular. As medidas vão no NOME do arquivo
  // (-w1600h900), que é de onde o renderizador tira width/height e o srcset.
  // Navegador que não gera WebP (Safari antigo devolve PNG) cai no JPEG.
  // GIF sobe como veio: redesenhar no canvas mataria a animação.
  const LARGURA = 1600;
  const PEQUENA = 640;
  async function desenhaEm(fonte, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(fonte, 0, 0, w, h);
    const webp = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.84));
    if (webp && webp.type === "image/webp") return { blob: webp, tipo: "image/webp", ext: "webp" };
    const jpg = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    return { blob: jpg, tipo: "image/jpeg", ext: "jpg" };
  }
  function nomeBase(arquivo) {
    const base = B.slugify(String(arquivo.name || "imagem").replace(/\.[a-z0-9]+$/i, ""), 40) || "imagem";
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(3))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${base}-${rnd}`;
  }
  async function sobe(caminho, blob, tipo) {
    const r = await shared.authedFetch(`/storage/v1/object/${BUCKET}/${caminho}`, {
      method: "POST", body: blob, headers: { "Content-Type": tipo, "x-upsert": "false", "cache-control": "max-age=31536000" }
    });
    if (!r) { const e = new Error("sessao"); e.status = 401; throw e; }
    if (!r.ok) {
      let msg = "http " + r.status;
      try { const j = await r.json(); msg = j.message || j.error || msg; } catch (e) { /* ignora */ }
      const e = new Error(msg);
      e.status = r.status === 400 && /size|large/i.test(msg) ? 413 : r.status;
      throw e;
    }
    return shared.storagePublicUrl(BUCKET, caminho);
  }
  async function enviaImagem(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type)) throw new Error("Escolha um arquivo de imagem (JPG, PNG, WebP ou GIF).");
    const base = nomeBase(arquivo);
    if (arquivo.type === "image/gif") {
      if (arquivo.size > 5 * 1024 * 1024) { const e = new Error("grande"); e.status = 413; throw e; }
      return sobe(base + ".gif", arquivo, "image/gif");
    }
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, LARGURA / bmp.width);
    const W = Math.max(1, Math.round(bmp.width * escala));
    const H = Math.max(1, Math.round(bmp.height * escala));
    const grande = await desenhaEm(bmp, W, H);
    const url = await sobe(`${base}-w${W}h${H}.${grande.ext}`, grande.blob, grande.tipo);
    if (W > PEQUENA) {
      // A altura sai da MESMA conta do renderizador (mediaInfo), senão o
      // srcset apontaria pra um nome que não existe.
      const h = Math.round((H * PEQUENA) / W);
      const menor = await desenhaEm(bmp, PEQUENA, h);
      await sobe(`${base}-w${PEQUENA}h${h}.${grande.ext}`, menor.blob, menor.tipo);
    }
    if (bmp.close) bmp.close();
    return url;
  }
  function escolheArquivo() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp,image/gif,image/avif";
      input.addEventListener("change", () => resolve(input.files && input.files[0] ? input.files[0] : null));
      input.click();
    });
  }

  // ── Tela de escrever ─────────────────────────────────────────────────────
  async function abreEditor(id) {
    root.innerHTML = '<p class="empty-state">Carregando o post…</p>';
    let atual;
    if (id) {
      try {
        const linhas = await api(`/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=${COLUNAS}`);
        atual = linhas && linhas[0];
      } catch (e) {
        root.innerHTML = `<p class="empty-state">${esc(mensagemDeErro(e))}</p>`;
        return;
      }
      if (!atual) {
        root.innerHTML = '<div class="bed-gate"><h1>Post não encontrado</h1><p>Pode ter sido excluído.</p><button type="button" class="lst-mini" data-lista>Voltar pra lista</button></div>';
        root.querySelector("[data-lista]").addEventListener("click", () => vaiPara(""));
        return;
      }
    } else {
      atual = {
        id: null, slug: "", status: "draft", title: "", subtitle: "", excerpt: "", body_md: "", cover_url: "", cover_alt: "",
        game: "", category: "guias", tags: [], lang: "pt", featured: false, seo_title: "", seo_desc: "",
        author_name: eu.nome || "", published_at: null, updated_at: null
      };
    }
    montaEditor(atual);
  }

  function montaEditor(inicial) {
    let atual = inicial;                  // última versão SALVA (do banco)
    let post = Object.assign({}, inicial); // o que está no formulário
    post.tags = (post.tags || []).slice();
    // Endereço segue o título enquanto o post nunca foi ao ar e ninguém mexeu
    // nele à mão — depois disso, mudar o título não pode quebrar link.
    let slugAuto = !atual.published_at && (!atual.slug || atual.slug === B.slugify(atual.title));
    let salvando = false;
    const campos = (p) => JSON.stringify(CAMPOS.map((k) => (k === "tags" ? p.tags || [] : p[k] == null ? "" : p[k])));
    let base = campos(atual);
    const sujo = () => campos(post) !== base;
    // Listeners no document morrem junto com a tela (voltar pra lista e abrir
    // outro post não pode deixar o Ctrl+S do post anterior ligado).
    const vida = new AbortController();
    const noDoc = { signal: vida.signal };
    tela = { sujo, fim: () => vida.abort() };

    const stores = shared.createCrossGameStores();
    const cartas = new Map();   // "jogo/id" → dado pro renderizador, ou null (não existe)
    const pedindo = new Set();
    const falhou = new Map();   // ref → quando falhou (não martela a borda a cada tecla)

    const jogos = Object.keys(B.GAMES).map((g) => `<option value="${g}">${esc(B.GAMES[g][0])}</option>`).join("");
    const categorias = Object.keys(B.CATEGORIAS).map((c) => `<option value="${c}">${esc(B.CATEGORIAS[c].pt)}</option>`).join("");
    const FERRAMENTAS = [
      ["h2", "Título de seção", I.h2], ["h3", "Subtítulo", I.h3], ["b", "Negrito (Ctrl+B)", I.b], ["i", "Itálico (Ctrl+I)", I.i],
      ["link", "Link (Ctrl+K)", I.link], ["ul", "Lista", I.ul], ["ol", "Lista numerada", I.ol], ["quote", "Citação", I.quote], null,
      ["img", "Imagem", I.img], ["carta", "Cartas do catálogo", I.carta], ["caixa", "Caixa de destaque", I.caixa],
      ["tabela", "Tabela", I.tabela], ["linha", "Linha divisória", I.linha], null, ["ajuda", "Como formatar", I.ajuda]
    ];

    root.innerHTML = `
      <div class="bed-edit" data-tab="escrever">
        <div class="bed-bar">
          <button type="button" class="bed-icon-btn" data-voltar aria-label="Voltar pra lista de posts" title="Posts">${I.voltar}</button>
          <span data-pilula></span>
          <span class="bed-savestate" data-estado aria-live="polite"></span>
          <span class="bed-bar-gap"></span>
          <button type="button" class="lst-mini bed-wide" data-historico hidden>Histórico</button>
          <button type="button" class="lst-mini bed-wide" data-config-btn aria-expanded="false">${I.config}<span>Configurações</span></button>
          <button type="button" class="lst-mini bed-salvar" data-salvar>Salvar</button>
          <button type="button" class="cta bed-publicar" data-publicar>Publicar</button>
          <div class="bed-menu-wrap">
            <button type="button" class="bed-icon-btn" data-menu aria-haspopup="true" aria-expanded="false" aria-label="Mais ações">${I.menu}</button>
            <div class="bed-menu" data-menu-lista hidden>
              <a class="bed-menu-item" data-ver target="_blank" rel="noopener" hidden>${I.olho}<span>Ver no site</span></a>
              <button type="button" class="bed-menu-item bed-narrow" data-historico2 hidden>Histórico</button>
              <button type="button" class="bed-menu-item" data-despublicar hidden>Despublicar (volta a rascunho)</button>
              <button type="button" class="bed-menu-item bed-perigo" data-excluir hidden>Excluir post</button>
            </div>
          </div>
        </div>
        <div class="bed-aviso" data-aviso hidden></div>
        <div class="bed-tabs" role="tablist" aria-label="Partes do editor">
          <button type="button" role="tab" data-aba="escrever" aria-selected="true">Escrever</button>
          <button type="button" role="tab" data-aba="previa" aria-selected="false">Prévia</button>
          <button type="button" role="tab" data-aba="config" aria-selected="false">Configurações</button>
        </div>
        <div class="bed-body">
          <section class="bed-write" aria-label="Texto">
            <input class="bed-title" data-campo="title" maxlength="200" placeholder="Título do post" aria-label="Título">
            <input class="bed-subtitle" data-campo="subtitle" maxlength="300" placeholder="Linha fina: uma frase que complete o título (opcional)" aria-label="Linha fina">
            <div class="bed-toolbar" role="toolbar" aria-label="Formatação">
              ${FERRAMENTAS.map((f) => (f ? `<button type="button" class="bed-tool" data-tool="${f[0]}" title="${attr(f[1])}" aria-label="${attr(f[1])}">${f[2]}</button>` : '<span class="bed-tool-sep" aria-hidden="true"></span>')).join("")}
            </div>
            <textarea class="bed-text" data-campo="body_md" spellcheck="true" placeholder="Escreva aqui. Linha em branco separa parágrafos; os botões acima fazem títulos, listas, imagens e cartas." aria-label="Texto do post"></textarea>
            <p class="bed-foot"><span data-contagem></span><span class="bed-foot-dica">Solte ou cole imagens direto no texto.</span></p>
          </section>
          <section class="bed-preview" aria-label="Prévia">
            <div class="bed-preview-bar"><span>Prévia — é assim que vai pro ar</span><button type="button" class="lst-mini bed-wide" data-cheia>Tela cheia</button></div>
            <div class="bed-preview-scroll"><div class="blog-page blog-post-page"><div class="blog-post-root" data-previa></div></div></div>
          </section>
          <aside class="bed-config" aria-label="Configurações do post" data-config>
            <div class="bed-config-head"><h2>Configurações</h2><button type="button" class="bed-icon-btn bed-wide" data-config-fecha aria-label="Fechar configurações">${shared.CLOSE_ICON || "Fechar"}</button></div>

            <div class="bed-field">
              <label for="bedSlug">Endereço</label>
              <div class="bed-slug"><span>sleevu.app/blog/</span><input id="bedSlug" class="bed-input" data-campo="slug" maxlength="100" autocapitalize="off" spellcheck="false"></div>
              <p class="bed-hint" data-slug-hint></p>
            </div>

            <div class="bed-field">
              <label>Capa</label>
              <div class="bed-cover" data-capa></div>
              <div class="bed-row-btns">
                <button type="button" class="lst-mini" data-capa-sobe>Enviar imagem</button>
                <button type="button" class="lst-mini" data-capa-tira hidden>Remover</button>
              </div>
              <input class="bed-input" data-campo="cover_alt" maxlength="300" placeholder="Descrição da capa (pra leitor de tela e Google)" aria-label="Descrição da capa">
              <p class="bed-hint">Horizontal (16:9) fica melhor na lista e no link compartilhado.</p>
            </div>

            <div class="bed-field">
              <label for="bedExcerpt">Resumo</label>
              <textarea id="bedExcerpt" class="bed-input bed-area" data-campo="excerpt" maxlength="400" rows="3" placeholder="Vazio = usa o começo do texto."></textarea>
              <p class="bed-hint"><span data-conta="excerpt"></span> · aparece no cartão da lista e no Google quando o SEO está vazio.</p>
            </div>

            <div class="bed-grid2">
              <div class="bed-field"><label for="bedGame">Jogo</label><select id="bedGame" class="bed-input" data-campo="game"><option value="">Geral (vários jogos)</option>${jogos}</select></div>
              <div class="bed-field"><label for="bedCat">Categoria</label><select id="bedCat" class="bed-input" data-campo="category">${categorias}</select></div>
              <div class="bed-field"><label for="bedLang">Idioma do post</label><select id="bedLang" class="bed-input" data-campo="lang"><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option></select></div>
              <div class="bed-field"><label for="bedAutor">Autor</label><input id="bedAutor" class="bed-input" data-campo="author_name" maxlength="80"></div>
            </div>

            <div class="bed-field">
              <label for="bedTags">Assuntos</label>
              <input id="bedTags" class="bed-input" data-tags placeholder="vintage, investimento, base set" maxlength="400">
              <p class="bed-hint">Separados por vírgula (até 12). Viram etiquetas clicáveis no fim do post.</p>
            </div>

            <label class="bed-check"><input type="checkbox" data-campo="featured"><span>Destacar no topo do blog</span></label>

            <div class="bed-field">
              <label for="bedData">Data de publicação</label>
              <input id="bedData" type="datetime-local" class="bed-input" data-data>
              <p class="bed-hint">Vazio = na hora em que publicar. Data no futuro = o post fica agendado e aparece sozinho.</p>
            </div>

            <h3 class="bed-sub">Google e redes</h3>
            <div class="bed-field">
              <label for="bedSeoT">Título pro Google</label>
              <input id="bedSeoT" class="bed-input" data-campo="seo_title" maxlength="120" placeholder="Vazio = o título do post">
              <p class="bed-hint"><span data-conta="seo_title"></span> (até ~60 aparecem inteiros)</p>
            </div>
            <div class="bed-field">
              <label for="bedSeoD">Descrição pro Google</label>
              <textarea id="bedSeoD" class="bed-input bed-area" data-campo="seo_desc" maxlength="320" rows="3" placeholder="Vazio = o resumo"></textarea>
              <p class="bed-hint"><span data-conta="seo_desc"></span> (até ~160 aparecem inteiros)</p>
            </div>
            <div class="bed-serp" data-serp aria-label="Como aparece no Google"></div>
          </aside>
        </div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const ui = {
      edit: $(".bed-edit"), estado: $("[data-estado]"), pilula: $("[data-pilula]"), aviso: $("[data-aviso]"),
      salvar: $("[data-salvar]"), publicar: $("[data-publicar]"), ver: $("[data-ver]"), despublicar: $("[data-despublicar]"),
      excluir: $("[data-excluir]"), historico: $("[data-historico]"), historico2: $("[data-historico2]"),
      menu: $("[data-menu]"), menuLista: $("[data-menu-lista]"), texto: $(".bed-text"), previa: $("[data-previa]"),
      contagem: $("[data-contagem]"), capa: $("[data-capa]"), capaTira: $("[data-capa-tira]"), tags: $("[data-tags]"),
      data: $("[data-data]"), slugHint: $("[data-slug-hint]"), serp: $("[data-serp]"), configBtn: $("[data-config-btn]")
    };

    // ── formulário ⇄ post ──
    // Só escreve no campo o que MUDOU: reescrever o texto igual joga o cursor
    // pro fim (e o salvar roda enquanto a pessoa escreve).
    function preenche() {
      root.querySelectorAll("[data-campo]").forEach((el) => {
        const k = el.dataset.campo;
        if (el.type === "checkbox") { el.checked = !!post[k]; return; }
        const v = post[k] == null ? "" : String(post[k]);
        if (el.value !== v) el.value = v;
      });
      const tags = (post.tags || []).join(", ");
      if (document.activeElement !== ui.tags && ui.tags.value !== tags) ui.tags.value = tags;
      const data = isoParaLocal(post.published_at);
      if (ui.data.value !== data) ui.data.value = data;
      desenhaCapa();
      atualizaContadores();
    }
    function tagsDe(texto) {
      const out = [];
      String(texto || "").split(",").forEach((t) => {
        const v = t.trim().replace(/\s+/g, " ").slice(0, 30);
        if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase()) && out.length < 12) out.push(v);
      });
      return out;
    }
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset && el.dataset.campo) {
        const k = el.dataset.campo;
        post[k] = el.type === "checkbox" ? el.checked : el.value;
        if (k === "title" && slugAuto) {
          post.slug = B.slugify(post.title, 80);
          $("#bedSlug").value = post.slug;
        }
        if (k === "slug") slugAuto = false;
      } else if (el === ui.tags) {
        post.tags = tagsDe(el.value);
      } else if (el === ui.data) {
        post.published_at = localParaIso(el.value);
      } else return;
      mudou();
    });
    root.addEventListener("change", (ev) => {
      if (ev.target.type === "checkbox" && ev.target.dataset.campo) { post[ev.target.dataset.campo] = ev.target.checked; mudou(); }
      if (ev.target === ui.tags) ui.tags.value = post.tags.join(", ");
      if (ev.target.id === "bedSlug") {
        // Normaliza o que a pessoa digitou (acento, espaço, maiúscula).
        post.slug = B.slugify(post.slug, 100);
        ev.target.value = post.slug;
        mudou();
      }
    });

    function atualizaContadores() {
      root.querySelectorAll("[data-conta]").forEach((el) => {
        const k = el.dataset.conta;
        el.textContent = `${(post[k] || "").length} caracteres`;
      });
      const valido = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug || "") && post.slug.length >= 3;
      ui.slugHint.textContent = !post.slug ? "Escreva um título (ou um endereço) pra gerar o link."
        : !valido ? "Só letras minúsculas, números e hífen (mínimo 3)."
        : atual.published_at && atual.slug && post.slug !== atual.slug ? `Mudar o endereço de um post que já foi ao ar deixa o antigo (/blog/${atual.slug}) redirecionando pra este.`
        : slugAuto ? "Segue o título até você mexer nele." : "";
      ui.slugHint.classList.toggle("is-erro", !!post.slug && !valido);
      // Como aparece no Google.
      const tituloSerp = (post.seo_title || post.title || "Título do post").trim();
      const descSerp = (post.seo_desc || post.excerpt || B.resumo(post.body_md, 155) || "O começo do texto aparece aqui.").trim();
      ui.serp.innerHTML = `<span class="bed-serp-url">sleevu.app › blog › ${esc(post.slug || "…")}</span>`
        + `<span class="bed-serp-title">${esc(tituloSerp.length + 9 <= 65 ? tituloSerp + " | Sleevu" : tituloSerp)}</span>`
        + `<span class="bed-serp-desc">${esc(descSerp.length > 160 ? descSerp.slice(0, 157) + "…" : descSerp)}</span>`;
    }

    function desenhaCapa() {
      const url = B.safeImg(post.cover_url);
      ui.capa.innerHTML = url ? `<img src="${attr(url)}" alt="">` : '<span class="bed-cover-vazia">Sem capa</span>';
      ui.capaTira.hidden = !url;
    }

    // ── barra: situação, botões, "salvo às" ──
    function atualizaBarra() {
      const publicado = atual.status === "published";
      ui.pilula.innerHTML = atual.id ? pilula(atual) : '<span class="bed-pill bed-pill--rascunho">Novo</span>';
      const futuro = post.published_at && new Date(post.published_at) > new Date();
      ui.salvar.textContent = publicado ? "Salvar alterações" : "Salvar rascunho";
      ui.salvar.classList.toggle("cta", publicado);
      ui.salvar.classList.toggle("lst-mini", !publicado);
      ui.publicar.hidden = publicado;
      ui.publicar.textContent = futuro ? "Agendar" : "Publicar";
      const noAr = publicado && !(atual.published_at && new Date(atual.published_at) > new Date());
      ui.ver.hidden = !noAr;
      if (noAr) ui.ver.href = "/blog/" + atual.slug + "?fresco=1";
      ui.despublicar.hidden = !publicado;
      ui.excluir.hidden = !atual.id;
      ui.historico.hidden = !atual.id;
      ui.historico2.hidden = !atual.id;
      document.title = (post.title || "Novo post") + " · editor do blog";
    }
    function estado(texto, erro) {
      ui.estado.textContent = texto || "";
      ui.estado.classList.toggle("is-erro", !!erro);
    }
    function mostraAviso(html, tipo) {
      ui.aviso.innerHTML = html;
      ui.aviso.className = "bed-aviso" + (tipo ? " bed-aviso--" + tipo : "");
      ui.aviso.hidden = !html;
    }

    // ── rascunho no aparelho ──
    const guardaLocal = shared.debounce(() => {
      try {
        if (!sujo()) { localStorage.removeItem(LOCAL(atual.id)); return; }
        localStorage.setItem(LOCAL(atual.id), JSON.stringify({ em: Date.now(), base: atual.updated_at || null, post: CAMPOS.reduce((o, k) => { o[k] = post[k]; return o; }, {}) }));
      } catch (e) { /* armazenamento cheio/bloqueado: segue sem */ }
    }, 600);
    function ofereceRascunhoLocal() {
      let guardado = null;
      try { guardado = JSON.parse(localStorage.getItem(LOCAL(atual.id)) || "null"); } catch (e) { guardado = null; }
      if (!guardado || !guardado.post) return;
      const antes = campos(guardado.post) === base;
      if (antes) { try { localStorage.removeItem(LOCAL(atual.id)); } catch (e) { /* ignora */ } return; }
      const mudouNoSite = atual.id && guardado.base && guardado.base !== atual.updated_at;
      mostraAviso(`<span>Tem uma versão deste post guardada neste aparelho (${esc(fmtData(guardado.em))}) que não foi salva no site.${mudouNoSite ? " Atenção: o post foi salvo em outro lugar depois dela." : ""}</span>`
        + '<span class="bed-aviso-btns"><button type="button" class="lst-mini" data-recupera>Recuperar</button><button type="button" class="lst-mini" data-descarta>Descartar</button></span>', "info");
      ui.aviso.querySelector("[data-recupera]").addEventListener("click", () => {
        Object.assign(post, guardado.post);
        post.tags = (post.tags || []).slice();
        slugAuto = false;
        preenche();
        mostraAviso("");
        mudou();
      });
      ui.aviso.querySelector("[data-descarta]").addEventListener("click", () => {
        try { localStorage.removeItem(LOCAL(atual.id)); } catch (e) { /* ignora */ }
        mostraAviso("");
      });
    }

    // ── prévia ──
    function dadoDe(card) {
      const v = shared.cardValue(card, shared.defaultVariant(card), stores.prices, shared.DEFAULT_CONDITION);
      return { name: card.name, set: card.set, setId: card.setId, number: card.number, image: card.image,
        price: v && v.value > 0 ? (v.estimated ? "≈ " : "") + shared.formatMoney(v.currency, v.value) : "" };
    }
    async function buscaCartas(refs) {
      const agora = Date.now();
      const faltam = refs.filter((r) => !cartas.has(r) && !pedindo.has(r) && !(falhou.get(r) > agora - 30000));
      if (!faltam.length) return;
      faltam.forEach((r) => pedindo.add(r));
      const idsByGame = {};
      faltam.forEach((ref) => {
        const barra = ref.indexOf("/");
        const g = ref.slice(0, barra);
        if ((shared.GAME_SLUGS || []).includes(g)) (idsByGame[g] = idsByGame[g] || []).push(ref.slice(barra + 1));
        else cartas.set(ref, null);
      });
      try {
        const cat = Object.keys(idsByGame).length ? await shared.loadOwnedAcrossGames(idsByGame) : { cards: [] };
        const achadas = new Map(((cat && cat.cards) || []).map((c) => [c.game + "/" + c.id, c]));
        faltam.forEach((ref) => {
          const c = achadas.get(ref);
          if (c) { stores.cardGameMap.set(c.id, c.game); cartas.set(ref, dadoDe(c)); } else if (!cartas.has(ref)) cartas.set(ref, null);
        });
      } catch (e) {
        faltam.forEach((r) => falhou.set(r, Date.now()));
      } finally {
        faltam.forEach((r) => pedindo.delete(r));
      }
      desenhaPrevia();
    }
    const desenhaPrevia = shared.debounce(() => {
      const card = (ref) => cartas.get(ref) || null;
      const r = B.render(post.body_md, { lang: post.lang, editor: true, card });
      const comoVaiAoAr = Object.assign({}, post, {
        slug: post.slug || "rascunho",
        published_at: post.published_at || atual.published_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reading_min: r.minutes
      });
      ui.previa.innerHTML = B.paginaDoPostHtml(comoVaiAoAr, r, { card });
      ui.contagem.textContent = `${r.words} ${r.words === 1 ? "palavra" : "palavras"} · ${r.minutes} min de leitura`;
      buscaCartas(r.refs);
    }, 180);
    // Link dentro da prévia não navega (sairia do editor): âncora rola a
    // prévia até a seção — à mão, porque mudar o #hash dispararia o popstate
    // do roteador —, e link de fora abre em outra aba.
    ui.previa.addEventListener("click", (ev) => {
      const a = ev.target.closest("a, button");
      if (!a) return;
      ev.preventDefault();
      const href = a.getAttribute("href") || "";
      const ancora = /#([\w-]+)$/.exec(href);
      if (a.tagName === "A" && href.startsWith("#") && ancora) {
        const alvo = ui.previa.querySelector("#" + CSS.escape(ancora[1]));
        if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (a.tagName === "A" && /^https?:\/\//.test(href) && !a.hasAttribute("data-blog-card")) window.open(href, "_blank", "noopener");
    });
    document.addEventListener("sleevu:fx-updated", () => { cartas.clear(); desenhaPrevia(); }, noDoc);

    function mudou() {
      atualizaContadores();
      atualizaBarra();
      desenhaPrevia();
      guardaLocal();
      if (!salvando) estado(sujo() ? "Alterações não salvas" : "");
    }

    // ── abas (celular), configurações (desktop), tela cheia ──
    root.querySelector(".bed-tabs").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-aba]");
      if (!b) return;
      ui.edit.dataset.tab = b.dataset.aba;
      root.querySelectorAll("[data-aba]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      window.scrollTo(0, 0);
    });
    function config(abre) {
      ui.edit.classList.toggle("is-config", abre);
      ui.configBtn.setAttribute("aria-expanded", String(abre));
    }
    ui.configBtn.addEventListener("click", () => config(!ui.edit.classList.contains("is-config")));
    $("[data-config-fecha]").addEventListener("click", () => config(false));
    $("[data-cheia]").addEventListener("click", (ev) => {
      const cheia = ui.edit.classList.toggle("is-cheia");
      ev.currentTarget.textContent = cheia ? "Voltar a escrever" : "Tela cheia";
    });
    ui.menu.addEventListener("click", () => {
      const abre = ui.menuLista.hidden;
      ui.menuLista.hidden = !abre;
      ui.menu.setAttribute("aria-expanded", String(abre));
    });
    document.addEventListener("click", (ev) => {
      if (!ui.menuLista.hidden && !ev.target.closest(".bed-menu-wrap")) { ui.menuLista.hidden = true; ui.menu.setAttribute("aria-expanded", "false"); }
    }, noDoc);
    $("[data-voltar]").addEventListener("click", () => vaiPara(""));

    // ── texto: operações dos botões ──
    const ta = ui.texto;
    // execCommand("insertText") mantém o Ctrl+Z nativo do campo; setRangeText
    // é o plano B (e aí o input é disparado à mão).
    function troca(inicio, fim, texto, selIni, selFim) {
      ta.focus();
      ta.setSelectionRange(inicio, fim);
      let foi = false;
      try { foi = document.execCommand("insertText", false, texto); } catch (e) { foi = false; }
      if (!foi) {
        ta.setRangeText(texto, inicio, fim, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (selIni != null) ta.setSelectionRange(selIni, selFim == null ? selIni : selFim);
    }
    function envolve(antes, depois, exemplo) {
      const a = ta.selectionStart, b = ta.selectionEnd;
      const sel = ta.value.slice(a, b) || exemplo;
      troca(a, b, antes + sel + depois, a + antes.length, a + antes.length + sel.length);
    }
    // Prefixo em cada linha da seleção; se TODAS já têm, tira (liga/desliga).
    function prefixa(prefixo, numerada) {
      const v = ta.value;
      const ini = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
      let fim = v.indexOf("\n", ta.selectionEnd);
      if (fim < 0) fim = v.length;
      const linhas = v.slice(ini, fim).split("\n");
      const re = numerada ? /^\d+[.)]\s+/ : new RegExp("^" + prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const todas = linhas.every((l) => re.test(l));
      const novas = linhas.map((l, k) => {
        if (todas) return l.replace(re, "");
        const limpa = /^#{1,6}\s/.test(prefixo) ? l.replace(/^#{1,6}\s+/, "") : l;
        return (numerada ? (k + 1) + ". " : prefixo) + limpa;
      });
      const texto = novas.join("\n");
      troca(ini, fim, texto, ini + texto.length);
    }
    // Bloco sozinho entre linhas em branco (é assim que o renderizador o reconhece).
    function bloco(texto, selecionar) {
      const v = ta.value;
      const a = ta.selectionStart, b = ta.selectionEnd;
      const antes = v.slice(0, a), depois = v.slice(b);
      const pre = !antes ? "" : antes.endsWith("\n\n") ? "" : antes.endsWith("\n") ? "\n" : "\n\n";
      const pos = !depois ? "\n" : depois.startsWith("\n\n") ? "" : depois.startsWith("\n") ? "\n" : "\n\n";
      const inicio = a + pre.length;
      troca(a, b, pre + texto + pos, selecionar ? inicio + selecionar[0] : inicio + texto.length, selecionar ? inicio + selecionar[1] : undefined);
    }
    async function link() {
      const a = ta.selectionStart, b = ta.selectionEnd;
      const sel = ta.value.slice(a, b);
      const url = await shared.caixaDeTexto({ titulo: "Endereço do link", placeholder: "https://… ou /sets", ok: "Inserir" });
      if (!url || !url.trim()) { ta.focus(); return; }
      const limpo = url.trim();
      if (!B.safeHref(limpo)) { estado("Endereço de link inválido (use https://… ou um caminho do site, como /sets).", true); ta.focus(); return; }
      const texto = sel || "texto do link";
      troca(a, b, `[${texto}](${limpo})`, a + 1, a + 1 + texto.length);
    }

    const ACOES = {
      h2: () => prefixa("## "), h3: () => prefixa("### "), b: () => envolve("**", "**", "negrito"), i: () => envolve("*", "*", "itálico"),
      link, ul: () => prefixa("- "), ol: () => prefixa("", true), quote: () => prefixa("> "),
      img: () => imagemNoTexto(), carta: () => seletorDeCartas(),
      caixa: () => bloco(":::dica Título da dica\nTexto da dica.\n:::", [8, 23]),
      tabela: () => bloco("| Carta | Set | Preço |\n|---|---|---:|\n| Charizard | Base Set | US$ 350 |", [2, 7]),
      linha: () => bloco("---"), ajuda: () => ajuda()
    };
    $(".bed-toolbar").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-tool]");
      if (b && ACOES[b.dataset.tool]) ACOES[b.dataset.tool]();
    });
    ta.addEventListener("keydown", (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && !ev.shiftKey && !ev.altKey) {
        const k = ev.key.toLowerCase();
        if (k === "b") { ev.preventDefault(); ACOES.b(); return; }
        if (k === "i") { ev.preventDefault(); ACOES.i(); return; }
        if (k === "k") { ev.preventDefault(); link(); return; }
      }
      // Enter numa linha de lista continua a lista; Enter no item vazio a encerra.
      if (ev.key === "Enter" && !ev.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
        const v = ta.value, pos = ta.selectionStart;
        const ini = v.lastIndexOf("\n", pos - 1) + 1;
        const linha = v.slice(ini, pos);
        const m = /^(\s*)([-*+]|\d+[.)]|>)\s+(.*)$/.exec(linha);
        if (!m) return;
        ev.preventDefault();
        if (!m[3].trim()) { troca(ini, pos, "", ini); return; }
        const marca = /^\d+/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].slice(-1) : m[2];
        troca(pos, pos, "\n" + m[1] + marca + " ");
      }
    });
    document.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); salva(); }
    }, noDoc);

    // Imagem solta ou colada no texto sobe e entra no ponto do cursor.
    ta.addEventListener("dragover", (ev) => { if (ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
    ta.addEventListener("drop", (ev) => {
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!f || !/^image\//.test(f.type)) return;
      ev.preventDefault();
      imagemNoTexto(f);
    });
    ta.addEventListener("paste", (ev) => {
      const item = ev.clipboardData && [...ev.clipboardData.items].find((i) => i.kind === "file" && /^image\//.test(i.type));
      if (!item) return;
      ev.preventDefault();
      imagemNoTexto(item.getAsFile());
    });

    async function imagemNoTexto(arquivoDado) {
      const arquivo = arquivoDado || await escolheArquivo();
      if (!arquivo) return;
      const posicao = [ta.selectionStart, ta.selectionEnd];
      estado("Enviando imagem…");
      let url;
      try { url = await enviaImagem(arquivo); } catch (e) { estado(e.status ? mensagemDeErro(e) : e.message, true); return; }
      estado("");
      dialogo({
        titulo: "Imagem",
        classe: "bed-dlg",
        corpo: `<img class="bed-dlg-img" src="${attr(url)}" alt="">
          <label class="bed-field"><span>Descrição (pra quem usa leitor de tela e pro Google)</span><input class="bed-input" data-alt maxlength="200" placeholder="Ex.: Charizard do Base Set em slab PSA 10"></label>
          <label class="bed-field"><span>Legenda (opcional)</span><input class="bed-input" data-leg maxlength="200" placeholder="Aparece embaixo da imagem"></label>
          <div class="list-modal-foot"><button type="button" class="cta" data-insere>Inserir</button><button type="button" class="lst-mini" data-fecha>Cancelar</button></div>`,
        aoAbrir: (box, fecha) => {
          setTimeout(() => box.querySelector("[data-alt]").focus(), 30);
          box.querySelector("[data-insere]").addEventListener("click", () => {
            const alt = box.querySelector("[data-alt]").value.trim().replace(/[[\]]/g, "");
            const leg = box.querySelector("[data-leg]").value.trim().replace(/"/g, "”");
            fecha();
            ta.setSelectionRange(posicao[0], posicao[1]);
            bloco(`![${alt}](${url}${leg ? ` "${leg}"` : ""})`);
          });
        }
      });
    }

    $("[data-capa-sobe]").addEventListener("click", async () => {
      const arquivo = await escolheArquivo();
      if (!arquivo) return;
      estado("Enviando a capa…");
      try {
        post.cover_url = await enviaImagem(arquivo);
        desenhaCapa();
        estado("");
        mudou();
      } catch (e) { estado(e.status ? mensagemDeErro(e) : e.message, true); }
    });
    ui.capaTira.addEventListener("click", () => { post.cover_url = ""; desenhaCapa(); mudou(); });

    // ── cartas do catálogo ──
    function seletorDeCartas() {
      const posicao = [ta.selectionStart, ta.selectionEnd];
      const escolhidas = [];
      const opcoesJogo = '<option value="all">Todos os jogos</option>' + Object.keys(B.GAMES).map((g) => `<option value="${g}"${post.game === g ? " selected" : ""}>${esc(B.GAMES[g][0])}</option>`).join("");
      dialogo({
        titulo: "Cartas do catálogo",
        classe: "bed-dlg bed-picker",
        corpo: `<div class="bed-picker-search">
            <input type="search" class="bed-input" data-q placeholder="Nome, set ou código (ex.: Charizard 4/102)" aria-label="Buscar carta">
            <select class="bed-input" data-g aria-label="Jogo">${opcoesJogo}</select>
          </div>
          <div class="bed-picker-results" data-res aria-live="polite"><p class="bed-hint">Digite pelo menos 2 letras. Toque nas cartas pra escolher (dá pra escolher várias).</p></div>
          <div class="list-modal-foot bed-picker-foot">
            <span class="bed-hint" data-n>Nenhuma escolhida</span>
            <button type="button" class="lst-mini" data-grade disabled>Inserir em grade</button>
            <button type="button" class="cta" data-uma disabled>Inserir em destaque</button>
          </div>`,
        aoAbrir: (box, fecha) => {
          const q = box.querySelector("[data-q]"), g = box.querySelector("[data-g]"), res = box.querySelector("[data-res]");
          const n = box.querySelector("[data-n]"), grade = box.querySelector("[data-grade]"), uma = box.querySelector("[data-uma]");
          setTimeout(() => q.focus(), 30);
          const atualizaPe = () => {
            n.textContent = escolhidas.length ? `${escolhidas.length} escolhida${escolhidas.length > 1 ? "s" : ""}` : "Nenhuma escolhida";
            grade.disabled = !escolhidas.length;
            uma.disabled = !escolhidas.length;
            uma.textContent = escolhidas.length > 1 ? "Inserir em destaque (uma embaixo da outra)" : "Inserir em destaque";
          };
          let pedido = 0;
          const busca = shared.debounce(async () => {
            const termo = q.value.trim();
            const meu = ++pedido;
            if (B.REF_RE.test(termo)) {
              res.innerHTML = `<button type="button" class="bed-pick" data-ref="${attr(termo)}" aria-pressed="${escolhidas.includes(termo)}"><span class="bed-pick-name">Usar o código ${esc(termo)}</span></button>`;
              return;
            }
            if (termo.length < 2) { res.innerHTML = '<p class="bed-hint">Digite pelo menos 2 letras.</p>'; return; }
            res.innerHTML = '<p class="bed-hint">Buscando…</p>';
            let corpo = null;
            try {
              const r = await fetch(`/api/search?game=${encodeURIComponent(g.value)}&q=${encodeURIComponent(termo)}&limit=36&img=1`);
              corpo = r.ok ? await r.json() : null;
            } catch (e) { corpo = null; }
            if (meu !== pedido) return;
            if (!corpo || !Array.isArray(corpo.c)) {
              res.innerHTML = '<p class="bed-hint">A busca de cartas não respondeu agora (fora do site publicado ela não existe). Dá pra colar o código no formato jogo/id, ex.: pokemon/base1-4.</p>';
              return;
            }
            if (!corpo.c.length) { res.innerHTML = '<p class="bed-hint">Nenhuma carta com esse nome.</p>'; return; }
            res.innerHTML = corpo.c.map((c) => {
              const ref = `${c.g}/${c.i}`;
              if (!B.REF_RE.test(ref)) return "";
              const img = B.imagemDeCarta(c.m, true);
              return `<button type="button" class="bed-pick" data-ref="${attr(ref)}" aria-pressed="${escolhidas.includes(ref)}">
                <span class="bed-pick-img">${img.src ? `<img src="${attr(img.src)}" alt="" loading="lazy">` : ""}</span>
                <span class="bed-pick-name">${esc(c.n)}</span>
                <span class="bed-pick-meta">${esc([c.s, c.u].filter(Boolean).join(" · "))}</span>
                ${B.etiquetaJogo(c.g)}
                <span class="bed-pick-check" aria-hidden="true">${I.check}</span>
              </button>`;
            }).join("");
          }, 280);
          q.addEventListener("input", busca);
          g.addEventListener("change", busca);
          res.addEventListener("click", (ev) => {
            const b = ev.target.closest("[data-ref]");
            if (!b) return;
            const ref = b.dataset.ref;
            const k = escolhidas.indexOf(ref);
            if (k >= 0) escolhidas.splice(k, 1); else escolhidas.push(ref);
            b.setAttribute("aria-pressed", String(k < 0));
            atualizaPe();
          });
          const insere = (texto) => { fecha(); ta.setSelectionRange(posicao[0], posicao[1]); bloco(texto); };
          uma.addEventListener("click", () => insere(escolhidas.map((r) => `::card[${r}]`).join("\n\n")));
          grade.addEventListener("click", () => insere(`::cards[${escolhidas.join(", ")}]`));
        }
      });
    }

    function ajuda() {
      const linhas = [
        ["## Título de seção", "Título grande (entra no índice do post)"],
        ["### Subtítulo", "Título menor, dentro da seção"],
        ["**negrito**  *itálico*  ~~riscado~~", "Destaques no meio do texto"],
        ["[texto](https://…)", "Link (endereço do site: /sets, /decks…)"],
        ["- item", "Lista (2 espaços antes = sub-item)"],
        ["1. item", "Lista numerada"],
        ["> frase", "Citação"],
        ["![descrição](url \"legenda\")", "Imagem (o botão de imagem já escreve isto)"],
        ["::card[pokemon/base1-4]", "Uma carta em destaque, com imagem e preço atualizado"],
        ["::cards[pokemon/base1-4, pokemon/base1-2]", "Grade de cartas"],
        [":::dica Título\ntexto\n:::", "Caixa de destaque (também :::info e :::alerta)"],
        ["| a | b |\n|---|---|\n| 1 | 2 |", "Tabela"],
        ["---", "Linha divisória"]
      ];
      dialogo({
        titulo: "Como formatar",
        classe: "bed-dlg bed-ajuda",
        corpo: `<p class="bed-hint">Linha em branco separa parágrafos; Enter simples quebra a linha. Os botões da barra escrevem tudo isso por você.</p>
          <dl class="bed-ajuda-lista">${linhas.map(([cod, o]) => `<div><dt><code>${esc(cod).replace(/\n/g, "<br>")}</code></dt><dd>${esc(o)}</dd></div>`).join("")}</dl>`
      });
    }

    // ── histórico ──
    async function historico() {
      ui.menuLista.hidden = true;
      if (!atual.id) return;
      dialogo({
        titulo: "Versões anteriores",
        classe: "bed-dlg",
        corpo: '<p class="bed-hint">Cada salvamento guarda a versão ANTERIOR do título e do texto (as 40 mais novas). Carregar uma versão só muda o editor — nada vai pro ar até você salvar.</p><div class="bed-revs" data-revs><p class="bed-hint">Carregando…</p></div>',
        aoAbrir: async (box, fecha) => {
          const alvo = box.querySelector("[data-revs]");
          let revs = [];
          try { revs = (await api(`/rest/v1/post_revisions?post_id=eq.${encodeURIComponent(atual.id)}&select=id,saved_at,title&order=saved_at.desc&limit=40`)) || []; } catch (e) {
            alvo.innerHTML = `<p class="bed-hint">${esc(mensagemDeErro(e))}</p>`;
            return;
          }
          if (!revs.length) { alvo.innerHTML = '<p class="bed-hint">Ainda não há versões anteriores (elas aparecem a partir do segundo salvamento).</p>'; return; }
          alvo.innerHTML = revs.map((r) => `<button type="button" class="bed-rev" data-rev="${attr(r.id)}"><strong>${esc(fmtData(r.saved_at))}</strong><span>${esc(r.title || "(sem título)")}</span></button>`).join("");
          alvo.addEventListener("click", async (ev) => {
            const b = ev.target.closest("[data-rev]");
            if (!b) return;
            try {
              const [rev] = await api(`/rest/v1/post_revisions?id=eq.${encodeURIComponent(b.dataset.rev)}&select=title,body_md`);
              if (!rev) return;
              post.title = rev.title;
              post.body_md = rev.body_md;
              fecha();
              preenche();
              mudou();
              estado("Versão carregada no editor — salve pra valer no site.");
            } catch (e) { alvo.insertAdjacentHTML("afterbegin", `<p class="bed-hint is-erro">${esc(mensagemDeErro(e))}</p>`); }
          });
        }
      });
    }
    ui.historico.addEventListener("click", historico);
    ui.historico2.addEventListener("click", historico);

    // ── salvar / publicar / despublicar / excluir ──
    function corpoPraSalvar(p) {
      const c = {};
      CAMPOS.forEach((k) => { c[k] = p[k]; });
      c.tags = (p.tags || []).slice(0, 12);
      c.featured = !!p.featured;
      c.published_at = p.published_at || null;
      ["title", "subtitle", "excerpt", "cover_alt", "seo_title", "seo_desc", "author_name"].forEach((k) => { c[k] = String(c[k] || "").trim(); });
      c.cover_url = B.safeImg(p.cover_url) || "";
      return c;
    }
    async function salva(opcoes) {
      if (salvando) return;
      const o = opcoes || {};
      const alvo = Object.assign({}, post, o.status ? { status: o.status } : {});
      if (!alvo.slug) alvo.slug = B.slugify(alvo.title, 80);
      if (!alvo.slug || alvo.slug.length < 3) {
        // Sem título ainda: um endereço provisório, só pra dar pra salvar o rascunho.
        alvo.slug = "rascunho-" + Array.from(crypto.getRandomValues(new Uint8Array(3))).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(alvo.slug)) { estado("Endereço inválido: só letras minúsculas, números e hífen.", true); return; }
      if (alvo.status === "published" && !alvo.title.trim()) { estado("Dê um título antes de publicar.", true); return; }
      if (alvo.status === "published" && /^rascunho-[0-9a-f]{6}$/.test(alvo.slug)) { estado("Troque o endereço provisório antes de publicar (Configurações › Endereço).", true); return; }
      if (!String(alvo.excerpt || "").trim()) alvo.excerpt = B.resumo(alvo.body_md, 180);
      const corpo = corpoPraSalvar(alvo);
      // O que estava no formulário quando o salvar saiu: o que a pessoa mudar
      // DURANTE a gravação não pode ser atropelado pela resposta do banco.
      const noInicio = JSON.parse(JSON.stringify(post));

      salvando = true;
      estado("Salvando…");
      ui.salvar.disabled = ui.publicar.disabled = true;
      try {
        let linhas;
        if (!atual.id) {
          linhas = await api(`/rest/v1/posts?select=${COLUNAS}`, { method: "POST", body: JSON.stringify(corpo), headers: { Prefer: "return=representation" } });
        } else {
          // Trava otimista: só grava se o post ainda é a versão que abrimos.
          // Outra aba (ou outra pessoa) salvou no meio? Zero linhas → pergunta.
          const trava = o.porCima || !atual.updated_at ? "" : "&updated_at=eq." + encodeURIComponent(atual.updated_at);
          linhas = await api(`/rest/v1/posts?id=eq.${encodeURIComponent(atual.id)}${trava}&select=${COLUNAS}`, { method: "PATCH", body: JSON.stringify(corpo), headers: { Prefer: "return=representation" } });
          if (Array.isArray(linhas) && !linhas.length) { conflito(o); return; }
        }
        const salvo = linhas && linhas[0];
        if (!salvo) throw new Error("o banco não devolveu o post salvo");
        const eraNovo = !atual.id;
        try { localStorage.removeItem(LOCAL(atual.id)); } catch (e) { /* ignora */ }
        atual = salvo;
        const novo = Object.assign({}, salvo);
        novo.tags = (novo.tags || []).slice();
        CAMPOS.forEach((k) => { if (JSON.stringify(post[k]) !== JSON.stringify(noInicio[k])) novo[k] = post[k]; });
        post = novo;
        base = campos(atual);
        if (eraNovo) {
          history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(salvo.id));
          urlAberta = location.pathname + location.search;
        }
        preenche();
        atualizaBarra();
        desenhaPrevia();
        mostraAviso("");
        const e = estadoDo(salvo);
        if (o.status === "published") {
          mostraAviso(e.chave === "agendado"
            ? `<span>Agendado: aparece no blog em ${esc(fmtData(salvo.published_at))}.</span>`
            : `<span>Publicado! Já está no ar.</span><a class="lst-mini" href="/blog/${attr(salvo.slug)}?fresco=1" target="_blank" rel="noopener">Ver no site</a>`, "ok");
        }
        estado("Salvo às " + hora());
      } catch (e) {
        estado(mensagemDeErro(e), true);
      } finally {
        salvando = false;
        ui.salvar.disabled = ui.publicar.disabled = false;
      }
    }
    function conflito(o) {
      salvando = false;
      ui.salvar.disabled = ui.publicar.disabled = false;
      estado("");
      mostraAviso('<span>Este post foi salvo em outro lugar (outra aba ou outra pessoa) depois que você abriu. O seu texto está guardado neste aparelho.</span>'
        + '<span class="bed-aviso-btns"><button type="button" class="lst-mini" data-recarrega>Abrir a versão salva</button><button type="button" class="lst-mini" data-porcima>Salvar por cima</button></span>', "erro");
      ui.aviso.querySelector("[data-recarrega]").addEventListener("click", () => { vida.abort(); tela = null; abreEditor(atual.id); });
      ui.aviso.querySelector("[data-porcima]").addEventListener("click", () => salva(Object.assign({}, o, { porCima: true })));
    }
    ui.salvar.addEventListener("click", () => salva());
    ui.publicar.addEventListener("click", () => salva({ status: "published" }));
    ui.despublicar.addEventListener("click", () => {
      ui.menuLista.hidden = true;
      if (window.confirm("Tirar o post do ar? Ele volta a ser rascunho (o endereço passa a dar 'não encontrado').")) salva({ status: "draft" });
    });
    ui.excluir.addEventListener("click", async () => {
      ui.menuLista.hidden = true;
      if (!atual.id || !window.confirm(`Excluir "${atual.title || atual.slug}" de vez? O histórico de versões vai junto e não dá pra desfazer.`)) return;
      try {
        await api(`/rest/v1/posts?id=eq.${encodeURIComponent(atual.id)}`, { method: "DELETE" });
        try { localStorage.removeItem(LOCAL(atual.id)); } catch (e) { /* ignora */ }
        vida.abort();
        tela = null;
        vaiPara("");
      } catch (e) { estado(mensagemDeErro(e), true); }
    });

    preenche();
    atualizaBarra();
    desenhaPrevia();
    ofereceRascunhoLocal();
    if (!atual.id) setTimeout(() => $(".bed-title").focus(), 30);
  }

  inicia();
})();
