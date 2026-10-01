// Blog do Sleevu: Markdown enxuto → HTML seguro, mais os pedaços de página que
// a borda e o editor precisam desenhar IGUAL (cabeçalho do artigo, carta
// embutida, cartão da lista).
//
// UM arquivo, dois lugares — é o que garante que a prévia do editor é a página
// que vai pro ar:
//   - no navegador, <script src="src/blog-render.js"> (páginas do blog e editor);
//   - na borda, functions/blog/*.js fazem `import "../../src/blog-render.js"` e
//     leem globalThis.SleevuBlog. Por isso isto é um script clássico que só
//     pendura um objeto no globalThis: nada de DOM, de window nem do shared.js.
//     No deploy o hash-assets renomeia o arquivo e reescreve o import das
//     Functions junto (ver o passo 5 dele) — um caminho que escapasse viraria
//     erro no bundle do wrangler, não página quebrada calada.
//
// SEGURANÇA: o texto do post nunca vira HTML cru. Tudo sai escapado e só a
// sintaxe abaixo gera tag; link só http(s)/mailto/caminho do site, imagem só de
// host liberado na CSP. Quem escreve é editor de confiança, mas conta vaza — o
// post não pode ser porta de XSS pro site inteiro (tests/blog-render.test.mjs).
//
// SINTAXE (é o que os botões do editor escrevem):
//   ## Título   ### Subtítulo   #### Menor    (# vira ##: o H1 é o título do post)
//   **negrito**  *itálico*  _itálico_  ~~riscado~~  `código`  [texto](url)
//   - lista    1. numerada    (sub-item: 2 espaços antes)    > citação    ---
//   ![descrição](url "legenda")                   imagem, sozinha na linha
//   ::card[pokemon/base1-4]                       uma carta em destaque
//   ::cards[pokemon/base1-4, pokemon/base1-2]     grade de cartas
//   :::dica Título opcional  …  :::               caixa (dica, info, alerta)
//   | a | b |  e  |---|---|                       tabela
//   ``` … ```                                     bloco de código
// Enter simples dentro de um parágrafo é quebra de linha (é o que quem escreve
// num editor de blog espera); linha em branco separa parágrafos.
(function (root) {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]); }

  const SITE = "https://sleevu.app";
  // Supabase do site: endereço e chave PUBLICÁVEL (pública por natureza — quem
  // protege é a RLS). Os mesmos do shared.js, que não os exporta; moram aqui
  // porque as páginas do blog e as Functions já carregam este arquivo, e
  // exportar do shared.js engordaria o núcleo de TODA página (o check-size
  // estourou por 16 bytes quando eram funções lá). O teste trava as cópias.
  const SUPABASE_HOST = "dlnalopazitfdgnmdguu.supabase.co";
  const SUPABASE_URL = "https://" + SUPABASE_HOST;
  const SUPABASE_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";

  // Hosts de imagem aceitos no corpo, na capa e nas cartas: os do img-src da
  // CSP (_headers) mais o próprio site. Imagem de outro host a CSP bloquearia
  // em produção — aqui ela nem vira tag, e o editor avisa na prévia. O teste
  // confere esta lista contra o _headers.
  const IMG_HOSTS = [
    "sleevu.app", "img.sleevu.app", "assets.tcgdex.net", "images.pokemontcg.io",
    "raw.githubusercontent.com", "tcgplayer-cdn.tcgplayer.com", "cards.lorcast.io",
    "cards.scryfall.io", "svgs.scryfall.io", "wsrv.nl", SUPABASE_HOST
  ];

  // Jogos: rótulo e cor, os MESMOS do shared.js (GAME_COLOR + filter.game*).
  // Repetidos aqui porque a borda não tem o shared.js; o teste trava as duas
  // cópias juntas — jogo novo no shared.js sem entrar aqui quebra o CI.
  const GAMES = {
    pokemon: ["Pokémon", "#e23030"],
    lorcana: ["Lorcana", "#3f3d96"],
    onepiece: ["One Piece", "#d9a400"],
    magic: ["Magic", "#7a4a2b"],
    fab: ["Flesh and Blood", "#a34a5e"],
    gundam: ["Gundam", "#2563eb"],
    swu: ["Star Wars", "#000000"],
    cyberpunk: ["Cyberpunk", "#fcee0a"],
    sorcery: ["Sorcery", "#c9a66b"],
    dbfw: ["Dragon Ball Fusion", "#9aa3ae"],
    ygo: ["Yu-Gi-Oh!", "#7c3aed"],
    digimon: ["Digimon", "#123f6d"],
    riftbound: ["Riftbound", "#a67c00"],
    unionarena: ["Union Arena", "#0891b2"],
    naruto: ["Naruto", "#ea580c"],
    hxh: ["Hunter × Hunter", "#15803d"],
    dbc: ["Dragon Ball Carddass", "#db2777"],
    wow: ["WoW TCG", "#00aeff"],
    lotr: ["LOTR", "#4d7c0f"],
    harrypotter: ["Harry Potter", "#740001"]
  };

  // Categorias do blog. O banco só confere o formato (a lista mora aqui), então
  // categoria nova é uma linha nesta tabela, sem migração.
  const CATEGORIAS = {
    guias: { pt: "Guias", en: "Guides", es: "Guías" },
    mercado: { pt: "Mercado & Preços", en: "Market & Prices", es: "Mercado y precios" },
    lancamentos: { pt: "Lançamentos", en: "New Releases", es: "Lanzamientos" },
    historia: { pt: "História & Vintage", en: "History & Vintage", es: "Historia y vintage" },
    noticias: { pt: "Notícias", en: "News", es: "Noticias" }
  };

  // Rótulos do ARTIGO, no idioma do post (não no da interface): "min de
  // leitura" faz parte do texto que a borda entrega pronto. O resto da tela
  // (menu, filtros, botões) passa pelo i18n de sempre (src/i18n-blog.js).
  const ROTULOS = {
    pt: {
      blog: "Blog", por: "Por", min: "min de leitura", atualizado: "Atualizado em", indice: "Neste artigo", trilha: "Trilha de navegação",
      semCarta: "Carta não encontrada", imagemBloqueada: "Imagem de endereço não permitido", cartas: "Cartas neste artigo",
      compartilhar: "Compartilhar", copiar: "Copiar link", leiaTambem: "Leia também", tags: "Assuntos",
      ctaTitulo: "Sua coleção, organizada", ctaTexto: "Marque as cartas que você tem, acompanhe o valor e monte sua lista de desejos no Sleevu. É grátis.",
      ctaBotao: "Criar minha conta", locale: "pt-BR"
    },
    en: {
      blog: "Blog", por: "By", min: "min read", atualizado: "Updated", indice: "In this article", trilha: "Breadcrumb",
      semCarta: "Card not found", imagemBloqueada: "Image from a blocked address", cartas: "Cards in this article",
      compartilhar: "Share", copiar: "Copy link", leiaTambem: "Keep reading", tags: "Topics",
      ctaTitulo: "Your collection, organized", ctaTexto: "Track the cards you own, follow their value and build your wishlist on Sleevu. It's free.",
      ctaBotao: "Create my account", locale: "en-US"
    },
    es: {
      blog: "Blog", por: "Por", min: "min de lectura", atualizado: "Actualizado el", indice: "En este artículo", trilha: "Ruta de navegación",
      semCarta: "Carta no encontrada", imagemBloqueada: "Imagen de una dirección no permitida", cartas: "Cartas en este artículo",
      compartilhar: "Compartir", copiar: "Copiar enlace", leiaTambem: "Sigue leyendo", tags: "Temas",
      ctaTitulo: "Tu colección, organizada", ctaTexto: "Marca las cartas que tienes, sigue su valor y arma tu lista de deseos en Sleevu. Es gratis.",
      ctaBotao: "Crear mi cuenta", locale: "es-ES"
    }
  };
  const rotulos = (lang) => ROTULOS[lang] || ROTULOS.pt;

  // ── URLs ─────────────────────────────────────────────────────────────────
  // Caractere de controle em URL é sempre truque (quebra de linha no meio de
  // "java\nscript:" etc.). Conferido por código pra não depender de escape
  // unicode no fonte.
  function temControle(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 32 || c === 127) return true;
    }
    return false;
  }
  function urlLimpa(url) {
    const u = String(url == null ? "" : url).trim();
    if (!u || u.length > 2000 || temControle(u) || /[\s<>"'`\\]/.test(u)) return "";
    return u;
  }
  // Link: http(s), mailto, caminho do site (/x, nunca //host) ou âncora (#x).
  // Qualquer outro esquema (javascript:, data:, vbscript:…) vira texto puro.
  function safeHref(url) {
    const u = urlLimpa(url);
    if (!u) return "";
    if (/^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(u)) return u;
    if (/^mailto:[^@/:]+@[^@/:]+$/i.test(u)) return u;
    if (/^\/(?![/\\])/.test(u)) return u;
    if (/^#[\w-]+$/.test(u)) return u;
    return "";
  }
  function isExternal(href) {
    const m = /^https?:\/\/([^/?#:]+)/i.exec(href);
    return !!m && !/(^|\.)sleevu\.app$/i.test(m[1]);
  }
  function safeImg(url) {
    const u = urlLimpa(url);
    if (!u) return "";
    if (/^\/(?![/\\])/.test(u)) return u;
    const m = /^https:\/\/([a-z0-9.-]+)\//i.exec(u);
    return m && IMG_HOSTS.indexOf(m[1].toLowerCase()) >= 0 ? u : "";
  }

  // Imagem que o editor sobe: .../blog-media/<caminho>-w<L>h<A>.webp. As medidas
  // no NOME viram width/height (a página não pula quando a imagem chega) e a
  // versão de 640 px, que o editor sobe junto, vira srcset pro celular. .jpg é
  // o plano B do editor quando o navegador não gera WebP (Safari antigo).
  const MEDIA_RE = /\/storage\/v1\/object\/public\/blog-media\/[^?#]+-w(\d{2,5})h(\d{2,5})\.(webp|jpg)$/;
  function mediaInfo(url) {
    const m = MEDIA_RE.exec(String(url || ""));
    if (!m) return null;
    const w = Number(m[1]), h = Number(m[2]);
    const small = w > 640 ? String(url).replace(/-w\d+h\d+\.(webp|jpg)$/, "-w640h" + Math.round((h * 640) / w) + "." + m[3]) : "";
    return { w, h, small };
  }
  // A versão pequena de uma imagem do blog (capa nos cartões da lista).
  function imagemPequena(url) {
    const info = mediaInfo(url);
    return info && info.small ? info.small : url;
  }

  // Imagem de carta: a mesma régua do shared.js/prerender pras fontes com
  // tamanhos no caminho (TCGdex low/high, TCGplayer 400/1000, Lorcast
  // normal/large). O fallback vai pro data-img-fallbacks, que o shared.js
  // percorre sozinho quando a imagem falha.
  function imagemDeCarta(url, miniatura) {
    const s = safeImg(url);
    if (!s) return { src: "", srcset: "", fallbacks: [] };
    if (s.indexOf("assets.tcgdex.net") >= 0) {
      const base = s.replace(/(?:\/(?:low|high))?\.(?:png|webp|jpg)$/, "");
      return miniatura
        ? { src: base + "/low.webp", srcset: base + "/low.webp 245w, " + base + "/high.webp 600w", fallbacks: [base + "/high.png"] }
        : { src: base + "/high.webp", srcset: "", fallbacks: [base + "/high.png"] };
    }
    if (miniatura && s.indexOf("tcgplayer-cdn.tcgplayer.com") >= 0 && s.indexOf("_in_1000x1000.jpg") >= 0) {
      return { src: s.replace("_in_1000x1000.jpg", "_in_400x400.jpg"), srcset: "", fallbacks: [s] };
    }
    if (miniatura && s.indexOf("cards.lorcast.io") >= 0 && s.indexOf("/card/digital/large/") >= 0) {
      return { src: s.replace("/card/digital/large/", "/card/digital/normal/"), srcset: "", fallbacks: [s] };
    }
    return { src: s, srcset: "", fallbacks: [] };
  }

  // ── Texto ────────────────────────────────────────────────────────────────
  // Endereço de post e âncora de seção. \p{M} (marcas combinantes) tira o
  // acento depois do NFD: "Ação" → "acao".
  function slugify(texto, max) {
    const s = String(texto == null ? "" : texto).normalize("NFD").replace(/\p{M}+/gu, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const lim = max || 80;
    if (s.length <= lim) return s;
    let r = s.slice(0, lim);
    if (s[lim] !== "-") r = r.replace(/-[^-]*$/, "") || r; // não corta palavra no meio
    return r.replace(/-+$/, "");
  }

  // Texto corrido do post, sem marcação: resumo automático e contagem de palavras.
  function textoPuro(md) {
    return String(md == null ? "" : md).replace(/\r\n?/g, "\n")
      .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, " ")
      .replace(/^\s*::cards?\[[^\]\n]*\]\s*$/gm, " ")
      .replace(/^\s*:::.*$/gm, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,3}[.)])\s+/gm, "")
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, " ")
      .replace(/[*_~`|]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function resumo(md, max) {
    const t = textoPuro(md);
    const lim = max || 160;
    if (t.length <= lim) return t;
    return t.slice(0, lim - 1).replace(/\s+\S*$/, "") + "…";
  }
  function contaPalavras(md) {
    const t = textoPuro(md);
    return t ? t.split(" ").length : 0;
  }

  // ── Inline ───────────────────────────────────────────────────────────────
  // Regexes "sticky" (flag y): cada uma tenta casar EXATAMENTE na posição
  // atual. Sem fatiar a string a cada caractere — um parágrafo gigante colado
  // de outro lugar não vira O(n²).
  const R = {
    escape: /\\([\\`*_{}[\]()#+\-.!~>|:])/y,
    code: /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/y,
    link: /\[((?:[^[\]\\\n]|\\.)*)\]\(\s*((?:[^\s()<>\\]|\([^\s()<>\\]*\))+)(?:\s+"([^"\n]*)")?\s*\)/y,
    strong: /\*\*(?=\S)([\s\S]*?\S)\*\*/y,
    strong2: /__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}])/yu,
    em: /\*(?=[^\s*])((?:[^*\n]|\*\*[^*\n]+\*\*)*?[^\s*])\*(?!\*)/y,
    em2: /_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}])/yu,
    del: /~~(?=\S)([\s\S]*?\S)~~/y,
    url: /https?:\/\/[^\s<>"'`]+/y
  };
  const LETRA = /[\p{L}\p{N}]/u;
  const DISPARO = "\\`[*_~h";

  function casa(re, s, i) {
    re.lastIndex = i;
    return re.exec(s);
  }

  // Âncora (#secao) ganha o caminho do post na frente durante um render().
  // A página publicada tem <base href="/"> (os passos de build só entendem
  // caminho relativo, e o post mora em /blog/<slug>) — sem o prefixo, o
  // "#secao" do índice levava pra home. O render é síncrono: guardar o valor
  // aqui é mais simples que carregá-lo por todas as chamadas.
  let ANCORA = "";

  function inline(src, semLinks) {
    const s = String(src == null ? "" : src);
    let out = "";
    let texto = "";
    const solta = () => {
      if (texto) { out += esc(texto).replace(/\n/g, "<br>"); texto = ""; }
    };
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (DISPARO.indexOf(ch) < 0) { texto += ch; i++; continue; }
      let m;
      if (ch === "\\" && (m = casa(R.escape, s, i))) { texto += m[1]; i += m[0].length; continue; }
      if (ch === "`") {
        if ((m = casa(R.code, s, i))) {
          solta();
          out += "<code>" + esc(m[2].replace(/^ (.*) $/s, "$1")) + "</code>";
          i += m[0].length;
        } else {
          // Crase sem par: a sequência inteira é texto (senão a 2ª crase de
          // "``" abriria um código que a 1ª não fechou).
          let j = i;
          while (s[j] === "`") j++;
          texto += s.slice(i, j);
          i = j;
        }
        continue;
      }
      if (ch === "[" && !semLinks && (m = casa(R.link, s, i))) {
        solta();
        const limpo = safeHref(m[2]);
        const href = limpo && limpo[0] === "#" ? ANCORA + limpo : limpo;
        const rotulo = inline(m[1], true) || esc(m[2]);
        if (!href) out += rotulo;
        else {
          const titulo = m[3] ? ' title="' + esc(m[3]) + '"' : "";
          out += '<a href="' + esc(href) + '"' + titulo + (isExternal(href) ? ' target="_blank" rel="noopener"' : "") + ">" + rotulo + "</a>";
        }
        i += m[0].length;
        continue;
      }
      if (ch === "*") {
        if ((m = casa(R.strong, s, i))) { solta(); out += "<strong>" + inline(m[1], semLinks) + "</strong>"; i += m[0].length; continue; }
        if ((m = casa(R.em, s, i))) { solta(); out += "<em>" + inline(m[1], semLinks) + "</em>"; i += m[0].length; continue; }
      }
      // _itálico_ só em fronteira de palavra: nome_de_arquivo não vira itálico.
      if (ch === "_" && !(i > 0 && LETRA.test(s[i - 1]))) {
        if ((m = casa(R.strong2, s, i))) { solta(); out += "<strong>" + inline(m[1], semLinks) + "</strong>"; i += m[0].length; continue; }
        if ((m = casa(R.em2, s, i))) { solta(); out += "<em>" + inline(m[1], semLinks) + "</em>"; i += m[0].length; continue; }
      }
      if (ch === "~" && (m = casa(R.del, s, i))) { solta(); out += "<del>" + inline(m[1], semLinks) + "</del>"; i += m[0].length; continue; }
      // URL solta vira link (quem cola um endereço espera que ele funcione).
      // A pontuação do fim da frase não entra: "veja https://x.com." e "(https://x.com)".
      if (ch === "h" && !semLinks && !(i > 0 && /[\p{L}\p{N}/=]/u.test(s[i - 1])) && (m = casa(R.url, s, i))) {
        let url = m[0];
        while (url.length) {
          const fim = url[url.length - 1];
          if (".,;:!?".indexOf(fim) >= 0) { url = url.slice(0, -1); continue; }
          if (fim === ")" && (url.split("(").length < url.split(")").length)) { url = url.slice(0, -1); continue; }
          break;
        }
        const href = safeHref(url);
        if (href) {
          solta();
          out += '<a href="' + esc(href) + '"' + (isExternal(href) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(url) + "</a>";
          i += url.length;
          continue;
        }
      }
      texto += ch;
      i++;
    }
    solta();
    return out;
  }

  // ── Blocos ───────────────────────────────────────────────────────────────
  const B = {
    fence: /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
    callout: /^\s{0,3}:::\s*(\p{L}+)?\s*(.*)$/u,
    calloutFim: /^\s{0,3}:::\s*$/,
    heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/,
    card: /^\s{0,3}::(cards?)\[([^\]\n]+)\]\s*$/,
    img: /^\s{0,3}!\[((?:[^[\]\\\n]|\\.)*)\]\(\s*([^\s()<>]+)(?:\s+"([^"\n]*)")?\s*\)\s*$/,
    quote: /^\s{0,3}>\s?/,
    ul: /^(\s{0,3})([-*+])\s+(.*)$/,
    ol: /^(\s{0,3})(\d{1,3})[.)]\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/
  };
  const CALLOUT = {
    dica: "tip", tip: "tip", consejo: "tip",
    info: "info", nota: "info", note: "info",
    alerta: "warn", aviso: "warn", atencao: "warn", "atenção": "warn", warning: "warn", cuidado: "warn"
  };
  const REF_RE = /^[a-z0-9]{2,20}\/[A-Za-z0-9._:-]{1,80}$/;
  const MAX_CARTAS_POR_BLOCO = 60;
  const MAX_PROFUNDIDADE = 4;

  function refsDe(lista) {
    const out = [];
    String(lista).split(",").forEach((p) => {
      const r = p.trim();
      if (REF_RE.test(r) && out.indexOf(r) < 0 && out.length < MAX_CARTAS_POR_BLOCO) out.push(r);
    });
    return out;
  }

  const ehTabela = (linhas, i) => linhas[i].indexOf("|") >= 0 && i + 1 < linhas.length && B.tableSep.test(linhas[i + 1]) && linhas[i + 1].indexOf("-") >= 0;
  function comecaBloco(linhas, i) {
    const l = linhas[i];
    return B.fence.test(l) || B.heading.test(l) || B.hr.test(l) || B.card.test(l) || B.img.test(l)
      || B.quote.test(l) || B.ul.test(l) || B.ol.test(l) || /^\s{0,3}:::\s*\p{L}/u.test(l) || ehTabela(linhas, i);
  }
  const vazia = (l) => /^\s*$/.test(l);

  function celulas(linha) {
    let l = linha.trim();
    if (l.startsWith("|")) l = l.slice(1);
    if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
    const out = [];
    let atual = "";
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "\\" && l[i + 1] === "|") { atual += "|"; i++; continue; }
      if (l[i] === "|") { out.push(atual.trim()); atual = ""; continue; }
      atual += l[i];
    }
    out.push(atual.trim());
    return out;
  }

  function render(md, opts) {
    const o = opts || {};
    const ctx = {
      lang: ROTULOS[o.lang] ? o.lang : "pt",
      editor: !!o.editor,
      card: typeof o.card === "function" ? o.card : () => null,
      ids: new Map(),
      toc: [],
      refs: []
    };
    const linhas = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
    const antes = ANCORA;
    ANCORA = /^\/[\w/-]*$/.test(o.ancora || "") ? o.ancora : "";
    let html;
    try { html = blocos(linhas, 0, ctx); } finally { ANCORA = antes; }
    const palavras = contaPalavras(md);
    return { html, toc: ctx.toc, refs: ctx.refs, words: palavras, minutes: Math.max(1, Math.round(palavras / 220)) };
  }

  function idUnico(ctx, texto) {
    const base = slugify(texto, 60) || "secao";
    const n = (ctx.ids.get(base) || 0) + 1;
    ctx.ids.set(base, n);
    return n === 1 ? base : base + "-" + n;
  }

  function blocos(linhas, prof, ctx) {
    let out = "";
    let i = 0;
    const L = rotulos(ctx.lang);
    while (i < linhas.length) {
      const linha = linhas[i];
      if (vazia(linha)) { i++; continue; }
      let m;

      // ``` código ```
      if ((m = B.fence.exec(linha))) {
        // Fecha com o MESMO caractere, no mínimo o mesmo tanto (``` fecha ```,
        // ~~~ não fecha ```).
        const fecha = new RegExp("^\\s{0,3}" + (m[1][0] === "`" ? "`" : "~") + "{" + m[1].length + ",}\\s*$");
        const corpo = [];
        i++;
        while (i < linhas.length && !fecha.test(linhas[i])) { corpo.push(linhas[i]); i++; }
        i++; // a cerca de fechamento (ou o fim do texto)
        out += '<pre class="blog-code"><code>' + esc(corpo.join("\n")) + "</code></pre>\n";
        continue;
      }

      // :::dica … ::: (sem caixa dentro de caixa)
      if (prof === 0 && (m = B.callout.exec(linha)) && m[1]) {
        const palavra = m[1].toLowerCase();
        const tipo = CALLOUT[palavra] || "info";
        const titulo = CALLOUT[palavra] ? m[2] : (m[1] + (m[2] ? " " + m[2] : ""));
        const corpo = [];
        i++;
        while (i < linhas.length && !B.calloutFim.test(linhas[i])) { corpo.push(linhas[i]); i++; }
        i++;
        out += '<aside class="blog-callout blog-callout--' + tipo + '">'
          + (titulo.trim() ? '<p class="blog-callout-title">' + inline(titulo.trim()) + "</p>" : "")
          + blocos(corpo, prof + 1, ctx) + "</aside>\n";
        continue;
      }

      // # Títulos. # e ## viram h2 (o h1 da página é o título do post).
      if ((m = B.heading.exec(linha))) {
        const nivel = Math.min(4, Math.max(2, m[1].length));
        const conteudo = m[2];
        const id = idUnico(ctx, textoPuro(conteudo));
        if (prof === 0 && nivel <= 3) ctx.toc.push({ id, text: textoPuro(conteudo), level: nivel });
        out += "<h" + nivel + ' id="' + esc(id) + '">' + inline(conteudo) + "</h" + nivel + ">\n";
        i++;
        continue;
      }

      if (B.hr.test(linha)) { out += "<hr>\n"; i++; continue; }

      // ::card[…] / ::cards[…]
      if ((m = B.card.exec(linha))) {
        const refs = refsDe(m[2]);
        refs.forEach((r) => { if (ctx.refs.indexOf(r) < 0) ctx.refs.push(r); });
        out += m[1] === "card" && refs.length === 1 ? cartaUma(refs[0], ctx) : cartasGrade(refs, ctx);
        i++;
        continue;
      }

      // ![descrição](url "legenda")
      if ((m = B.img.exec(linha))) {
        out += figura(m[2], m[1].replace(/\\(.)/g, "$1"), m[3] || "", ctx, L);
        i++;
        continue;
      }

      // Tabela
      if (ehTabela(linhas, i)) {
        const cab = celulas(linhas[i]);
        const alin = celulas(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : ""));
        const estilo = (k) => (alin[k] ? ' style="text-align:' + alin[k] + '"' : "");
        let t = "<thead><tr>" + cab.map((c, k) => "<th" + estilo(k) + ">" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < linhas.length && !vazia(linhas[i]) && linhas[i].indexOf("|") >= 0) {
          const cel = celulas(linhas[i]);
          t += "<tr>" + cab.map((_, k) => "<td" + estilo(k) + ">" + inline(cel[k] || "") + "</td>").join("") + "</tr>";
          i++;
        }
        out += '<div class="blog-table"><table>' + t + "</tbody></table></div>\n";
        continue;
      }

      // > citação (pode conter lista, parágrafos…)
      if (B.quote.test(linha)) {
        const corpo = [];
        while (i < linhas.length && B.quote.test(linhas[i])) { corpo.push(linhas[i].replace(B.quote, "")); i++; }
        out += "<blockquote>" + (prof < MAX_PROFUNDIDADE ? blocos(corpo, prof + 1, ctx) : "<p>" + inline(corpo.join("\n")) + "</p>") + "</blockquote>\n";
        continue;
      }

      // Listas
      if (B.ul.test(linha) || B.ol.test(linha)) {
        const r = lista(linhas, i, prof, ctx);
        out += r.html;
        i = r.fim;
        continue;
      }

      // Parágrafo: até a linha em branco ou o começo de outro bloco.
      const par = [linha.trim()];
      i++;
      while (i < linhas.length && !vazia(linhas[i]) && !comecaBloco(linhas, i)) { par.push(linhas[i].trim()); i++; }
      out += "<p>" + inline(par.join("\n")) + "</p>\n";
    }
    return out;
  }

  // Lista: itens do mesmo tipo em sequência. Linha recuada 2+ espaços além do
  // marcador é continuação do item — inclusive uma sub-lista, que os blocos
  // desenham de novo. Linha em branco seguida de outro item do mesmo tipo
  // mantém a lista. O PRIMEIRO item sempre entra (é ele que trouxe a linha
  // até aqui), então a função sempre anda: um "  - item" recuado no começo
  // do bloco não pode travar o laço de quem chamou.
  function lista(linhas, i, prof, ctx) {
    const numerada = !B.ul.test(linhas[i]);
    const re = numerada ? B.ol : B.ul;
    const m0 = re.exec(linhas[i]);
    const base = m0[1].length;
    const inicio = numerada ? Number(m0[2]) : 1;
    const recuada = new RegExp("^ {" + (base + 2) + ",}\\S");
    const tiraRecuo = new RegExp("^ {0," + (base + 2) + "}");
    const deTab = (l) => l.replace(/^\t/, "    ");
    const ehItem = (l) => {
      const m = re.exec(l);
      return m && m[1].length <= base + 1 ? m : null;
    };
    const itens = [];
    let m;
    while (i < linhas.length && (m = ehItem(linhas[i]))) {
      const corpo = [m[3]];
      i++;
      while (i < linhas.length) {
        const l = deTab(linhas[i]);
        if (recuada.test(l)) { corpo.push(l.replace(tiraRecuo, "")); i++; continue; }
        if (vazia(l)) {
          let j = i;
          while (j < linhas.length && vazia(linhas[j])) j++;
          if (j < linhas.length && recuada.test(deTab(linhas[j]))) { corpo.push(""); i = j; continue; }
        }
        break;
      }
      itens.push(corpo);
      // Linha em branco entre dois itens do mesmo tipo: a lista continua.
      let j = i;
      while (j < linhas.length && vazia(linhas[j])) j++;
      if (j > i && j < linhas.length && ehItem(linhas[j])) i = j;
    }
    const lis = itens.map((corpo) => {
      const temBloco = corpo.slice(1).some((l) => B.ul.test(l) || B.ol.test(l) || B.quote.test(l) || B.card.test(l) || B.img.test(l));
      if (!temBloco || prof >= MAX_PROFUNDIDADE) return "<li>" + inline(corpo.filter((l, k) => k === 0 || l !== "").join("\n")) + "</li>";
      // Primeiro parágrafo sem <p> (lista "apertada"), o resto em blocos.
      const html = blocos(corpo, prof + 1, ctx).replace(/^<p>([\s\S]*?)<\/p>\n/, "$1");
      return "<li>" + html + "</li>";
    }).join("");
    const tag = numerada ? "ol" : "ul";
    return { html: "<" + tag + (numerada && inicio !== 1 ? ' start="' + inicio + '"' : "") + ">" + lis + "</" + tag + ">\n", fim: i };
  }

  function figura(urlCrua, alt, legenda, ctx, L) {
    const src = safeImg(urlCrua);
    if (!src) return ctx.editor ? '<p class="blog-warn">' + esc(L.imagemBloqueada) + ": " + esc(urlCrua) + "</p>\n" : "";
    const info = mediaInfo(src);
    const medidas = info ? ' width="' + info.w + '" height="' + info.h + '"' : "";
    const srcset = info && info.small ? ' srcset="' + esc(info.small) + " 640w, " + esc(src) + " " + info.w + 'w" sizes="(max-width: 760px) 100vw, 720px"' : "";
    return '<figure class="blog-figure"><img src="' + esc(src) + '"' + srcset + medidas + ' alt="' + esc(alt) + '" loading="lazy" decoding="async">'
      + (legenda ? "<figcaption>" + inline(legenda, false) + "</figcaption>" : "") + "</figure>\n";
  }

  // ── Cartas ───────────────────────────────────────────────────────────────
  // `ctx.card(ref)` devolve { name, set, setId, number, image, price } ou null.
  // A borda preenche pelo D1 (functions/blog/[slug].js), o editor pela
  // /api/collection; o preço já chega formatado (a borda em US$, o navegador
  // troca pela moeda de quem lê depois — ver src/blog.js).
  function hrefDaCarta(game, id, c) {
    if (!c || !c.set) return "";
    const p = ["type=set", "name=" + encodeURIComponent(c.set), "card=" + encodeURIComponent(id)];
    if (c.setId) p.push("setId=" + encodeURIComponent(c.setId));
    p.push("game=" + encodeURIComponent(game));
    return "/detail?" + p.join("&");
  }
  function partesDaCarta(ref, ctx, miniatura) {
    const barra = ref.indexOf("/");
    const game = ref.slice(0, barra), id = ref.slice(barra + 1);
    let c = null;
    try { c = ctx.card(ref) || null; } catch (e) { c = null; }
    if (!c) return { game, id, c: null };
    const nome = c.name || id;
    const img = imagemDeCarta(c.image, miniatura);
    const sizes = miniatura ? "(max-width: 600px) 45vw, 190px" : "(max-width: 600px) 60vw, 280px";
    const imgHtml = img.src
      ? '<img src="' + esc(img.src) + '"' + (img.srcset ? ' srcset="' + esc(img.srcset) + '" sizes="' + sizes + '"' : "")
        + ' alt="' + esc(nome) + '" loading="lazy" decoding="async" data-card-img'
        + (img.fallbacks.length ? ' data-img-fallbacks="' + esc(img.fallbacks.join("|")) + '"' : "") + ">"
      : '<span class="blog-card-noimg" aria-hidden="true"></span>';
    const onde = [c.set, c.number].filter(Boolean).join(" · ");
    return { game, id, c, nome, imgHtml, onde, href: hrefDaCarta(game, id, c) };
  }
  function envolve(p, conteudo, classe) {
    const attrs = ' class="' + classe + '" data-blog-card="' + esc(p.game + "/" + p.id) + '"';
    return p.href ? "<a" + attrs + ' href="' + esc(p.href) + '">' + conteudo + "</a>" : "<span" + attrs + ">" + conteudo + "</span>";
  }
  function faltando(ref, ctx) {
    return ctx.editor ? '<p class="blog-warn" data-card-ref="' + esc(ref) + '">' + esc(rotulos(ctx.lang).semCarta) + ": " + esc(ref) + "</p>\n" : "";
  }
  function cartaUma(ref, ctx) {
    const p = partesDaCarta(ref, ctx, false);
    if (!p.c) return faltando(ref, ctx);
    return '<figure class="blog-card-one" data-card-ref="' + esc(ref) + '">'
      + envolve(p, p.imgHtml, "blog-card-img")
      + '<figcaption class="blog-card-info">'
      + envolve(p, esc(p.nome), "blog-card-name")
      + (p.onde ? '<span class="blog-card-set">' + esc(p.onde) + "</span>" : "")
      + '<span class="blog-card-price" data-card-price>' + esc(p.c.price || "") + "</span>"
      + '<span class="blog-card-actions" data-card-actions></span>'
      + "</figcaption></figure>\n";
  }
  function cartasGrade(refs, ctx) {
    if (!refs.length) return "";
    const itens = refs.map((ref) => {
      const p = partesDaCarta(ref, ctx, true);
      if (!p.c) return ctx.editor ? '<div class="blog-card-tile blog-card-tile--missing">' + faltando(ref, ctx) + "</div>" : "";
      return '<figure class="blog-card-tile" data-card-ref="' + esc(ref) + '">'
        + envolve(p, p.imgHtml, "blog-card-img")
        + '<figcaption class="blog-card-info">'
        + envolve(p, esc(p.nome), "blog-card-name")
        + (p.onde ? '<span class="blog-card-set">' + esc(p.onde) + "</span>" : "")
        + '<span class="blog-card-price" data-card-price>' + esc(p.c.price || "") + "</span>"
        + '<span class="blog-card-actions" data-card-actions></span>'
        + "</figcaption></figure>";
    }).join("");
    return itens ? '<div class="blog-cards">' + itens + "</div>\n" : "";
  }

  // ── Pedaços de página (borda + editor) ──────────────────────────────────
  function dataLonga(iso, lang) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat(rotulos(lang).locale, { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 10); }
  }
  function textoNaCor(hex) {
    // Mesma conta do shared.js (textOnColor): preto ou branco, o de maior contraste.
    const h = String(hex).replace("#", "");
    const ch = (k) => {
      const v = parseInt(h.slice(k, k + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
    return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
  }
  function etiquetaJogo(game) {
    const g = GAMES[game];
    if (!g) return "";
    return '<span class="game-tag" style="--gt:' + g[1] + ";--gt-fg:" + textoNaCor(g[1]) + '">' + esc(g[0]) + "</span>";
  }
  function nomeCategoria(cat, lang) {
    const c = CATEGORIAS[cat];
    return c ? c[lang] || c.pt : "";
  }
  const URL_DO_POST = (slug) => "/blog/" + slug;

  // Cabeçalho do artigo: trilha, jogo/categoria, título, linha fina, autor,
  // data, tempo de leitura e capa. `post` são as colunas da tabela posts.
  function cabecalhoHtml(post) {
    const lang = ROTULOS[post.lang] ? post.lang : "pt";
    const L = rotulos(lang);
    const cat = nomeCategoria(post.category, lang);
    const capa = safeImg(post.cover_url);
    const info = capa ? mediaInfo(capa) : null;
    const quando = post.published_at || post.updated_at || "";
    return '<header class="blog-article-head">'
      + '<nav class="blog-crumbs" aria-label="' + esc(L.trilha) + '"><a href="/blog">' + esc(L.blog) + "</a>"
      + (cat ? '<span aria-hidden="true">›</span><a href="/blog?cat=' + esc(post.category) + '">' + esc(cat) + "</a>" : "") + "</nav>"
      + '<div class="blog-tags-top">' + etiquetaJogo(post.game) + (cat ? '<span class="blog-cat">' + esc(cat) + "</span>" : "") + "</div>"
      + '<h1 class="blog-title">' + esc(post.title || "") + "</h1>"
      + (post.subtitle ? '<p class="blog-subtitle">' + esc(post.subtitle) + "</p>" : "")
      + '<p class="blog-byline">'
      + (post.author_name ? '<span class="blog-author">' + esc(L.por) + " <strong>" + esc(post.author_name) + "</strong></span>" : "")
      + (quando ? '<time datetime="' + esc(quando) + '">' + esc(dataLonga(quando, lang)) + "</time>" : "")
      + '<span class="blog-reading">' + (Number(post.reading_min) || 1) + " " + esc(L.min) + "</span>"
      + "</p>"
      + (capa ? '<figure class="blog-cover"><img src="' + esc(capa) + '"'
        + (info && info.small ? ' srcset="' + esc(info.small) + " 640w, " + esc(capa) + " " + info.w + 'w" sizes="(max-width: 900px) 100vw, 900px"' : "")
        + (info ? ' width="' + info.w + '" height="' + info.h + '"' : "")
        + ' alt="' + esc(post.cover_alt || "") + '" fetchpriority="high" decoding="async"></figure>' : "")
      + "</header>";
  }

  // Índice ("Neste artigo"): só h2/h3 do nível de cima. `ancora` = caminho do
  // post, pelo mesmo motivo do ANCORA do render (a página tem <base href="/">).
  function indiceLista(toc, ancora) {
    const base = /^\/[\w/-]*$/.test(ancora || "") ? ancora : "";
    return "<ol>" + toc.map((h) => '<li class="blog-toc-l' + h.level + '"><a href="' + esc(base) + "#" + esc(h.id) + '" data-toc="' + esc(h.id) + '">' + esc(h.text) + "</a></li>").join("") + "</ol>";
  }
  function indiceHtml(toc, lang, ancora) {
    if (!toc || toc.length < 2) return "";
    const L = rotulos(lang);
    return '<nav class="blog-toc" aria-label="' + esc(L.indice) + '"><p class="blog-toc-title">' + esc(L.indice) + "</p>" + indiceLista(toc, ancora) + "</nav>";
  }

  // Preço de referência que a BORDA escreve (US$, ou € quando a fonte só tem
  // euro — nunca convertido aqui). No navegador o src/blog.js troca pelo valor
  // na moeda de quem lê, com a mesma fórmula do resto do site (cardValue).
  function precoTexto(entrada, lang) {
    if (!entrada) return "";
    const L = rotulos(lang);
    const fmt = (n) => Number(n).toLocaleString(L.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (Number(entrada.u) > 0) return "US$ " + fmt(entrada.u);
    if (Number(entrada.e) > 0) return "€ " + fmt(entrada.e);
    return "";
  }

  const ICONE = {
    compartilhar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
    conversa: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z"/></svg>',
    postar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l6.5-6.5"/><path d="M13.5 10.5 20 4"/><path d="M4 4h4.5L20 20h-4.5z"/></svg>'
  };

  // A página do post inteira (menos o que é da casca: menu, rodapé). A borda
  // monta isto pro visitante e o editor monta o MESMO pra prévia.
  //   post = colunas da tabela posts; r = resultado do render(); opts.card = a
  //   mesma função de cartas do render (a lateral lista as cartas citadas).
  function paginaDoPostHtml(post, r, opts) {
    const o = opts || {};
    const lang = ROTULOS[post.lang] ? post.lang : "pt";
    const L = rotulos(lang);
    const ancora = URL_DO_POST(post.slug || "");
    const url = SITE + ancora;
    const titulo = post.title || "";
    const toc = r.toc || [];
    const tags = (post.tags || []).filter(Boolean);
    const cartaDe = typeof o.card === "function" ? o.card : () => null;

    const laterais = (r.refs || []).map((ref) => ({ ref, c: (() => { try { return cartaDe(ref); } catch (e) { return null; } })() }))
      .filter((x) => x.c).slice(0, 12);
    const listaCartas = laterais.length ? '<section class="blog-side-cards"><p class="blog-side-title">' + esc(L.cartas) + "</p><ol>"
      + laterais.map(({ ref, c }) => {
        const barra = ref.indexOf("/");
        const p = { game: ref.slice(0, barra), id: ref.slice(barra + 1) };
        p.href = hrefDaCarta(p.game, p.id, c);
        const img = imagemDeCarta(c.image, true);
        const miolo = (img.src ? '<img src="' + esc(img.src) + '" alt="" loading="lazy" decoding="async" data-card-img'
            + (img.fallbacks.length ? ' data-img-fallbacks="' + esc(img.fallbacks.join("|")) + '"' : "") + ">" : '<span class="blog-card-noimg" aria-hidden="true"></span>')
          + '<span class="blog-side-card-text"><span class="blog-side-card-name">' + esc(c.name || p.id) + "</span>"
          + '<span class="blog-card-price" data-card-price>' + esc(c.price || "") + "</span></span>";
        return '<li data-card-ref="' + esc(ref) + '">' + envolve(p, miolo, "blog-side-card") + "</li>";
      }).join("") + "</ol></section>" : "";

    const compartilhar = '<div class="blog-share" data-blog-share data-url="' + esc(url) + '" data-title="' + esc(titulo) + '">'
      + '<span class="blog-share-label">' + esc(L.compartilhar) + "</span>"
      + '<button type="button" class="blog-share-btn" data-share-native hidden>' + ICONE.compartilhar + "<span>" + esc(L.compartilhar) + "</span></button>"
      + '<a class="blog-share-btn" href="https://wa.me/?text=' + esc(encodeURIComponent(titulo + " " + url)) + '" target="_blank" rel="noopener">' + ICONE.conversa + "<span>WhatsApp</span></a>"
      + '<a class="blog-share-btn" href="https://x.com/intent/tweet?text=' + esc(encodeURIComponent(titulo)) + "&amp;url=" + esc(encodeURIComponent(url)) + '" target="_blank" rel="noopener">' + ICONE.postar + "<span>X</span></a>"
      + '<button type="button" class="blog-share-btn" data-share-copy>' + ICONE.link + "<span>" + esc(L.copiar) + "</span></button>"
      + "</div>";

    const atualizado = post.published_at && post.updated_at && (new Date(post.updated_at) - new Date(post.published_at)) > 86400000
      ? '<p class="blog-updated">' + esc(L.atualizado) + " " + '<time datetime="' + esc(post.updated_at) + '">' + esc(dataLonga(post.updated_at, lang)) + "</time></p>" : "";

    return '<div class="blog-layout">'
      + '<article class="blog-article" lang="' + esc(L.locale) + '">'
      + cabecalhoHtml(post)
      + (toc.length >= 2 ? '<details class="blog-toc-mobile"><summary>' + esc(L.indice) + "</summary>" + indiceLista(toc, ancora) + "</details>" : "")
      + '<div class="blog-body">' + (r.html || "") + "</div>"
      + '<footer class="blog-article-foot">'
      + atualizado
      + (tags.length ? '<p class="blog-tags"><span class="blog-tags-label">' + esc(L.tags) + "</span>" + tags.map((t) => '<a class="blog-tag" href="/blog?tag=' + esc(encodeURIComponent(t)) + '">' + esc(t) + "</a>").join("") + "</p>" : "")
      + compartilhar
      + '<aside class="blog-cta" data-blog-cta><p class="blog-cta-title">' + esc(L.ctaTitulo) + "</p><p>" + esc(L.ctaTexto) + '</p><a class="cta" href="/login">' + esc(L.ctaBotao) + "</a></aside>"
      + "</footer>"
      + "</article>"
      + ((toc.length >= 2 || listaCartas) ? '<aside class="blog-side">' + indiceHtml(toc, lang, ancora) + listaCartas + "</aside>" : "")
      + "</div>";
  }

  // "Leia também" no pé do post.
  function relacionadosHtml(posts, lang) {
    if (!posts || !posts.length) return "";
    return '<section class="blog-related"><h2 class="blog-related-title">' + esc(rotulos(lang).leiaTambem) + '</h2><div class="blog-grid">'
      + posts.map((p) => cartaoHtml(p, false)).join("") + "</div></section>";
  }

  // A lista do /blog: o primeiro (o destaque mais novo, ou o post mais novo)
  // vira o cartão grande, o resto a grade.
  function listaHtml(posts) {
    if (!posts || !posts.length) return "";
    const heroi = posts.find((p) => p.featured) || posts[0];
    const resto = posts.filter((p) => p !== heroi);
    return cartaoHtml(heroi, true) + (resto.length ? '<div class="blog-grid">' + resto.map((p) => cartaoHtml(p, false)).join("") + "</div>" : "");
  }

  // Cartão de post na lista do /blog (e na faixa "Do blog"). `destaque` = o
  // cartão grande do topo.
  function cartaoHtml(post, destaque) {
    const lang = ROTULOS[post.lang] ? post.lang : "pt";
    const L = rotulos(lang);
    const cat = nomeCategoria(post.category, lang);
    const capaOrig = safeImg(post.cover_url);
    const capa = capaOrig ? (destaque ? capaOrig : imagemPequena(capaOrig)) : "";
    const info = capaOrig ? mediaInfo(capaOrig) : null;
    const quando = post.published_at || "";
    return '<article class="blog-item' + (destaque ? " blog-item--hero" : "") + '" data-game="' + esc(post.game || "") + '" data-cat="' + esc(post.category || "") + '" data-lang="' + esc(lang) + '">'
      + '<a class="blog-item-link" href="' + esc(URL_DO_POST(post.slug)) + '">'
      + (capa ? '<span class="blog-item-cover">' : '<span class="blog-item-cover blog-item-cover--vazia"' + (GAMES[post.game] ? ' style="--gt:' + GAMES[post.game][1] + '"' : "") + ">")
      + (capa ? '<img src="' + esc(capa) + '"'
        + (destaque && info && info.small ? ' srcset="' + esc(info.small) + " 640w, " + esc(capaOrig) + " " + info.w + 'w" sizes="(max-width: 900px) 100vw, 60vw"' : "")
        + ' alt="' + esc(post.cover_alt || "") + '" loading="' + (destaque ? "eager" : "lazy") + '" decoding="async">' : "") + "</span>"
      + '<span class="blog-item-body">'
      + '<span class="blog-tags-top">' + etiquetaJogo(post.game) + (cat ? '<span class="blog-cat">' + esc(cat) + "</span>" : "") + "</span>"
      + '<span class="blog-item-title">' + esc(post.title || "") + "</span>"
      // Sem resumo, a linha fina segura o cartão (o editor preenche o resumo
      // ao salvar, mas post salvo direto no banco pode vir sem).
      + ((post.excerpt || post.subtitle) ? '<span class="blog-item-excerpt">' + esc(post.excerpt || post.subtitle) + "</span>" : "")
      + '<span class="blog-item-meta">' + (quando ? '<time datetime="' + esc(quando) + '">' + esc(dataLonga(quando, lang)) + "</time> · " : "")
      + (Number(post.reading_min) || 1) + " " + esc(L.min) + "</span>"
      + "</span></a></article>";
  }

  root.SleevuBlog = {
    render, inline, slugify, textoPuro, resumo, contaPalavras,
    safeHref, safeImg, mediaInfo, imagemPequena, imagemDeCarta, hrefDaCarta, precoTexto,
    cabecalhoHtml, indiceHtml, cartaoHtml, paginaDoPostHtml, relacionadosHtml, listaHtml,
    etiquetaJogo, nomeCategoria, dataLonga, rotulos,
    esc, GAMES, CATEGORIAS, ROTULOS, IMG_HOSTS, SITE, SUPABASE_HOST, SUPABASE_URL, SUPABASE_KEY, REF_RE, URL_DO_POST
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
