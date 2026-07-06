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
  { slug: "onepiece", label: "One Piece Card Game" }
];

// CSP idêntica à das outras páginas (o <script type=application/ld+json> é bloco
// de dados, não script executável, então passa mesmo com esta CSP estrita).
// wsrv.nl: proxy de resize das imagens vintage do One Piece.
const CSP = `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://assets.tcgdex.net https://images.pokemontcg.io https://raw.githubusercontent.com https://tcgplayer-cdn.tcgplayer.com https://cards.lorcast.io https://wsrv.nl; connect-src 'self' https://api.tcgdex.net https://pokeapi.co https://economia.awesomeapi.com.br https://*.supabase.co https://cloudflareinsights.com; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'`;

// Páginas estáticas do site (base do sitemap), extensionless como o CF Pages serve.
const STATIC_URLS = [
  "/", "/hub", "/cards", "/pokedex", "/sets", "/artists", "/trainers",
  "/collection", "/wishlist", "/portfolio", "/binders", "/sales", "/graded",
  "/about", "/faq", "/help", "/privacy", "/terms"
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

function setPageHtml(page, canonical, otherSets) {
  const { name, cards, rep, game, gameLabel } = page;
  const total = rep.setTotal || cards.length;
  const dateHuman = fmtDatePt(rep.setReleaseDate);
  const title = `${name} — cartas do set ${gameLabel} | Sleevu`;
  const desc = `Lista completa das ${cards.length} cartas do set ${name} de ${gameLabel}${dateHuman ? `, lançado em ${dateHuman}` : ""}. Veja imagens, números e raridades e monte sua coleção no Sleevu.`;
  const ogImage = absUrl(rep.setLogo) || `${ORIGIN}/og-image.svg`;
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

  const othersHtml = otherSets.length
    ? `<nav class="pr-others" aria-label="Outros sets"><h2>Outros sets de ${escapeHtml(gameLabel)}</h2><ul>${otherSets.map((s) => `<li><a href="/set/${escapeAttr(s.slug)}">${escapeHtml(s.name)}</a></li>`).join("")}</ul></nav>`
    : "";

  const logoHtml = rep.setLogo
    ? `<img class="pr-hero-logo" src="${escapeAttr(absUrl(rep.setLogo))}" alt="${escapeAttr(name)}" loading="eager">`
    : `<strong class="pr-hero-name">${escapeHtml(name)}</strong>`;

  const navHtml = [
    `<a href="/sets?game=${game}">Sets</a>`,
    game === "pokemon" ? `<a href="/pokedex">Pokédex</a>` : "",
    `<a href="/collection">Minha Coleção</a>`
  ].filter(Boolean).join("\n          ");

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
    <meta name="theme-color" content="#0d0e12">
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
          <p class="pr-sub">${escapeHtml(`${gameLabel} · ${total} cartas oficiais${dateHuman ? ` · lançado em ${dateHuman}` : ""} · ${cards.length} no catálogo do Sleevu`)}</p>
          <a class="pr-cta" href="${escapeAttr(appUrl)}">Abrir o set no Sleevu</a>
        </div>
      </div>
      <ul class="pr-grid">${cardsHtml}</ul>
      ${othersHtml}
    </main>
  </body>
</html>
`;
}

function buildSitemap(setPages) {
  const urls = [
    ...STATIC_URLS.map((p) => (p === "/" ? ORIGIN + "/" : ORIGIN + p)),
    ...setPages.map((s) => `${ORIGIN}/set/${s.slug}`)
  ];
  const body = urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
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
    const canonical = `${ORIGIN}/set/${page.slug}`;
    // "Outros sets" só do MESMO jogo (linkar 400 sets de 3 jogos em cada página
    // viraria ruído pro leitor e pro crawler).
    const others = pages.filter((p) => p.game === page.game && p.slug !== page.slug).map((p) => ({ name: p.name, slug: p.slug }));
    const html = setPageHtml(page, canonical, others);
    writeFileSync(join(OUT_DIR, `${page.slug}.html`), html, "utf8");
  }

  writeFileSync("sitemap.xml", buildSitemap(pages), "utf8");
  const perGame = GAMES.map((g) => `${g.slug} ${pages.filter((p) => p.game === g.slug).length}`).join(" · ");
  console.log(`prerender-catalog: ${pages.length} páginas de set em /${OUT_DIR}/ (${perGame}) + sitemap.xml (${STATIC_URLS.length + pages.length} URLs).`);
}

await main();
