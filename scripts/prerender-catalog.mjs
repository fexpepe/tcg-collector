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

// CSP idêntica à das outras páginas (o <script type=application/ld+json> é bloco
// de dados, não script executável, então passa mesmo com esta CSP estrita).
// wsrv.nl: proxy de resize das imagens vintage do One Piece.
const CSP = `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://assets.tcgdex.net https://images.pokemontcg.io https://raw.githubusercontent.com https://tcgplayer-cdn.tcgplayer.com https://cards.lorcast.io https://wsrv.nl; connect-src 'self' https://api.tcgdex.net https://pokeapi.co https://economia.awesomeapi.com.br https://*.supabase.co https://cloudflareinsights.com; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'`;

// Páginas estáticas do site (base do sitemap), extensionless como o CF Pages serve.
const STATIC_URLS = [
  "/", "/hub", "/explore", "/dashboard", "/cards", "/pokedex", "/sets", "/artists", "/trainers",
  "/collection", "/wishlist", "/portfolio", "/binders", "/sales", "/graded",
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
  return /^https?:\/\//.test(s) ? s : "/" + s.replace(/^\/+/, "");
}
function fmtDatePt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return `${Number(m[3])} de ${MONTHS_PT[Number(m[2]) - 1]} de ${m[1]}`;
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
    title: (name, gameLabel) => `${name} — cartas do set ${gameLabel} | Sleevu`,
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
    title: (name, gameLabel) => `${name} — ${gameLabel} card list | Sleevu`,
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
  const { name, cards, rep, game, gameLabel } = page;
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

  const cardsHtml = cards.map((c) => {
    const num = c.number ? `#${escapeHtml(c.number)}` : "";
    const alt = `${c.name}${c.number ? ` ${c.number}/${total}` : ""} — ${name}`;
    const img = c.image
      ? `<img class="pr-card-img" src="${escapeAttr(absUrl(c.image))}" alt="${escapeAttr(alt)}" loading="lazy" width="245" height="342">`
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
    <meta http-equiv="Content-Security-Policy" content="${CSP}">
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
      .pr-grid { list-style: none; padding: 0; margin: 24px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
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

function buildSitemap(setPages, cardPages) {
  const urls = [
    ...STATIC_URLS.map((p) => (p === "/" ? ORIGIN + "/" : ORIGIN + p)),
    ...setPages.map((s) => `${ORIGIN}/set/${s.slug}`),
    ...setPages.map((s) => `${ORIGIN}/set/${s.slug}-en`),
    ...(cardPages || []).map((c) => `${ORIGIN}/card/${c.slug}`)
  ];
  const body = urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
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

function cardPageHtml(cp) {
  const { card, setPage, slug, priceUSD } = cp;
  const gameLabel = setPage.gameLabel;
  const canonical = `${ORIGIN}/card/${slug}`;
  const codeBit = card.number ? ` ${card.number}` : "";
  // Nome CJK ganha a espécie EN entre parênteses (busca em pt/en acha igual).
  const enBit = card.pokemonName && !/^[\x00-\x7F]/.test(card.name) ? ` (${card.pokemonName})` : "";
  const title = `${card.name}${enBit}${codeBit} — ${setPage.name} (${gameLabel}) | preço e coleção | Sleevu`;
  const priceBit = priceUSD > 0 ? ` Preço de referência: US$ ${priceUSD.toFixed(2)}.` : "";
  const desc = `${card.name}${codeBit} do set ${setPage.name} de ${gameLabel}.${priceBit} Veja a imagem, acompanhe o preço e marque na sua coleção grátis no Sleevu.`;
  const img = absUrl(card.image) || "";
  const appUrl = `/detail.html?type=set&name=${encodeURIComponent(setPage.name)}&game=${setPage.game}`;
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
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${CSP}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(desc)}">
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <meta property="og:site_name" content="Sleevu">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    <meta property="og:title" content="${escapeAttr(`${card.name}${codeBit} — ${setPage.name}`)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    ${img ? `<meta property="og:image" content="${escapeAttr(img)}">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#101218">
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
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
      <div class="prc-hero">
        ${img ? `<img class="prc-img" src="${escapeAttr(img)}" alt="${escapeAttr(`${card.name}${codeBit} — ${setPage.name}`)}" loading="eager" width="320" height="447">` : ""}
        <div class="prc-info">
          <h1>${escapeHtml(card.name)}${codeBit ? ` <small>${escapeHtml(card.number)}</small>` : ""}</h1>
          <p class="prc-sub">${escapeHtml(`${gameLabel} · ${setPage.name}${card.rarity && card.rarity !== "None" ? ` · ${card.rarity}` : ""}`)}</p>
          ${priceUSD > 0 ? `<p class="prc-price">US$ ${priceUSD.toFixed(2)}</p><p class="prc-price-note">Preço de referência de mercado (atualizado semanalmente). No Sleevu você vê em reais e acompanha o histórico.</p>` : ""}
          <a class="prc-cta" href="${escapeAttr(appUrl)}">Marcar na minha coleção</a>
          <p class="prc-setlink">Ver o set completo: <a href="/set/${escapeAttr(setPage.slug)}">${escapeHtml(setPage.name)}</a></p>
        </div>
      </div>
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
    writeFileSync(join(CARD_OUT_DIR, `${s}.html`), cardPageHtml(cp), "utf8");
    cardPages.push({ slug: s });
  }

  writeFileSync("sitemap.xml", buildSitemap(pages, cardPages), "utf8");
  const perGame = GAMES.map((g) => `${g.slug} ${pages.filter((p) => p.game === g.slug).length}`).join(" · ");
  console.log(`prerender-catalog: ${pages.length} páginas de set em /${OUT_DIR}/ (${perGame}) + ${cardPages.length} páginas de carta em /${CARD_OUT_DIR}/ + sitemap.xml (${STATIC_URLS.length + pages.length * 2 + cardPages.length} URLs).`);
}

await main();
