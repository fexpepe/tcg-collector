// Pré-renderização de SEO do catálogo (páginas de set de TODOS os jogos).
//
// O app é uma SPA/MPA: /sets e detail.html montam tudo no cliente, então o
// Googlebot vê uma casca vazia e não indexa "Base Set", "OP-01" etc. Este script
// gera, no build (CI, depois dos syncs), UMA página HTML ESTÁTICA por set
// em /set/<slug>.html — com <title>, meta description, Open Graph, JSON-LD e a
// lista de cartas (nome, número, imagem) já no HTML. É a "porta do Google": a
// pessoa cai numa página real e legível e clica pra abrir o app interativo
// (detail.html?game=<slug>, que grava a sessão do jogo). Também (re)gera o
// sitemap.xml com todas essas URLs.
//
// Fontes de dados:
//   pokemon  -> chunks por set gerados pelo sync: data/sets/<lang>/<id>.json
//   lorcana  -> data/lorcana/cards.js  (window.TCG_CARDS)
//   onepiece -> data/onepiece/cards.js (window.TCG_CARDS, inclui os vintage)
//
// Roda com: node scripts/prerender-catalog.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readGlobalVar } from "./lib/sync-common.mjs";

const ORIGIN = "https://sleevu.app";
const SETS_DIR = "data/sets";
const OUT_DIR = "set";

// Jogos prerenderizados, na ordem (a ordem fixa mantém os slugs estáveis entre
// builds quando dois sets de jogos diferentes têm o mesmo nome).
const GAMES = [
  { slug: "pokemon", label: "Pokémon TCG" },
  { slug: "lorcana", label: "Disney Lorcana" },
  { slug: "onepiece", label: "One Piece Card Game" },
  { slug: "naruto", label: "Naruto Card Game (2002~2006)" },
  { slug: "hxh", label: "Hunter × Hunter Carddass" }
];

// A CSP vem do header em _headers (política única do site inteiro) — estas
// páginas não levam <meta> de CSP, como as demais.

// Páginas estáticas do site (base do sitemap), extensionless como o CF Pages serve.
// Só páginas PÚBLICAS e indexáveis. As telas pessoais (dashboard, collection,
// wishlist, portfolio, binders, sales, graded, my-decks…) saíram: todas exigem
// sessão e redirecionam pro login, então o buscador indexava um redirecionamento
// — página fina, zero valor de busca. Elas agora estão no Disallow do
// robots.txt, e sitemap × robots precisam concordar: anunciar no sitemap uma URL
// bloqueada no robots vira erro no Search Console.
// /decks é a galeria PÚBLICA da comunidade e fica.
const STATIC_URLS = [
  "/", "/hub", "/explore", "/cards", "/pokedex", "/sets", "/artists", "/trainers",
  "/decks",
  "/about", "/novidades", "/faq", "/help", "/privacy", "/terms"
];

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
function slugify(name) {
  return String(name)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
// Imagens/logos podem ser URL absoluta (CDNs) ou caminho relativo à raiz do site
// (ex.: data/onepiece/set-logos/x.png). A página vive em /set/, então caminho
// relativo precisa virar absoluto ("/data/...") pra não resolver em /set/data/.
function absUrl(u) {
  const s = String(u || "");
  if (!s) return s;
  // ABSOLUTA de verdade (com origem), não só root-relative: og:image e o campo
  // `image` do JSON-LD são IGNORADOS pelos crawlers quando relativos — a prévia
  // de compartilhamento (WhatsApp/Facebook/Slack) sumia em ~685 páginas e o
  // Product perdia o rich result. Em <img src> a URL absoluta funciona igual.
  return /^https?:\/\//.test(s) ? s : `${ORIGIN}/` + s.replace(/^\/+/, "");
}
function fmtDatePt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${Number(m[3])} de ${MONTHS_PT[Number(m[2]) - 1]} de ${m[1]}`;
}
// Miniatura da GRADE. O catálogo guarda a URL do scan grande — no Pokémon é o
// `high.png`, que tem 288 KB por carta. Numa página de set com 200 cartas isso
// é ~57 MB pra desenhar quadradinhos. A carta em tamanho grande continua no
// high.png — quem abre a página da CARTA (prc-img) recebe o scan bom.
// Só a TCGdex expõe esse esquema de qualidade no caminho; as outras fontes
// (TCGplayer, Scryfall, Lorcast) passam direto, sem alteração.
//
// São DUAS variantes, num srcset, porque uma só não serve as duas telas:
// low.webp tem 245x337 (14 KB) e high.webp tem 600x825 (48 KB). No desktop a
// coluna da grade tem ~150-245 px em tela 1x, e o low é exatamente do tamanho;
// no celular a coluna fica em ~150 px mas com DPR 3, então o low apareceria
// esticado (foi o que a medição em produção mostrou: 3,8x de escala, borrado).
// Com o srcset quem escolhe é o navegador, pela largura real e pela densidade.
const QUALIDADE_RE = /(?:\/(?:low|high))?\.(?:png|webp|jpg)$/;
const daTcgdex = (u) => String(u || "").includes("assets.tcgdex.net");
function thumbUrl(u) {
  const s = String(u || "");
  return daTcgdex(s) ? s.replace(QUALIDADE_RE, "/low.webp") : s;
}
// srcset/sizes do thumb. Fora da TCGdex devolve vazio (a fonte não tem
// variantes) e o <img> fica só com o src, como antes.
function thumbSrcset(u) {
  const s = String(u || "");
  if (!daTcgdex(s)) return "";
  const low = s.replace(QUALIDADE_RE, "/low.webp");
  const high = s.replace(QUALIDADE_RE, "/high.webp");
  return `${escapeAttr(low)} 245w, ${escapeAttr(high)} 600w`;
}
// Uma carta por NÚMERO, na língua da variante da página. Os chunks do Pokémon
// são por idioma (data/sets/<lang>/<id>.json) e o agrupamento é pelo NOME do
// set, então "151" chega aqui com as 207 cartas em inglês MAIS as 207 em
// português: a página listava a mesma carta duas vezes, dobrava as imagens e
// ainda anunciava "todas as 415 cartas" de um set que tem 207.
// Preferência: a língua da página → inglês → o que houver.
function cardsForLang(cards, lang) {
  const porNumero = new Map();
  const peso = (c) => (c.language === lang ? 0 : c.language === "en" ? 1 : 2);
  for (const c of cards) {
    // Sem número não dá pra parear impressões: entra sempre (chave própria).
    const chave = c.number ? `${c.setId || ""}|${c.number}` : `id|${c.id}`;
    const atual = porNumero.get(chave);
    if (!atual || peso(c) < peso(atual)) porNumero.set(chave, c);
  }
  return [...porNumero.values()];
}
// ORÇAMENTO DE TÍTULO. O Google mostra ~60-65 caracteres e corta o resto com
// "…": título de 116 (o maior que havia aqui) desperdiçava metade e diluía o
// peso dos termos que importam. A regra em todo o arquivo: o NOME (do set ou da
// carta) nunca é truncado — é o que a pessoa digitou; quem sai são as partes
// descritivas, da menos importante pra mais.
const TITULO_MAX = 65;
// Recebe as variantes da parte descritiva em ordem decrescente de informação e
// devolve a primeira que couber; se nenhuma couber, fica só o nome + a marca.
function tituloSet(nome, variantes) {
  const sufixo = " | Sleevu";
  for (const v of variantes) {
    const t = `${nome} — ${v}${sufixo}`;
    if (t.length <= TITULO_MAX) return t;
  }
  return nome + sufixo;
}

// Ordena "4/102" < "10/102" pelo primeiro inteiro (localeCompare erraria).
function cmpNumber(a, b) {
  const na = parseInt(String(a || "").match(/\d+/), 10);
  const nb = parseInt(String(b || "").match(/\d+/), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

// Pokémon: lê todos os chunks data/sets/<lang>/<id>.json e agrupa as cartas por
// NOME de set (exatamente como o app: cards.filter(c => c.set === nome)).
function loadPokemonSets() {
  const byName = new Map();
  if (!existsSync(SETS_DIR)) return byName;
  for (const lang of readdirSync(SETS_DIR)) {
    const dir = join(SETS_DIR, lang);
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
    for (const file of files) {
      let cards;
      try { cards = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { continue; }
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        const name = card.set;
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(card);
      }
    }
  }
  return byName;
}

// Lorcana/One Piece: catálogo inteiro num cards.js (window.TCG_CARDS).
async function loadGameSets(slug) {
  const byName = new Map();
  const cards = await readGlobalVar(new URL(`../data/${slug}/cards.js`, import.meta.url), "TCG_CARDS");
  if (!Array.isArray(cards)) return byName;
  for (const card of cards) {
    const name = card.set;
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(card);
  }
  return byName;
}

// Textos das páginas de set nos DOIS idiomas (pt = padrão/x-default, en = a
// variante hreflang). A estrutura/HTML é idêntica — só muda o copy.
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtDateEn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${MONTHS_EN[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
const SET_L10N = {
  pt: {
    htmlLang: "pt-BR",
    fmtDate: fmtDatePt,
    title: (name, gameLabel) => tituloSet(name, [`cartas do set ${gameLabel}`, gameLabel]),
    desc: (n, name, gameLabel, dateHuman) => `Lista completa das ${n} cartas do set ${name} de ${gameLabel}${dateHuman ? `, lançado em ${dateHuman}` : ""}. Veja imagens, números e raridades e monte sua coleção no Sleevu.`,
    sub: (gameLabel, total, dateHuman, n) => `${gameLabel} · ${total} cartas oficiais${dateHuman ? ` · lançado em ${dateHuman}` : ""} · ${n} no catálogo do Sleevu`,
    cta: "Abrir o set no Sleevu",
    othersAria: "Outros sets",
    others: (gameLabel) => `Outros sets de ${gameLabel}`,
    navCollection: "Minha Coleção"
  },
  en: {
    htmlLang: "en",
    fmtDate: fmtDateEn,
    title: (name, gameLabel) => tituloSet(name, [`${gameLabel} card list`, gameLabel]),
    desc: (n, name, gameLabel, dateHuman) => `Complete list of all ${n} cards in the ${name} set of ${gameLabel}${dateHuman ? `, released on ${dateHuman}` : ""}. See images, numbers and rarities and build your collection on Sleevu.`,
    sub: (gameLabel, total, dateHuman, n) => `${gameLabel} · ${total} official cards${dateHuman ? ` · released ${dateHuman}` : ""} · ${n} in Sleevu's catalog`,
    cta: "Open this set on Sleevu",
    othersAria: "Other sets",
    others: (gameLabel) => `Other ${gameLabel} sets`,
    navCollection: "My Collection"
  }
};

function setPageHtml(page, canonical, otherSets, lang) {
  const L = SET_L10N[lang] || SET_L10N.pt;
  const isEn = L === SET_L10N.en;
  const { name, rep, game, gameLabel } = page;
  // A LISTA da página é uma carta por número, na língua desta variante (ver
  // cardsForLang). O page.cards cru segue intacto pro resto do script — o
  // ranking de cartas top precisa de cada impressão, que tem página própria.
  const cards = cardsForLang(page.cards, isEn ? "en" : "pt");
  const total = rep.setTotal || cards.length;
  const dateHuman = L.fmtDate(rep.setReleaseDate);
  const title = L.title(name, gameLabel);
  const desc = L.desc(cards.length, name, gameLabel, dateHuman);
  const ogImage = absUrl(rep.setLogo) || `${ORIGIN}/og-image.png`;
  // hreflang: cada variante aponta pra si e pra irmã; pt é o x-default.
  const altPt = `${ORIGIN}/set/${page.slug}`;
  const altEn = `${ORIGIN}/set/${page.slug}-en`;
  const hreflangs = `
    <link rel="alternate" hreflang="pt-BR" href="${escapeAttr(altPt)}">
    <link rel="alternate" hreflang="en" href="${escapeAttr(altEn)}">
    <link rel="alternate" hreflang="x-default" href="${escapeAttr(altPt)}">`;
  // ?game= grava a sessão do jogo no app — sem ele, quem estivesse com outro
  // jogo ativo cairia no detail do jogo errado e não acharia o set.
  const appUrl = `/detail.html?type=set&name=${encodeURIComponent(name)}&game=${game}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${name} — ${gameLabel}`,
    url: canonical,
    description: desc,
    isPartOf: { "@type": "WebSite", name: "Sleevu", url: ORIGIN + "/" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${c.name}${c.number ? ` #${c.number}` : ""}`,
        image: absUrl(c.image) || undefined
      }))
    }
  };

  // As primeiras cartas são as que aparecem sem rolar — e uma delas costuma ser
  // o LCP desta página. `lazy` nelas atrasa a descoberta pro fim do parse do
  // HTML (medido: 244 ms de load delay no LCP em 4G); daqui pra frente elas
  // nascem `eager`, e a primeira ainda pede prioridade alta. O resto da grade
  // segue lazy — são 200+ imagens que ninguém vê de imediato.
  const ACIMA_DA_DOBRA = 6;
  const cardsHtml = cards.map((c, i) => {
    const num = c.number ? `#${escapeHtml(c.number)}` : "";
    const alt = `${c.name}${c.number ? ` ${c.number}/${total}` : ""} — ${name}`;
    const prioridade = i < ACIMA_DA_DOBRA
      ? ` loading="eager"${i === 0 ? ' fetchpriority="high"' : ""}`
      : ` loading="lazy"`;
    // sizes casa com a grade (ver .pr-grid no CSS): uma coluna de ~50vw no
    // celular, ~150px de largura fixa a partir do tablet.
    const srcset = thumbSrcset(c.image);
    const srcsetAttr = srcset ? ` srcset="${srcset}" sizes="(max-width: 640px) 50vw, 150px"` : "";
    const img = c.image
      ? `<img class="pr-card-img" src="${escapeAttr(absUrl(thumbUrl(c.image)))}"${srcsetAttr} alt="${escapeAttr(alt)}"${prioridade} decoding="async" width="245" height="342">`
      : `<span class="pr-card-noimg">${escapeHtml(c.name)}</span>`;
    return `<li class="pr-card"><a href="${escapeAttr(appUrl)}">${img}<span class="pr-card-meta"><span class="pr-card-num">${num}</span> <span class="pr-card-name">${escapeHtml(c.name)}</span></span></a></li>`;
  }).join("");

  const enSuffix = isEn ? "-en" : "";
  const othersHtml = otherSets.length
    ? `<nav class="pr-others" aria-label="${escapeAttr(L.othersAria)}"><h2>${escapeHtml(L.others(gameLabel))}</h2><ul>${otherSets.map((s) => `<li><a href="/set/${escapeAttr(s.slug)}${enSuffix}">${escapeHtml(s.name)}</a></li>`).join("")}</ul></nav>`
    : "";

  const logoHtml = rep.setLogo
    ? `<img class="pr-hero-logo" src="${escapeAttr(absUrl(rep.setLogo))}" alt="${escapeAttr(name)}" loading="eager">`
    : `<strong class="pr-hero-name">${escapeHtml(name)}</strong>`;

  const navHtml = [
    `<a href="/sets?game=${game}">Sets</a>`,
    game === "pokemon" ? `<a href="/pokedex">Pokédex</a>` : "",
    `<a href="/collection">${escapeHtml(L.navCollection)}</a>`
  ].filter(Boolean).join("\n          ");

  return `<!doctype html>
<html lang="${L.htmlLang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">${hreflangs}
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`${name} — ${gameLabel}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <meta property="og:image" content="${escapeAttr(ogImage)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(`${name} — ${gameLabel}`)}">
    <meta name="twitter:description" content="${escapeAttr(desc)}">
    <meta name="twitter:image" content="${escapeAttr(ogImage)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="preconnect" href="https://assets.tcgdex.net">
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="theme-color" content="#101218">
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script src="/src/theme.js"></script>
    <link rel="stylesheet" href="/styles.css">
    <style>
      .pr-wrap { max-width: 1100px; margin: 0 auto; padding: 0 20px 48px; }
      .pr-hero { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin: 24px 0 8px; }
      .pr-hero-logo { max-height: 96px; max-width: 260px; width: auto; height: auto; }
      .pr-hero-name { font-size: 1.6rem; }
      .pr-hero h1 { margin: 0 0 4px; font-size: 1.7rem; }
      .pr-sub { color: var(--muted, #9aa0aa); margin: 0; }
      .pr-cta { display: inline-block; margin: 14px 0 4px; padding: 10px 18px; border-radius: 10px; background: var(--accent, #e63946); color: var(--on-accent, #fff); font-weight: 600; text-decoration: none; }
      /* minmax de 130px, não 150: num celular de 390px a coluna útil fica em
         ~310px, e 150+16+150 = 316 estourava por SEIS pixels — a grade caía pra
         uma carta por linha, gigante e esticada. Com 130 cabem duas. */
      .pr-grid { list-style: none; padding: 0; margin: 24px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 16px; }
      /* Mesma razão do .card-tile no styles.css: são 200+ cartas numa página só
         e o navegador não precisa diagramar as que estão fora da tela. Aqui o
         palpite de altura é firme (a imagem é 245x342 numa coluna de ~150px,
         mais a linha do nome), então a rolagem não estica nem encolhe. */
      .pr-card { content-visibility: auto; contain-intrinsic-size: auto 240px; }
      .pr-card a { text-decoration: none; color: inherit; display: block; }
      .pr-card-img { width: 100%; height: auto; border-radius: 8px; display: block; background: var(--surface-2, #1a1c22); }
      .pr-card-noimg { display: block; padding: 20px 8px; text-align: center; }
      .pr-card-meta { display: block; margin-top: 6px; font-size: 0.85rem; }
      .pr-card-num { color: var(--muted, #9aa0aa); }
      .pr-others { margin-top: 40px; }
      .pr-others ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .pr-others a { color: var(--accent, #e63946); text-decoration: none; }
    </style>
  </head>
  <body>
    <header class="app-header">
      <div class="app-header-inner">
        <a class="brand" href="/">Sleevu</a>
        <nav class="page-nav" aria-label="Páginas">
          ${navHtml}
        </nav>
      </div>
    </header>
    <main class="pr-wrap">
      <div class="pr-hero">
        <div class="pr-hero-art">${logoHtml}</div>
        <div>
          <h1>${escapeHtml(name)}</h1>
          <p class="pr-sub">${escapeHtml(L.sub(gameLabel, total, dateHuman, cards.length))}</p>
          <a class="pr-cta" href="${escapeAttr(appUrl)}">${escapeHtml(L.cta)}</a>
        </div>
      </div>
      <ul class="pr-grid">${cardsHtml}</ul>
      ${othersHtml}
    </main>
  </body>
</html>
`;
}

function buildSitemap(setPages, cardPages, deckPages) {
  const urls = [
    ...STATIC_URLS.map((p) => (p === "/" ? ORIGIN + "/" : ORIGIN + p)),
    ...setPages.map((s) => `${ORIGIN}/set/${s.slug}`),
    ...setPages.map((s) => `${ORIGIN}/set/${s.slug}-en`),
    ...(cardPages || []).map((c) => `${ORIGIN}/card/${c.slug}`),
    ...(deckPages || []).map((d) => `${ORIGIN}/deck/${d.slug}`)
  ];
  const body = urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// ── Páginas de DECK da comunidade (/deck/<slug>.html) ────────────────────────
// Busca de deck ("mickey minnie deck lorcana", "dragapult ex deck list") é o
// tráfego mais recorrente de TCG — Limitless e Dreamborn vivem disso. A galeria
// da comunidade (tabela shares, kind=deck, SELECT anônimo) é dinâmica, mas o
// Google não roda a SPA: aqui viram páginas estáticas com a LISTA DE CARTAS em
// HTML (qtd × nome, o texto que as buscas casam), meta/OG e JSON-LD, apontando
// pro viewer interativo (/decks?s=<id>). Regeradas a cada build — deck novo
// entra no próximo deploy (cron 2×/semana + todo push), removido some junto.
const DECK_OUT_DIR = "deck";
const MAX_DECK_PAGES = 500;
const DECK_GAME_LABELS = {
  pokemon: "Pokémon TCG", lorcana: "Disney Lorcana", onepiece: "One Piece Card Game",
  magic: "Magic: The Gathering", fab: "Flesh and Blood", gundam: "Gundam Card Game",
  dbfw: "Dragon Ball Fusion World", ygo: "Yu-Gi-Oh!", digimon: "Digimon Card Game",
  riftbound: "Riftbound", unionarena: "Union Arena", naruto: "Naruto Card Game",
  hxh: "Hunter × Hunter"
};

async function fetchPublicDecks() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shares?kind=eq.deck&select=id,game,title,created_at,data&order=created_at.desc&limit=${MAX_DECK_PAGES}`, {
      headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
    });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// id -> nome, por jogo, a partir dos chunks que o build já tem no disco (data/
// sets/<lang>/*.json no Pokémon; data/<jogo>/sets/*.json nos demais). Carregado
// UMA vez por jogo que realmente aparece nos decks.
const deckNameCache = {};
function cardNamesFor(game) {
  if (deckNameCache[game]) return deckNameCache[game];
  const map = new Map();
  const dirs = game === "pokemon"
    ? (existsSync(SETS_DIR) ? readdirSync(SETS_DIR).map((l) => join(SETS_DIR, l)) : [])
    : [join("data", game, "sets")];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        for (const c of JSON.parse(readFileSync(join(dir, f), "utf8"))) {
          if (c && c.id && !map.has(c.id)) map.set(c.id, c);
        }
      } catch { /* chunk corrompido: segue */ }
    }
  }
  deckNameCache[game] = map;
  return map;
}

function deckPageHtml(dp) {
  const { deck, slug, cardsList, total, priceUSD } = dp;
  const gameLabel = DECK_GAME_LABELS[deck.game] || deck.game;
  const canonical = `${ORIGIN}/deck/${slug}`;
  const priceBit = priceUSD > 0 ? ` — US$ ${priceUSD.toFixed(2)}` : "";
  const title = `${deck.name} — deck de ${gameLabel} (${total} cartas)${priceBit} | Sleevu`;
  const topNames = cardsList.slice(0, 6).map((c) => c.name).join(", ");
  const desc = `Lista completa do deck "${deck.name}" de ${gameLabel}: ${topNames}${cardsList.length > 6 ? "…" : ""}${priceUSD > 0 ? ` Custo de referência: US$ ${priceUSD.toFixed(2)}.` : ""} Veja a curva, o que falta na sua coleção e copie pra sua conta no Sleevu.`;
  const appUrl = `/decks.html?s=${encodeURIComponent(deck.shareId)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${deck.name} — deck de ${gameLabel}`,
    datePublished: deck.createdAt || undefined,
    author: deck.author ? { "@type": "Person", name: deck.author } : undefined,
    publisher: { "@type": "Organization", name: "Sleevu" },
    url: canonical
  };
  const rows = cardsList.map((c) => `<li>${c.qty}× ${escapeHtml(c.name)}${c.meta ? ` <small>${escapeHtml(c.meta)}</small>` : ""}${c.usd > 0 ? ` <b>US$ ${(c.usd * c.qty).toFixed(2)}</b>` : ""}</li>`).join("\n            ");
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <style>
      body { font-family: system-ui, sans-serif; background: #101218; color: #e8eaf0; margin: 0; padding: 24px 16px; }
      main { max-width: 720px; margin: 0 auto; }
      a { color: #ff6b6b; }
      .cta { display: inline-block; background: #e23030; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 22px; margin: 14px 0; }
      ul { columns: 2; gap: 32px; padding-left: 20px; } li { margin: 3px 0; break-inside: avoid; }
      small { color: #9aa3b2; }
      @media (max-width: 560px) { ul { columns: 1; } }
    </style>
  </head>
  <body>
    <main>
      <p><a href="/decks">← Decks da comunidade</a></p>
      <h1>${escapeHtml(deck.name)}</h1>
      <p>Deck de <strong>${escapeHtml(gameLabel)}</strong> · ${total} cartas${deck.author ? ` · por @${escapeHtml(deck.author)}` : ""}${priceUSD > 0 ? ` · custo de referência <strong>US$ ${priceUSD.toFixed(2)}</strong>` : ""}</p>
      <a class="cta" href="${escapeAttr(appUrl)}">Abrir no Sleevu — valor, curva de custo e copiar o deck</a>
      <h2>Lista de cartas</h2>
      <ul>
            ${rows}
      </ul>
      <p><a href="${escapeAttr(appUrl)}">Ver este deck com preços e análise no Sleevu →</a></p>
    </main>
  </body>
</html>
`;
}

// Tabela de preços por jogo, carregada sob demanda (só dos jogos que aparecem
// nos decks). Pokémon mora em data/, os demais em data/<jogo>/.
const deckPriceCache = {};
async function pricingFor(game) {
  if (deckPriceCache[game]) return deckPriceCache[game];
  const dir = game === "pokemon" ? "data/" : `data/${game}/`;
  let table = {};
  try { table = await loadPricingTable(dir); } catch { /* jogo sem pricing */ }
  // O .generated é artefato de build: vazio no dev e em build cujo sync do jogo
  // falhou. Cai no pricing.js versionado pra a página não sair sem preço.
  if (!Object.keys(table).length) {
    try { table = (await readGlobalVar(new URL(`../${dir}pricing.js`, import.meta.url), "TCG_PRICING")) || {}; } catch { /* sem preço mesmo */ }
  }
  deckPriceCache[game] = table;
  return table;
}

async function buildDeckPages() {
  const rowsRaw = await fetchPublicDecks();
  if (existsSync(DECK_OUT_DIR)) rmSync(DECK_OUT_DIR, { recursive: true, force: true });
  mkdirSync(DECK_OUT_DIR, { recursive: true });
  const used = new Set();
  const out = [];
  for (const row of rowsRaw) {
    const d = row && row.data;
    if (!d || d.v !== 1 || !d.zones || !DECK_GAME_LABELS[d.game]) continue;
    const names = cardNamesFor(d.game);
    const precos = await pricingFor(d.game);
    const cardsList = [];
    let total = 0, priceUSD = 0;
    Object.values(d.zones).forEach((list) => (Array.isArray(list) ? list : []).forEach((e) => {
      if (!e || !e.id) return;
      const qty = Math.max(1, Math.min(99, Number(e.qty) || 1));
      total += qty;
      const c = names.get(String(e.id));
      // Preço de REFERÊNCIA em USD (o mesmo campo que as páginas de carta usam):
      // é o número que aparece na busca — "quanto custa montar este deck" é a
      // pergunta que traz o clique.
      const usd = refPriceUSD(precos[String(e.id)]);
      priceUSD += usd * qty;
      cardsList.push({ qty, usd, name: c ? c.name : String(e.id), meta: c ? `${c.set || ""} ${c.number || ""}`.trim() : "" });
    }));
    if (!total) continue;
    priceUSD = Math.round(priceUSD * 100) / 100;
    const deck = {
      shareId: row.id, game: d.game, author: d.author ? String(d.author).slice(0, 30) : null,
      name: String(d.name || row.title || "Deck").slice(0, 60), createdAt: row.created_at || null
    };
    let base = slugify(`${deck.name}-${d.game}`) || "deck";
    // Sufixo curto do id: dois decks "Mickey Aggro" não podem disputar o slug.
    base = `${base}-${String(row.id).slice(0, 8)}`;
    let s = base, i = 2;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);
    writeFileSync(join(DECK_OUT_DIR, `${s}.html`), deckPageHtml({ deck, slug: s, cardsList, total, priceUSD }), "utf8");
    out.push({ slug: s });
  }
  return out;
}

// ── Páginas de CARTA individual (top por preço + mais vistas) ────────────────
// O Pokellector domina o Google em busca de carta ("Umbreon ex 161 price");
// geramos /card/<slug>.html só pras ~1500 mais relevantes: as mais valiosas
// (pricing do build) + as mais vistas (card_views do Supabase, leitura pública).
const CARD_OUT_DIR = "card";
const MAX_CARD_PAGES = 1500;
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const SUPABASE_ANON = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública

async function loadPricingTable(dir) {
  const v = await readGlobalVar(new URL(`../${dir}pricing.generated.js`, import.meta.url), "TCG_PRICING");
  return v || {};
}
function refPriceUSD(entry) {
  if (!entry) return 0;
  if (entry.u > 0) return entry.u;
  if (entry.e > 0) return entry.e * 1.1; // EUR ~ USD pra RANQUEAR (não exibimos convertido)
  return 0;
}
async function fetchTopViews() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/card_views?select=game,card_id,views&order=views.desc&limit=600`, {
      headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
    });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// CÓDIGO DO SET como o jogador digita na busca ("Ms. All Sunday OP16"). Nem todo
// jogo tem um: o One Piece usa OP16/EB-01, mas o Lorcana numera os sets ("1"), o
// Naruto usa slug interno ("nrt-s01") e o Pokémon usa o id da TCGdex ("base1",
// "2011bw"). Jogar o setId no título sem filtrar encheria metade do catálogo de
// ruído, então o discriminador é a MAIÚSCULA: código de verdade é escrito em
// caixa alta pelo fabricante, id interno não.
//
// Também não repete o que já está no número da carta: em OP01-079 o "OP01" já
// aparece, e "Luffy OP01-079 OP01" só desperdiça caracteres do título.
function setCode(card) {
  const raw = String(card.setId || "").trim();
  if (!/[A-Z]/.test(raw)) return "";            // base1, sv1, 2011bw, nrt-s01, "10"
  const code = raw.replace(/_.*$/, "");         // Gundam: GD01_b -> GD01
  const semTraco = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (semTraco(String(card.number || "")).includes(semTraco(code))) return "";
  return code;
}

// Título da CARTA, mesmo orçamento (ver TITULO_MAX). Ordem = valor de busca
// decrescente: nome > número > código do set > nome do set. O nome do set é o
// primeiro a cair quando não cabe.
function cardTitle(nome, numero, code, setName) {
  const base = [nome, numero, code].filter(Boolean).join(" ");
  const sufixo = " | Sleevu";
  const comSet = setName ? `${base} · ${setName}` : base;
  return ((comSet + sufixo).length <= TITULO_MAX ? comSet : base) + sufixo;
}

// Data de lançamento em pt-BR ("2024-11-08" -> "8 de novembro de 2024"). Só
// aceita o formato ISO que os catálogos usam; qualquer outra coisa vira "".
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function dataPtBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : "";
}

// FICHA TÉCNICA. Cada jogo traz um subconjunto diferente de campos (Magic tem
// custo de mana, Pokémon tem HP, One Piece tem cor), então a lista é montada do
// que EXISTE — linha sem valor não entra, em vez de virar "Ilustrador: —".
// Isto é o que separa uma página de catálogo de uma página de conteúdo raso: os
// dados são específicos daquela carta, não texto de molde repetido.
function fichaTecnica(card, setPage, sCode) {
  const linhas = [
    ["Jogo", setPage.gameLabel],
    ["Set", sCode ? `${setPage.name} (${sCode})` : setPage.name],
    ["Número", card.number],
    ["Raridade", card.rarity && card.rarity !== "None" ? card.rarity : ""],
    ["Ilustrador", card.artist],
    ["Tipo", card.cardType || card.category],
    ["Estágio", card.stage],
    ["Tipos", Array.isArray(card.types) ? card.types.join(", ") : card.types],
    ["Custo", card.manaCost || (card.cost != null && card.cost !== "" ? String(card.cost) : "")],
    ["Poder", card.power],
    ["Cor", card.color || card.colorId || card.ink || card.opColor],
    ["HP", card.hp],
    ["Série", card.setSerieName],
    ["Nº na Pokédex", card.dexId],
    // Acabamento é o que separa duas cópias da MESMA carta em preço (foil,
    // reverse, 1ª edição) — dado que o colecionador procura e que quase nenhum
    // agregador mostra junto do preço.
    ["Acabamentos", Array.isArray(card.variants) ? card.variants.join(", ") : ""],
    ["Lançamento do set", dataPtBr(card.setReleaseDate || setPage.releaseDate)],
    ["Cartas no set", card.setTotal ? String(card.setTotal) : (setPage.cards ? String(setPage.cards.length) : "")]
  ].filter(([, v]) => v != null && String(v).trim() !== "");
  if (!linhas.length) return "";
  return `<h2>Ficha técnica</h2>
      <dl class="prc-ficha">${linhas.map(([k, v]) =>
    `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join("")}</dl>`;
}

// Lista de links pra outras páginas de carta. Vale por dois motivos: dá ao
// leitor o próximo passo óbvio, e amarra as 1.298 páginas numa teia em vez de
// deixá-las ilhadas (link interno é o que faz o rastreador achar e ranquear as
// que não estão no sitemap por acaso).
function listaDeCartas(titulo, itens) {
  if (!itens || !itens.length) return "";
  return `<h2>${escapeHtml(titulo)}</h2>
      <ul class="prc-lista">${itens.map((it) =>
    `<li><a href="/card/${escapeAttr(it.slug)}">${escapeHtml(it.rotulo)}</a></li>`).join("")}</ul>`;
}

function cardPageHtml(cp, ctx = {}) {
  const { card, setPage, slug, priceUSD } = cp;
  const gameLabel = setPage.gameLabel;
  const canonical = `${ORIGIN}/card/${slug}`;
  const codeBit = card.number ? ` ${card.number}` : "";
  // Nome CJK ganha a espécie EN entre parênteses (busca em pt/en acha igual).
  const enBit = card.pokemonName && !/^[\x00-\x7F]/.test(card.name) ? ` (${card.pokemonName})` : "";
  const sCode = setCode(card);
  const title = cardTitle(`${card.name}${enBit}`, card.number, sCode, setPage.name);
  const priceBit = priceUSD > 0 ? ` Preço de referência: US$ ${priceUSD.toFixed(2)}.` : "";
  // A descrição não tem o aperto do título (o Google mostra ~155), então aqui o
  // código do set entra sempre que existir — é a segunda chance de casar com a
  // busca quando ele não coube lá em cima.
  const codeBitDesc = sCode ? ` (${sCode})` : "";
  const desc = `${card.name}${codeBit}${codeBitDesc} do set ${setPage.name} de ${gameLabel}.${priceBit} Veja a imagem, acompanhe o preço e marque na sua coleção grátis no Sleevu.`;
  const img = absUrl(card.image) || "";
  // &card=<id>: o detail.js reabre o POPUP da carta ao aterrissar (openFromUrl)
  // — quem acha a carta no Google cai direto nela, não na página do set pra
  // procurar de novo.
  const appUrl = `/detail.html?type=set&name=${encodeURIComponent(setPage.name)}&game=${setPage.game}&card=${encodeURIComponent(card.id)}`;
  // PARÁGRAFO DE ABERTURA. Frases curtas, montadas só com o que a carta tem —
  // frase sem dado não é escrita, em vez de sair com buraco ("ilustrada por
  // undefined"). O que faz este texto valer pra busca é que cada fato VARIA por
  // carta (raridade, número, ilustrador, data do set, quantas impressões
  // existem); texto de molde igual em 1.298 páginas seria conteúdo raso.
  const frases = [];
  // Nos vintage japoneses o campo `rarity` não guarda raridade: vem com os
  // glifos de TIPO da carta (剣 民 武). Escrever "carta de raridade 剣 民 武" é
  // frase sem sentido pra quem lê e ruído pra quem indexa, então a menção só
  // sai quando o valor parece mesmo uma raridade (curto e sem CJK).
  const rarOk = card.rarity && card.rarity !== "None" &&
    !/[^\x00-\x7F]/.test(card.rarity) && String(card.rarity).length <= 24;
  const rarBit = rarOk ? ` de raridade ${card.rarity}` : "";
  const setBit = sCode ? `${setPage.name} (${sCode})` : setPage.name;
  frases.push(`${card.name} é uma carta${rarBit} do set ${setBit}, de ${gameLabel}${card.number ? `, numerada ${card.number}` : ""}.`);
  if (card.artist) frases.push(`A ilustração é de ${card.artist}.`);
  const acab = Array.isArray(card.variants) ? card.variants.filter(Boolean) : [];
  if (acab.length > 1) {
    frases.push(`Sai em ${acab.length} acabamentos (${acab.join(", ")}), que são cotados separadamente no mercado.`);
  }
  const dtSet = dataPtBr(card.setReleaseDate || setPage.releaseDate);
  const totalSet = Number(card.setTotal) || (setPage.cards ? setPage.cards.length : 0);
  if (dtSet || totalSet) {
    frases.push(`O set ${setPage.name}${dtSet ? ` foi lançado em ${dtSet}` : ""}${dtSet && totalSet ? " e" : ""}${totalSet ? ` reúne ${totalSet} cartas` : ""}.`);
  }
  const nVers = (ctx.versoes || []).length;
  if (nVers) {
    frases.push(`Esta carta também aparece ${nVers === 1 ? "em outra versão" : `em outras ${nVers} versões`} no catálogo — arte alternativa, promocional e reimpressão costumam ter valores de mercado bem diferentes entre si.`);
  }
  if (priceUSD > 0) {
    frases.push("O preço de referência acima é apurado no mercado internacional e atualizado semanalmente; no Sleevu ele aparece convertido em reais, junto do histórico de variação.");
  }
  frases.push(`Marque a carta na sua coleção para acompanhar o preço e ver quanto falta para completar ${setPage.name}.`);
  const intro = frases.join(" ");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${card.name}${codeBit} — ${setPage.name}`,
    image: img || undefined,
    description: desc,
    brand: { "@type": "Brand", name: gameLabel },
    url: canonical
  };
  if (priceUSD > 0) {
    jsonLd.offers = { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: priceUSD.toFixed(2), offerCount: 1, availability: "https://schema.org/InStock" };
  }
  // Trilha (jogo > set > carta). Vale nos dois lados: dá ao leitor a saída pra
  // cima — que numa página de carta é o set, não a home — e o BreadcrumbList faz
  // o Google trocar a URL crua do resultado por "Sleevu > Sets > The Time of
  // Battle", que é mais clicável.
  const trilha = [
    { nome: "Sets", url: `${ORIGIN}/sets?game=${setPage.game}` },
    { nome: setPage.name, url: `${ORIGIN}/set/${setPage.slug}` },
    { nome: `${card.name}${codeBit}`, url: canonical }
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trilha.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.nome, item: t.url }))
  };
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`${card.name}${codeBit}${codeBitDesc} — ${setPage.name}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    ${img ? `<meta property="og:image" content="${escapeAttr(img)}">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#101218">
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
    <script src="/src/theme.js"></script>
    <link rel="stylesheet" href="/styles.css">
    <style>
      .prc-wrap { max-width: 900px; margin: 0 auto; padding: 0 20px 48px; }
      .prc-hero { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 26px; }
      .prc-img { width: min(320px, 80vw); height: auto; border-radius: 12px; background: var(--panel, #1a1c22); }
      .prc-info h1 { margin: 0 0 6px; font-size: 1.5rem; }
      .prc-sub { color: var(--muted, #9aa0aa); margin: 0 0 12px; }
      .prc-price { font-size: 1.25rem; font-weight: 800; margin: 8px 0 2px; }
      .prc-price-note { color: var(--muted, #9aa0aa); font-size: 12.5px; margin: 0 0 14px; }
      .prc-cta { display: inline-block; margin-top: 8px; padding: 10px 18px; border-radius: 10px; background: var(--accent, #e63946); color: var(--on-accent, #fff); font-weight: 600; text-decoration: none; }
      .prc-setlink { margin-top: 22px; }
      .prc-setlink a { color: var(--accent, #e63946); }
      .prc-trilha { margin-top: 18px; font-size: 13px; color: var(--muted, #9aa0aa); }
      .prc-trilha a { color: var(--muted, #9aa0aa); text-decoration: none; }
      .prc-trilha a:hover { text-decoration: underline; }
      .prc-corpo { margin-top: 34px; max-width: 720px; line-height: 1.7; }
      .prc-corpo h2 { font-size: 1.05rem; margin: 30px 0 10px; }
      .prc-ficha { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 20px; margin: 0; }
      .prc-ficha div { display: flex; gap: 8px; border-bottom: 1px solid var(--line, #2d333f); padding-bottom: 6px; }
      .prc-ficha dt { color: var(--muted, #9aa0aa); flex: none; }
      .prc-ficha dd { margin: 0; font-weight: 600; }
      .prc-lista { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 20px; }
      .prc-lista a { color: var(--accent, #e63946); text-decoration: none; }
      .prc-lista a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <header class="app-header">
      <div class="app-header-inner">
        <a class="brand" href="/">Sleevu</a>
        <nav class="page-nav" aria-label="Páginas">
          <a href="/sets?game=${setPage.game}">Sets</a>
          <a href="/collection">Minha Coleção</a>
        </nav>
      </div>
    </header>
    <main class="prc-wrap">
      <nav class="prc-trilha" aria-label="Trilha de navegação">${trilha.map((t, i) =>
        i === trilha.length - 1
          ? `<span aria-current="page">${escapeHtml(t.nome)}</span>`
          : `<a href="${escapeAttr(t.url)}">${escapeHtml(t.nome)}</a> <span aria-hidden="true">›</span> `).join("")}</nav>
      <div class="prc-hero">
        ${img ? `<img class="prc-img" src="${escapeAttr(img)}" alt="${escapeAttr(`${card.name}${codeBit}${codeBitDesc} — ${setPage.name}`)}" loading="eager" width="320" height="447">` : ""}
        <div class="prc-info">
          <h1>${escapeHtml(card.name)}${codeBit ? ` <small>${escapeHtml(card.number)}${sCode ? ` · ${escapeHtml(sCode)}` : ""}</small>` : ""}</h1>
          <p class="prc-sub">${escapeHtml(`${gameLabel} · ${setPage.name}${card.rarity && card.rarity !== "None" ? ` · ${card.rarity}` : ""}`)}</p>
          ${priceUSD > 0 ? `<p class="prc-price">US$ ${priceUSD.toFixed(2)}</p><p class="prc-price-note">Preço de referência de mercado (atualizado semanalmente). No Sleevu você vê em reais e acompanha o histórico.</p>` : ""}
          <a class="prc-cta" href="${escapeAttr(appUrl)}">Marcar na minha coleção</a>
          <p class="prc-setlink">Ver o set completo: <a href="/set/${escapeAttr(setPage.slug)}">${escapeHtml(setPage.name)}</a></p>
        </div>
      </div>
      <section class="prc-corpo">
        <p>${escapeHtml(intro)}</p>
        ${fichaTecnica(card, setPage, sCode)}
        ${listaDeCartas("Outras versões desta carta", ctx.versoes)}
        ${listaDeCartas(`Mais cartas de ${setPage.name}`, ctx.irmas)}
      </section>
    </main>
  </body>
</html>
`;
}

async function main() {
  // Slug único GLOBAL (o diretório /set/ é plano, compartilhado pelos jogos);
  // colisão entre jogos ganha sufixo -2 — a ordem fixa de GAMES mantém estável.
  const used = new Set();
  const pages = [];
  for (const { slug: game, label } of GAMES) {
    const byName = game === "pokemon" ? loadPokemonSets() : await loadGameSets(game);
    if (!byName.size) {
      console.log(`prerender-catalog: sem catálogo de ${game} — pulando.`);
      continue;
    }
    const gamePages = [];
    for (const [name, cards] of byName) {
      cards.sort((a, b) => cmpNumber(a.number, b.number));
      const rep = cards.find((c) => c.setLogo) || cards.find((c) => c.setReleaseDate) || cards[0];
      let slug = slugify(name) || slugify(rep.setId) || "set";
      // Nome quase todo CJK (sobra só um dígito, ex.: ※確認中1 -> "1"): slug
      // curto demais colide entre jogos — prefixa o setId, como nas cartas.
      if (slug.length < 4) slug = slugify(rep.setId) ? `${slugify(rep.setId)}-${slug}` : `set-${slug}`;
      let s = slug, i = 2;
      while (used.has(s)) s = `${slug}-${i++}`;
      used.add(s);
      gamePages.push({ name, slug: s, cards, rep, game, gameLabel: label });
    }
    gamePages.sort((a, b) => a.name.localeCompare(b.name));
    pages.push(...gamePages);
  }

  if (!pages.length) {
    console.log("prerender-catalog: nenhum catálogo encontrado — nada a fazer.");
    return;
  }

  // Recria o diretório de saída do zero (evita páginas órfãs de sets removidos).
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const page of pages) {
    // "Outros sets" só do MESMO jogo (linkar 400 sets de 3 jogos em cada página
    // viraria ruído pro leitor e pro crawler).
    const others = pages.filter((p) => p.game === page.game && p.slug !== page.slug).map((p) => ({ name: p.name, slug: p.slug }));
    // Variante pt (padrão/x-default) + variante en (hreflang) — mesma página,
    // copy trocado; elas se referenciam via <link rel=alternate>.
    writeFileSync(join(OUT_DIR, `${page.slug}.html`), setPageHtml(page, `${ORIGIN}/set/${page.slug}`, others, "pt"), "utf8");
    writeFileSync(join(OUT_DIR, `${page.slug}-en.html`), setPageHtml(page, `${ORIGIN}/set/${page.slug}-en`, others, "en"), "utf8");
  }

  // Cartas top: ranqueia por preço (pricing do build) + mais vistas (Supabase).
  const pricingByGame = {
    pokemon: await loadPricingTable("data/"),
    lorcana: await loadPricingTable("data/lorcana/"),
    onepiece: await loadPricingTable("data/onepiece/")
  };
  const candidates = new Map(); // cardId|game -> { card, setPage, score }
  for (const p of pages) {
    const pricing = pricingByGame[p.game] || {};
    for (const card of p.cards) {
      const usd = refPriceUSD(pricing[card.id]);
      if (usd <= 0) continue;
      const k = `${p.game}|${card.id}`;
      if (!candidates.has(k) || candidates.get(k).score < usd) {
        candidates.set(k, { card, setPage: p, score: usd, priceUSD: usd });
      }
    }
  }
  let ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CARD_PAGES - 300);
  // Mais vistas (até ~300 extras que não entraram por preço).
  const views = await fetchTopViews();
  const have = new Set(ranked.map((r) => `${r.setPage.game}|${r.card.id}`));
  for (const v of views) {
    if (ranked.length >= MAX_CARD_PAGES) break;
    const k = `${v.game}|${v.card_id}`;
    if (have.has(k)) continue;
    for (const p of pages) {
      if (p.game !== v.game) continue;
      const card = p.cards.find((c) => c.id === v.card_id);
      if (card) {
        ranked.push({ card, setPage: p, score: 0, priceUSD: refPriceUSD((pricingByGame[p.game] || {})[card.id]) });
        have.add(k);
        break;
      }
    }
  }
  if (existsSync(CARD_OUT_DIR)) rmSync(CARD_OUT_DIR, { recursive: true, force: true });
  mkdirSync(CARD_OUT_DIR, { recursive: true });
  const cardSlugs = new Set();
  const cardPages = [];
  for (const cp of ranked) {
    // Nome com CJK sluga mal ("ブラッキーex" -> "ex"): prefixa a espécie EN
    // canônica (pokemonName pós-merge) pra URL legível (umbreon-ex-217).
    const hasCjk = /[^\x00-\x7F]/.test(cp.card.name);
    let nameSlug = hasCjk
      ? slugify(`${cp.card.pokemonName || ""}-${cp.card.name}`)
      : slugify(cp.card.name);
    // Sobrou quase nada legível (pokemonName também CJK, ex.: Pokémon "de
    // treinador" JP sem dexId): prefixa o setId pra URL ainda fazer sentido.
    if (hasCjk && nameSlug.length < 4) nameSlug = slugify(`${cp.card.setId || ""}-${nameSlug}`) || nameSlug;
    let base = slugify(`${nameSlug}-${cp.card.number || cp.card.id}`) || slugify(cp.card.id) || "carta";
    let s = base, i = 2;
    while (cardSlugs.has(s)) s = `${base}-${i++}`;
    cardSlugs.add(s);
    cp.slug = s;
    cardPages.push({ slug: s });
  }

  // DUAS PASSAGENS de propósito. A escrita do HTML só pode acontecer depois que
  // TODOS os slugs existem: uma página linka pras outras versões da mesma carta
  // e pras vizinhas de set, e no meio da primeira passagem metade desses slugs
  // ainda não tinha sido decidida — os links sairiam quebrados.
  const porNome = new Map();  // jogo|nome -> [cp]
  const porSet = new Map();   // slug do set -> [cp]
  for (const cp of ranked) {
    const kn = `${cp.setPage.game}|${String(cp.card.name || "").toLowerCase()}`;
    if (!porNome.has(kn)) porNome.set(kn, []);
    porNome.get(kn).push(cp);
    if (!porSet.has(cp.setPage.slug)) porSet.set(cp.setPage.slug, []);
    porSet.get(cp.setPage.slug).push(cp);
  }
  // Rótulo que DIFERENCIA: repetir o nome da carta em 8 links seguidos não
  // ajuda ninguém (nem leitor, nem buscador). Aqui o que muda é o que aparece.
  const rotuloVersao = (o) => [o.setPage.name, o.card.number].filter(Boolean).join(" · ");
  const rotuloIrma = (o) => [o.card.name, o.card.number].filter(Boolean).join(" ");
  for (const cp of ranked) {
    const kn = `${cp.setPage.game}|${String(cp.card.name || "").toLowerCase()}`;
    const versoes = (porNome.get(kn) || [])
      .filter((o) => o !== cp)
      .slice(0, 12)
      .map((o) => ({ slug: o.slug, rotulo: rotuloVersao(o) }));
    // As mais valiosas do set primeiro (ranked já vem ordenado por preço), sem
    // a própria carta. 12 é o teto pra lista não virar um paredão de links.
    const irmas = (porSet.get(cp.setPage.slug) || [])
      .filter((o) => o !== cp)
      .slice(0, 12)
      .map((o) => ({ slug: o.slug, rotulo: rotuloIrma(o) }));
    writeFileSync(join(CARD_OUT_DIR, `${cp.slug}.html`), cardPageHtml(cp, { versoes, irmas }), "utf8");
  }

  // Decks da comunidade: nunca derruba o build (galeria fora do ar = 0 páginas).
  let deckPages = [];
  try { deckPages = await buildDeckPages(); } catch (e) { console.warn(`decks: pulado (${e.message})`); }

  writeFileSync("sitemap.xml", buildSitemap(pages, cardPages, deckPages), "utf8");
  const perGame = GAMES.map((g) => `${g.slug} ${pages.filter((p) => p.game === g.slug).length}`).join(" · ");
  console.log(`prerender-catalog: ${pages.length} páginas de set em /${OUT_DIR}/ (${perGame}) + ${cardPages.length} páginas de carta em /${CARD_OUT_DIR}/ + ${deckPages.length} páginas de deck em /${DECK_OUT_DIR}/ + sitemap.xml (${STATIC_URLS.length + pages.length * 2 + cardPages.length + deckPages.length} URLs).`);
}

await main();
